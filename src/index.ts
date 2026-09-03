/** Cordis Host plugin for durable standalone DSH automations. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import z from '@deepseek-ai/schemastery'
import { registerAutomationRpc } from './rpc.ts'
import { AutomationService } from './service.ts'
import { registerAutomationTools } from './tools.ts'

export const name = 'dsh-automation'
export const inject = [
  'storageDomain', 'agents', 'sessions', 'workspaceRegistry', 'agentDefaultModel',
  'agentPresets', 'tools', 'connection', 'settings',
]

export interface Config {
  readonly maxConcurrentRuns?: number
  readonly runTimeoutMinutes?: number
  readonly misfireGraceMinutes?: number
  readonly historyLimit?: number
  readonly archiveRunSessions?: boolean
  /** Replay every missed occurrence after a host resume instead of skipping stale ones. */
  readonly catchUpMissedRuns?: boolean
  /** Backlog cap per automation when catchUpMissedRuns is enabled (most recent occurrences win). */
  readonly catchUpMissedRunsMax?: number
}

export const Config = z.object({
  maxConcurrentRuns: z.number().step(1).min(1).max(32).default(2),
  runTimeoutMinutes: z.number().step(1).min(1).max(1_440).default(60),
  misfireGraceMinutes: z.number().step(1).min(0).max(525_600).default(15),
  historyLimit: z.number().step(1).min(1).max(5_000).default(200),
  archiveRunSessions: z.boolean().default(false),
  catchUpMissedRuns: z.boolean().default(false),
  catchUpMissedRunsMax: z.number().step(1).min(1).max(1_000).default(1),
})

const MUTATING_TOOLS = new Set([
  'automation_create', 'automation_update', 'automation_run_now', 'automation_delete',
])

export function needsHumanApproval(
  exec: { readonly name: string; readonly arguments?: unknown; readonly signal: AbortSignal },
  isMountedAgent: boolean,
): boolean {
  if (!isMountedAgent || exec.signal.aborted || !MUTATING_TOOLS.has(exec.name)) return false
  if (exec.name !== 'automation_update') return true
  const args = typeof exec.arguments === 'object' && exec.arguments !== null
    ? exec.arguments as Record<string, unknown>
    : {}
  return !(args.status === 'paused' && Object.keys(args).every(key => key === 'id' || key === 'status'))
}

export function humanApprovalReason(toolName: string): string {
  return toolName === 'automation_delete'
    ? 'This action permanently deletes an automation definition. Its run history is retained, but the schedule cannot be restored automatically.'
    : 'This action creates or expands unattended future work. Review its prompt, schedule, workspace, and permission boundary.'
}

/** Mount one host-wide authority and agent-scoped management tools. */
export async function apply(ctx: Context, rawConfig: Config): Promise<void> {
  const config = rawConfig as Required<Config>
  await ctx.effect(async () => {
    let alive = true
    const service = await AutomationService.open(ctx, {
      maxConcurrentRuns: config.maxConcurrentRuns,
      runTimeoutMs: config.runTimeoutMinutes * 60_000,
      misfireGraceMs: config.misfireGraceMinutes * 60_000,
      historyLimit: config.historyLimit,
      archiveRunSessions: config.archiveRunSessions,
      catchUpMissedRuns: config.catchUpMissedRuns,
      catchUpMissedRunsMax: config.catchUpMissedRunsMax,
    })
    // Host-wide policy lives in the `dsh-automation` settings namespace so the
    // run-history panel can edit it at runtime; the cordis config acts as the
    // composition base until the user first saves from the UI.
    const settingsService = (ctx as unknown as {
      readonly settings?: {
        register(
          ns: string,
          schema: unknown,
          options?: { readonly base?: Record<string, unknown> },
        ): { readonly get: () => unknown; readonly update: (value: unknown) => Promise<unknown> }
      }
    }).settings
    if (settingsService !== undefined) {
      const settingsOwner = settingsService.register('dsh-automation', z.object({
        catchUpMissedRuns: z.boolean().default(false),
        catchUpMissedRunsMax: z.number().step(1).min(1).max(1_000).default(1),
        misfireGraceMinutes: z.number().step(1).min(0).max(525_600).default(60),
      }), {
        base: {
          catchUpMissedRuns: config.catchUpMissedRuns,
          catchUpMissedRunsMax: config.catchUpMissedRunsMax,
          misfireGraceMinutes: config.misfireGraceMinutes,
        },
      })
      service.attachSettings({
        get: () => settingsOwner.get() as never,
        update: async (next) => { await settingsOwner.update(next) },
      })
    }
    const agentTools = new Map<string, () => void | Promise<void>>()
    let cleaned = false
    let stopCreated = () => {}
    let stopDisposed = () => {}
    let stopApproval = () => {}
    let removeRpc = async (): Promise<void> => {}

    const cleanup = async (): Promise<void> => {
      if (cleaned) return
      cleaned = true
      alive = false
      for (const stop of [stopCreated, stopDisposed, stopApproval]) {
        try { stop() } catch (error: unknown) {
          ctx.logger.warn(`dsh-automation: lifecycle cleanup failed: ${String(error)}`)
        }
      }
      const results = await Promise.allSettled([
        removeRpc(),
        ...[...agentTools.values()].reverse().map(dispose => Promise.resolve().then(dispose)),
      ])
      for (const result of results) {
        if (result.status === 'rejected') {
          ctx.logger.warn(`dsh-automation: contribution cleanup failed: ${String(result.reason)}`)
        }
      }
      agentTools.clear()
      await service.dispose()
    }

    try {
      const mountTools = (agent: any): void => {
        if (!alive || agentTools.has(String(agent.id))
          || service.ownsSession(String(agent.id), agent.session.events)) return
        if (!ctx.agents.roots().includes(agent)) return
        const dispose = agent.ctx.effect(
          () => registerAutomationTools(service, agent),
          'dsh-automation: management tools',
        )
        agentTools.set(String(agent.id), dispose)
      }
      for (const agent of ctx.agents.roots()) mountTools(agent)
      stopCreated = ctx.on('agent/created', ({ agent }: any) => { mountTools(agent) })
      stopDisposed = ctx.on('agent/disposed', ({ agent }: any) => { agentTools.delete(String(agent.id)) })
      stopApproval = ctx.on('tools/pre-execute', async (exec: any, next: () => Promise<any>) => {
        const downstream = await next()
        if (downstream.kind !== 'allow'
          || !needsHumanApproval(exec, exec.agent?.id !== undefined && agentTools.has(String(exec.agent.id)))) return downstream
        return {
          kind: 'ask' as const,
          reason: humanApprovalReason(exec.name),
        }
      })
      removeRpc = registerAutomationRpc(ctx, service)

      const loader = ctx.get('loader') as { await(): Promise<void> } | undefined
      if (loader === undefined) service.start()
      else {
        void loader.await().then(() => {
          if (alive) service.start()
        }, (error: unknown) => {
          if (alive) ctx.logger.warn(`dsh-automation: Loader did not settle; clock remains stopped: ${String(error)}`)
        })
      }

      return cleanup
    } catch (error) {
      await cleanup()
      throw error
    }
  }, 'dsh-automation: host service')
}

export type * from './types.ts'
export { automationDomainSpec } from './domain.ts'

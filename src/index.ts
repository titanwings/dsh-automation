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
  'agentPresets', 'tools', 'connection',
]

export interface Config {
  readonly maxConcurrentRuns?: number
  readonly runTimeoutMinutes?: number
  readonly misfireGraceMinutes?: number
  readonly historyLimit?: number
  readonly archiveRunSessions?: boolean
}

export const Config = z.object({
  maxConcurrentRuns: z.number().step(1).min(1).max(32).default(2),
  runTimeoutMinutes: z.number().step(1).min(1).max(1_440).default(60),
  misfireGraceMinutes: z.number().step(1).min(0).max(10_080).default(15),
  historyLimit: z.number().step(1).min(1).max(5_000).default(200),
  archiveRunSessions: z.boolean().default(false),
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
    })
    const agentTools = new Map<object, () => void | Promise<void>>()
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
        if (!alive || agentTools.has(agent)
          || service.ownsSession(String(agent.id), agent.session.snapshotEvents())) return
        if (!ctx.agents.roots().includes(agent)) return
        const dispose = agent.ctx.effect(
          () => registerAutomationTools(service, agent),
          'dsh-automation: management tools',
        )
        agentTools.set(agent, dispose)
      }
      for (const agent of ctx.agents.roots()) mountTools(agent)
      stopCreated = ctx.on('agent/created', ({ agent }: any) => { mountTools(agent) })
      stopDisposed = ctx.on('agent/disposed', ({ agent }: any) => { agentTools.delete(agent) })
      stopApproval = ctx.on('tools/pre-execute', async (exec: any, next: () => Promise<any>) => {
        const downstream = await next()
        if (downstream.kind !== 'allow' || !needsHumanApproval(exec, agentTools.has(exec.agent))) return downstream
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

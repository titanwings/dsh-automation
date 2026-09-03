/** Agent-scoped management tools over the host-wide AutomationService. */

import { defineTool, type JsonValue, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AutomationService } from './service.ts'
import type { AutomationSchedule, PermissionPreset, Weekday } from './types.ts'

interface ToolAgent {
  readonly id: string
  readonly ctx: {
    readonly tools: { register(definition: unknown): () => void }
  }
}

const WEEKDAYS: readonly Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

interface ScheduleArgs {
  readonly kind?: 'once' | 'interval' | 'daily' | 'weekly'
  readonly time_zone?: string
  readonly at?: string
  readonly every_minutes?: number
  readonly time?: string
  readonly weekdays?: string[]
}

interface CreateArgs extends ScheduleArgs {
  readonly name: string
  readonly prompt: string
  readonly kind: 'once' | 'interval' | 'daily' | 'weekly'
  readonly time_zone: string
  readonly provider?: string | null
  readonly model?: string | null
  readonly reasoning_effort?: string | null
  readonly permission?: PermissionPreset
}

interface UpdateArgs extends ScheduleArgs {
  readonly id: string
  readonly name?: string
  readonly prompt?: string
  readonly status?: 'active' | 'paused'
  readonly provider?: string | null
  readonly model?: string | null
  readonly reasoning_effort?: string | null
  readonly permission?: PermissionPreset
}

interface IdArgs { readonly id: string }

const SCHEDULE_FIELDS = ['time_zone', 'at', 'every_minutes', 'time', 'weekdays'] as const
const NULLABLE_STRING = { oneOf: [{ type: 'string' }, { type: 'null' }] } as const

function render(_args: unknown, value: JsonValue): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

const JSON_OUTPUT = {
  schema: { type: 'json' },
  render,
} as const

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function present(title: string, kind: 'read' | 'other', rawInput?: unknown) {
  return { card: 'generic' as const, title, kind, ...(rawInput === undefined ? {} : { rawInput }) }
}

function validateScheduleSelector(args: ScheduleArgs): void {
  const presentFields = SCHEDULE_FIELDS.filter(field => args[field] !== undefined)
  if (args.kind === undefined) {
    if (presentFields.length > 0) throw new Error('kind is required when changing schedule fields')
    return
  }
  const required = args.kind === 'once'
    ? ['time_zone', 'at'] as const
    : args.kind === 'interval'
      ? ['time_zone', 'every_minutes'] as const
      : args.kind === 'daily'
        ? ['time_zone', 'time'] as const
        : ['time_zone', 'time', 'weekdays'] as const
  const allowed = new Set<string>(required)
  const missing = required.filter(field => args[field] === undefined)
  if (missing.length > 0) throw new Error(`${args.kind} schedule requires ${missing.join(', ')}`)
  const unrelated = presentFields.filter(field => !allowed.has(field))
  if (unrelated.length > 0) throw new Error(`${args.kind} schedule does not accept ${unrelated.join(', ')}`)
}

function validateModelSelector(
  args: { readonly provider?: string | null; readonly model?: string | null; readonly reasoning_effort?: string | null },
  create: boolean,
): void {
  const providerSpecified = args.provider !== undefined
  const modelSpecified = args.model !== undefined
  if (providerSpecified !== modelSpecified) throw new Error('provider and model must be provided together')
  if (providerSpecified && ((args.provider === null) !== (args.model === null))) {
    throw new Error('provider and model must both be strings or both be null')
  }
  if (args.reasoning_effort !== undefined && args.reasoning_effort !== null
    && providerSpecified && args.provider === null) {
    throw new Error('reasoning_effort requires a pinned provider and model')
  }
  if (create && args.reasoning_effort !== undefined && !providerSpecified) {
    throw new Error('reasoning_effort requires an explicit provider and model')
  }
}

function scheduleFromArgs(args: ScheduleArgs, now: string): AutomationSchedule {
  validateScheduleSelector(args)
  const timeZone = String(args.time_zone ?? '')
  switch (args.kind) {
    case 'once':
      return { kind: 'once', at: String(args.at ?? ''), timeZone }
    case 'interval':
      return { kind: 'interval', everyMinutes: Number(args.every_minutes), anchor: now, timeZone }
    case 'daily':
      return { kind: 'daily', time: String(args.time ?? ''), timeZone }
    case 'weekly': {
      const weekdays = Array.isArray(args.weekdays) ? args.weekdays.map(String) : []
      if (weekdays.some(day => !WEEKDAYS.includes(day as Weekday))) throw new Error('weekdays contains an invalid day')
      return { kind: 'weekly', weekdays: weekdays as Weekday[], time: String(args.time ?? ''), timeZone }
    }
    default:
      throw new Error('kind must be once, interval, daily, or weekly')
  }
}

/**
 * Install the management tools for one root Agent.
 *
 * The Host may resolve `agent.ctx.tools.register` into one shared layer for
 * every Agent (observed with dsh-tools: a second registration of the same
 * name fails the whole session creation with "already registered"). The
 * registration is therefore duplicate-tolerant, and each execution derives
 * its ownership scope from the executing Agent instead of the Agent that
 * happened to register first, so every live Agent keeps working tools.
 */
export function registerAutomationTools(service: AutomationService, agent: ToolAgent): () => void {
  const disposers: Array<() => void> = []
  const scopeFor = (exec: ToolRunContext) => ({
    sessionId: exec.agent?.id ?? agent.id,
    creatorKind: 'agent' as const,
  })
  const register = (definition: unknown): void => {
    try {
      disposers.push(agent.ctx.tools.register(definition))
    } catch (error) {
      if (error instanceof Error && error.message.includes('already registered')) return
      throw error
    }
  }
  try {
    register(defineTool({
      name: 'automation_create',
      description: 'Create a durable standalone automation for this exact workspace. Each trigger starts a fresh DSH session and does not inherit this conversation. Omit model fields to capture this Session selection, or set provider and model to null to follow the live global default. Use an explicit IANA time zone. Minimum interval is five minutes. Default to read-only unless writing files is necessary.',
      parameters: {
        name: { type: 'string', required: true },
        prompt: { type: 'string', required: true, description: 'Self-contained task prompt for every fresh run.' },
        kind: { type: 'string', required: true, enum: ['once', 'interval', 'daily', 'weekly'] },
        time_zone: { type: 'string', required: true, description: 'IANA zone such as Asia/Shanghai.' },
        at: { type: 'string', description: 'Offset ISO instant for a once schedule.' },
        every_minutes: { type: 'integer', description: 'Interval in minutes, at least five.' },
        time: { type: 'string', description: 'Local HH:mm for daily or weekly.' },
        weekdays: { type: 'array', items: { type: 'string', enum: WEEKDAYS } },
        provider: { ...NULLABLE_STRING, description: 'Provider route to pin. Set provider and model to null to follow the live global default.' },
        model: { ...NULLABLE_STRING, description: 'Provider-owned model id. Must be supplied together with provider.' },
        reasoning_effort: { ...NULLABLE_STRING, description: 'Adapter-owned effort id. Null uses the pinned model default.' },
        permission: { type: 'string', enum: ['read-only', 'workspace-write'] },
      },
      output: JSON_OUTPUT,
      async execute(args: CreateArgs, exec: ToolRunContext) {
        if (exec.signal.aborted) return json({ ok: false, code: 'cancelled' })
        try {
          const now = new Date().toISOString()
          validateModelSelector(args, true)
          const value = await service.create(scopeFor(exec), {
            name: args.name,
            prompt: args.prompt,
            schedule: scheduleFromArgs(args, now),
            ...(args.provider === undefined ? {} : { provider: args.provider }),
            ...(args.model === undefined ? {} : { model: args.model }),
            ...(args.reasoning_effort === undefined ? {} : { reasoningEffort: args.reasoning_effort }),
            permissionPreset: args.permission ?? 'read-only',
          }, exec.signal)
          return json({ ok: true, automation: value })
        } catch (error: unknown) {
          if (exec.signal.aborted) return json({ ok: false, code: 'cancelled' })
          return json({ ok: false, code: 'invalid_automation', message: error instanceof Error ? error.message : String(error) })
        }
      },
      presentCall: (args: CreateArgs) => present('Create automation', 'other', args.name),
    }))

    register(defineTool({
      name: 'automation_list',
      description: 'List durable standalone automations and recent run history for this exact workspace.',
      parameters: {},
      output: JSON_OUTPUT,
      async execute(_args: Record<string, never>, exec: ToolRunContext) {
        if (exec.signal.aborted) return json({ ok: false, code: 'cancelled' })
        try {
          return json({ ok: true, value: await service.snapshot(scopeFor(exec), exec.signal) })
        } catch (error: unknown) {
          if (exec.signal.aborted) return json({ ok: false, code: 'cancelled' })
          return json({ ok: false, code: 'automation_error', message: error instanceof Error ? error.message : String(error) })
        }
      },
      presentCall: () => present('List automations', 'read'),
    }))

    register(defineTool({
      name: 'automation_update',
      description: 'Update an existing automation in this workspace instead of creating a duplicate. Omitted fields stay unchanged; setting provider and model to null follows the live global default. A replacement schedule requires kind and its matching fields. Resuming starts from future occurrences and does not replay an old backlog.',
      parameters: {
        id: { type: 'string', required: true },
        name: { type: 'string' },
        prompt: { type: 'string' },
        status: { type: 'string', enum: ['active', 'paused'] },
        kind: { type: 'string', enum: ['once', 'interval', 'daily', 'weekly'] },
        time_zone: { type: 'string' },
        at: { type: 'string' },
        every_minutes: { type: 'integer' },
        time: { type: 'string' },
        weekdays: { type: 'array', items: { type: 'string', enum: WEEKDAYS } },
        provider: { ...NULLABLE_STRING, description: 'Replacement provider route. Set provider and model to null to follow the live global default.' },
        model: { ...NULLABLE_STRING, description: 'Replacement provider-owned model id. Must be supplied together with provider.' },
        reasoning_effort: { ...NULLABLE_STRING, description: 'Replacement adapter-owned effort id. Null uses the pinned model default.' },
        permission: { type: 'string', enum: ['read-only', 'workspace-write'] },
      },
      output: JSON_OUTPUT,
      async execute(args: UpdateArgs, exec: ToolRunContext) {
        if (exec.signal.aborted) return json({ ok: false, code: 'cancelled' })
        try {
          validateScheduleSelector(args)
          validateModelSelector(args, false)
          const input: {
            name?: string
            prompt?: string
            status?: 'active' | 'paused'
            schedule?: AutomationSchedule
            provider?: string | null
            model?: string | null
            reasoningEffort?: string | null
            permissionPreset?: PermissionPreset
          } = {}
          if (args.name !== undefined) input.name = String(args.name)
          if (args.prompt !== undefined) input.prompt = String(args.prompt)
          if (args.status !== undefined) input.status = args.status as 'active' | 'paused'
          if (args.provider !== undefined) input.provider = args.provider
          if (args.model !== undefined) input.model = args.model
          if (args.reasoning_effort !== undefined) input.reasoningEffort = args.reasoning_effort
          if (args.permission !== undefined) input.permissionPreset = args.permission as PermissionPreset
          if (args.kind !== undefined) input.schedule = scheduleFromArgs(args, new Date().toISOString())
          if (Object.keys(input).length === 0) throw new Error('automation_update requires at least one changed field')
          const value = await service.update(scopeFor(exec), args.id, input, exec.signal)
          return json({ ok: true, automation: value })
        } catch (error: unknown) {
          if (exec.signal.aborted) return json({ ok: false, code: 'cancelled' })
          return json({ ok: false, code: 'automation_error', message: error instanceof Error ? error.message : String(error) })
        }
      },
      presentCall: (args: UpdateArgs) => present('Update automation', 'other', args.id),
    }))

    register(defineTool({
      name: 'automation_runs',
      description: 'Read the bounded durable run history for automations in this exact workspace, including failures, skips, summaries, and result session IDs.',
      parameters: {},
      output: JSON_OUTPUT,
      async execute(_args: Record<string, never>, exec: ToolRunContext) {
        if (exec.signal.aborted) return json({ ok: false, code: 'cancelled' })
        try {
          const snapshot = await service.snapshot(scopeFor(exec), exec.signal)
          return json({ ok: true, generatedAt: snapshot.generatedAt, runs: snapshot.runs })
        } catch (error: unknown) {
          if (exec.signal.aborted) return json({ ok: false, code: 'cancelled' })
          return json({ ok: false, code: 'automation_error', message: error instanceof Error ? error.message : String(error) })
        }
      },
      presentCall: () => present('Read automation runs', 'read'),
    }))

    register(defineTool({
      name: 'automation_run_now',
      description: 'Queue one manual run of an existing standalone automation. The run still uses a fresh session and the automation permission boundary.',
      parameters: { id: { type: 'string', required: true } },
      output: JSON_OUTPUT,
      async execute(args: IdArgs, exec: ToolRunContext) {
        if (exec.signal.aborted) return json({ ok: false, code: 'cancelled' })
        try {
          return json({ ok: true, run: await service.runNow(scopeFor(exec), args.id, {}, exec.signal) })
        } catch (error: unknown) {
          if (exec.signal.aborted) return json({ ok: false, code: 'cancelled' })
          return json({ ok: false, code: 'automation_error', message: error instanceof Error ? error.message : String(error) })
        }
      },
      presentCall: (args: IdArgs) => present('Run automation now', 'other', args.id),
    }))

    register(defineTool({
      name: 'automation_delete',
      description: 'Delete an automation definition from this workspace while retaining its run history for audit.',
      parameters: { id: { type: 'string', required: true } },
      output: JSON_OUTPUT,
      async execute(args: IdArgs, exec: ToolRunContext) {
        if (exec.signal.aborted) return json({ ok: false, code: 'cancelled' })
        try {
          return json({ ok: true, value: await service.delete(scopeFor(exec), args.id, exec.signal) })
        } catch (error: unknown) {
          if (exec.signal.aborted) return json({ ok: false, code: 'cancelled' })
          return json({ ok: false, code: 'automation_error', message: error instanceof Error ? error.message : String(error) })
        }
      },
      presentCall: (args: IdArgs) => present('Delete automation', 'other', args.id),
    }))
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { normalizeSchedule, scheduleToRRule } from './recurrence.ts'
import type {
  AutomationDefinition, AutomationRun, AutomationSchedule, CreateAutomationInput,
  DeleteAutomationPlan, UpdateAutomationInput,
} from './types.ts'

const nonBlank = z.string().trim().min(1)
const opaqueNonBlank = z.string().refine(value => value.trim() !== '', 'must not be blank')
const instant = z.string().datetime({ offset: true })
const timeZone = nonBlank
const weekday = z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])
export const automationScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: instant, timeZone }),
  z.object({ kind: z.literal('interval'), everyMinutes: z.number().int().min(5), anchor: instant, timeZone }),
  z.object({ kind: z.literal('daily'), time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), timeZone }),
  z.object({
    kind: z.literal('weekly'),
    weekdays: z.array(weekday).min(1),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    timeZone,
  }),
])

const permissionPreset = z.enum(['read-only', 'workspace-write'])
const creator = z.object({ kind: z.enum(['agent', 'web']), sessionId: nonBlank })
const modelTarget = {
  provider: opaqueNonBlank.nullable().default(null),
  model: opaqueNonBlank.nullable().default(null),
  reasoningEffort: opaqueNonBlank.nullable().default(null),
} as const

function validateModelTarget(
  value: { readonly provider: string | null; readonly model: string | null; readonly reasoningEffort: string | null },
  ctx: z.core.$RefinementCtx,
): void {
  if ((value.provider === null) !== (value.model === null)) {
    ctx.addIssue({
      code: 'custom',
      message: 'provider and model must both be set or both be null',
      path: value.provider === null ? ['provider'] : ['model'],
    })
  }
  if (value.reasoningEffort !== null && (value.provider === null || value.model === null)) {
    ctx.addIssue({
      code: 'custom',
      message: 'reasoningEffort requires a pinned provider and model',
      path: ['reasoningEffort'],
    })
  }
}

const targetSnapshot = z.object({
  workspaceId: nonBlank,
  cwd: nonBlank,
  agentPreset: nonBlank,
  ...modelTarget,
  permissionPreset,
}).superRefine(validateModelTarget)

export const automationDefinitionSchema: z.ZodType<AutomationDefinition> = z.object({
  version: z.literal(1),
  id: nonBlank,
  revision: z.number().int().positive(),
  name: nonBlank,
  prompt: nonBlank,
  status: z.enum(['active', 'paused']),
  schedule: automationScheduleSchema,
  rrule: nonBlank,
  timeZone,
  workspaceId: nonBlank,
  cwd: nonBlank,
  agentPreset: nonBlank,
  ...modelTarget,
  permissionPreset,
  createdBy: creator,
  createdAt: instant,
  updatedAt: instant,
}).superRefine((value, ctx) => {
  try {
    if (value.timeZone !== value.schedule.timeZone) {
      ctx.addIssue({ code: 'custom', message: 'timeZone must match schedule.timeZone', path: ['timeZone'] })
    }
    if (value.rrule !== scheduleToRRule(value.schedule)) {
      ctx.addIssue({ code: 'custom', message: 'rrule must be derived from schedule', path: ['rrule'] })
    }
    validateModelTarget(value, ctx)
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: String(error), path: ['schedule'] })
  }
})

export const automationRunSchema: z.ZodType<AutomationRun> = z.object({
  version: z.literal(1),
  id: nonBlank,
  automationId: nonBlank,
  definitionRevision: z.number().int().positive(),
  occurrenceKey: nonBlank,
  trigger: z.enum(['schedule', 'manual']),
  scheduledFor: instant,
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'skipped', 'cancelled']),
  promptSnapshot: nonBlank,
  targetSnapshot,
  sessionId: z.string().nullable(),
  startedAt: instant.nullable(),
  finishedAt: instant.nullable(),
  summary: z.string().nullable(),
  error: z.object({ code: nonBlank, message: nonBlank }).nullable(),
  unread: z.boolean(),
  reviewedAt: instant.nullable().optional(),
  replacesScheduledFor: instant.nullable().optional(),
})

// `defineDomain()` and `domainTable()` are identity helpers in DSH. Keeping the
// declaration as a plain spec avoids making this public repository depend on a
// private DSH package merely to run its pure domain tests; the Host validates
// the same zod schemas when it opens the domain.
export const automationDomainSpec = {
  name: 'dsh_automation',
  version: 1,
  tables: {
    definitions: { valueSchema: automationDefinitionSchema },
    runs: { valueSchema: automationRunSchema },
  },
} as const

export function createDefinition(input: CreateAutomationInput): AutomationDefinition {
  const schedule = normalizeSchedule(input.schedule)
  const now = parseInstant(input.now, 'now')
  return automationDefinitionSchema.parse({
    version: 1,
    id: requireNonBlank(input.id, 'id'),
    revision: 1,
    name: requireNonBlank(input.name, 'name'),
    prompt: requireNonBlank(input.prompt, 'prompt'),
    status: 'active',
    schedule,
    rrule: scheduleToRRule(schedule),
    timeZone: schedule.timeZone,
    workspaceId: requireNonBlank(input.workspaceId, 'workspaceId'),
    cwd: requireNonBlank(input.cwd, 'cwd'),
    agentPreset: requireNonBlank(input.agentPreset, 'agentPreset'),
    provider: input.provider ?? null,
    model: input.model ?? null,
    reasoningEffort: input.reasoningEffort ?? null,
    permissionPreset: input.permissionPreset ?? 'read-only',
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  })
}

export function updateDefinition(
  current: AutomationDefinition,
  input: UpdateAutomationInput,
): AutomationDefinition {
  const validated = automationDefinitionSchema.parse(current)
  const providerChanged = input.provider !== undefined
  const modelChanged = input.model !== undefined
  if (providerChanged !== modelChanged) throw new Error('provider and model must be updated together')
  const provider = providerChanged ? input.provider! : validated.provider
  const model = modelChanged ? input.model! : validated.model
  const routeChanged = provider !== validated.provider || model !== validated.model
  const reasoningEffort = input.reasoningEffort === undefined
    ? routeChanged ? null : validated.reasoningEffort
    : input.reasoningEffort
  const schedule = normalizeSchedule(input.schedule ?? validated.schedule)
  return automationDefinitionSchema.parse({
    ...validated,
    revision: validated.revision + 1,
    name: input.name === undefined ? validated.name : requireNonBlank(input.name, 'name'),
    prompt: input.prompt === undefined ? validated.prompt : requireNonBlank(input.prompt, 'prompt'),
    status: input.status ?? validated.status,
    schedule,
    rrule: scheduleToRRule(schedule),
    timeZone: schedule.timeZone,
    agentPreset: input.agentPreset === undefined
      ? validated.agentPreset
      : requireNonBlank(input.agentPreset, 'agentPreset'),
    provider,
    model,
    reasoningEffort,
    permissionPreset: input.permissionPreset ?? validated.permissionPreset,
    updatedAt: parseInstant(input.now, 'now'),
  })
}

export function pauseDefinition(current: AutomationDefinition, now: string): AutomationDefinition {
  return setStatus(current, 'paused', now)
}

export function resumeDefinition(current: AutomationDefinition, now: string): AutomationDefinition {
  return setStatus(current, 'active', now)
}

export function deleteDefinition(current: AutomationDefinition): DeleteAutomationPlan {
  automationDefinitionSchema.parse(current)
  return { id: current.id, preserveRunHistory: true }
}

export function occurrenceKey(
  automationId: string,
  definitionRevision: number,
  scheduledFor: string,
): string {
  return `${requireNonBlank(automationId, 'automationId')}:${positiveInteger(definitionRevision, 'definitionRevision')}:${parseInstant(scheduledFor, 'scheduledFor')}`
}

export function runIdForOccurrence(key: string): string {
  return `run_${createHash('sha256').update(requireNonBlank(key, 'occurrenceKey')).digest('hex').slice(0, 32)}`
}

export function createScheduledRun(definition: AutomationDefinition, scheduledFor: string): AutomationRun {
  automationDefinitionSchema.parse(definition)
  const normalizedInstant = parseInstant(scheduledFor, 'scheduledFor')
  const key = occurrenceKey(definition.id, definition.revision, normalizedInstant)
  return queuedRun(definition, normalizedInstant, 'schedule', key, runIdForOccurrence(key))
}

export function createManualRun(
  definition: AutomationDefinition,
  scheduledFor: string,
  nonce: string = randomUUID(),
  replacesScheduledFor?: string | null,
): AutomationRun {
  automationDefinitionSchema.parse(definition)
  const normalizedInstant = parseInstant(scheduledFor, 'scheduledFor')
  const key = `manual:${definition.id}:${requireNonBlank(nonce, 'nonce')}`
  return queuedRun(definition, normalizedInstant, 'manual', key, runIdForOccurrence(key), replacesScheduledFor)
}

function setStatus(
  current: AutomationDefinition,
  status: AutomationDefinition['status'],
  now: string,
): AutomationDefinition {
  automationDefinitionSchema.parse(current)
  if (current.status === status) return current
  return automationDefinitionSchema.parse({
    ...current,
    status,
    revision: current.revision + 1,
    updatedAt: parseInstant(now, 'now'),
  })
}

function queuedRun(
  definition: AutomationDefinition,
  scheduledFor: string,
  trigger: AutomationRun['trigger'],
  key: string,
  id: string,
  replacesScheduledFor?: string | null,
): AutomationRun {
  return automationRunSchema.parse({
    version: 1,
    id,
    automationId: definition.id,
    definitionRevision: definition.revision,
    occurrenceKey: key,
    trigger,
    scheduledFor,
    status: 'queued',
    promptSnapshot: definition.prompt,
    targetSnapshot: {
      workspaceId: definition.workspaceId,
      cwd: definition.cwd,
      agentPreset: definition.agentPreset,
      provider: definition.provider,
      model: definition.model,
      reasoningEffort: definition.reasoningEffort,
      permissionPreset: definition.permissionPreset,
    },
    sessionId: null,
    startedAt: null,
    finishedAt: null,
    summary: null,
    error: null,
    unread: true,
    replacesScheduledFor: replacesScheduledFor ?? null,
  })
}

function requireNonBlank(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new Error(`${field} must not be blank`)
  return trimmed
}

function parseInstant(value: string, field: string): string {
  const result = instant.safeParse(value)
  if (!result.success) throw new Error(`${field} must be an ISO-8601 instant with an explicit offset`)
  return new Date(result.data).toISOString()
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`)
  return value
}

export type { AutomationSchedule }

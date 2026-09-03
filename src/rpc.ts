/** Loopback-only Host RPC adapter for the Automation Web client. */

import type { AutomationService } from './service.ts'
import type { AutomationSchedule as DomainSchedule, Weekday } from './types.ts'

const WEEKDAYS: readonly Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

interface RpcContext {
  readonly connection: {
    readonly rpc: {
      handle(
        channel: string,
        handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>,
        options: { readonly authority: 'loopback' | 'trusted-host' },
      ): () => Promise<void>
    }
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
  return value
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : string(value, label)
}

function optionalNullableString(value: unknown, label: string): string | null | undefined {
  if (value === undefined || value === null) return value
  return string(value, label)
}

function modelFields(
  input: Record<string, unknown>,
  create: boolean,
): { readonly provider?: string | null; readonly model?: string | null; readonly reasoningEffort?: string | null } {
  const provider = optionalNullableString(input.provider, 'input.provider')
  const model = optionalNullableString(input.model, 'input.model')
  const reasoningEffort = optionalNullableString(input.reasoningEffort, 'input.reasoningEffort')
  const providerSpecified = provider !== undefined
  const modelSpecified = model !== undefined
  if (providerSpecified !== modelSpecified) throw new Error('input.provider and input.model must be provided together')
  if (providerSpecified && ((provider === null) !== (model === null))) {
    throw new Error('input.provider and input.model must both be strings or both be null')
  }
  if (reasoningEffort !== undefined && reasoningEffort !== null && providerSpecified && provider === null) {
    throw new Error('input.reasoningEffort requires a pinned provider and model')
  }
  if (create && reasoningEffort !== undefined && !providerSpecified) {
    throw new Error('input.reasoningEffort requires an explicit provider and model')
  }
  return {
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  }
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label} must be an integer`)
  return value
}

function positiveInteger(value: unknown, label: string): number {
  const result = integer(value, label)
  if (result < 1) throw new Error(`${label} must be a positive integer`)
  return result
}

function toDomainSchedule(raw: unknown, timeZone: string): DomainSchedule {
  const schedule = record(raw, 'schedule')
  const kind = string(schedule.kind, 'schedule.kind')
  switch (kind) {
    case 'once':
      return { kind, at: string(schedule.at, 'schedule.at'), timeZone }
    case 'interval': {
      const everyMinutes = integer(schedule.everyMinutes, 'schedule.everyMinutes')
      return {
        kind,
        everyMinutes,
        anchor: optionalString(schedule.anchor, 'schedule.anchor') ?? new Date().toISOString(),
        timeZone,
      }
    }
    case 'daily':
      return { kind, time: string(schedule.time, 'schedule.time'), timeZone }
    case 'weekly': {
      if (!Array.isArray(schedule.weekdays)) throw new Error('schedule.weekdays must be an array')
      const weekdays = schedule.weekdays.map((value) => {
        const number = integer(value, 'schedule.weekdays[]')
        const weekday = WEEKDAYS[number - 1]
        if (weekday === undefined) throw new Error('schedule.weekdays must contain numbers from 1 to 7')
        return weekday
      })
      return { kind, time: string(schedule.time, 'schedule.time'), weekdays, timeZone }
    }
    default:
      throw new Error('schedule.kind must be once, interval, daily, or weekly')
  }
}

function toClientSchedule(schedule: DomainSchedule): Record<string, unknown> {
  if (schedule.kind !== 'weekly') return { ...schedule }
  return {
    ...schedule,
    weekdays: schedule.weekdays.map(day => WEEKDAYS.indexOf(day) + 1),
  }
}

function errorResult(
  error: unknown,
  aborted = false,
): { readonly ok: false; readonly error: Record<string, unknown> } {
  if (aborted) {
    return {
      ok: false,
      error: { code: 'cancelled', message: 'The automation request was cancelled.', details: {} },
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  const badRequest = /must|required|unknown automation|another workspace|scheduled in the future|already has a queued or running run|still queued or running|has no Session|not registered|requires a live source session|requires an explicit provider|requires a pinned provider|has no workspace|request was cancelled|changed since it was read|changed since it was opened/.test(message)
  return {
    ok: false,
    error: {
      code: badRequest ? 'bad-request' : 'internal',
      message,
      details: badRequest ? { issues: [] } : {},
    },
  }
}

function scopeOf(payload: Record<string, unknown>) {
  return { sessionId: string(payload.sessionId, 'sessionId'), creatorKind: 'web' as const }
}

async function snapshotValue(service: AutomationService, payload: Record<string, unknown>, signal: AbortSignal) {
  const snapshot = await service.snapshot(scopeOf(payload), signal)
  const names = new Map(snapshot.definitions.map(definition => [definition.id, definition.name]))
  return {
    scope: {
      workspaceId: snapshot.workspace.id,
      workspaceName: snapshot.workspace.title,
      cwd: snapshot.workspace.path,
    },
    automations: snapshot.definitions.map(definition => ({
      id: definition.id,
      revision: definition.revision,
      name: definition.name,
      prompt: definition.prompt,
      status: definition.status,
      schedule: toClientSchedule(definition.schedule),
      // Kept for wire compatibility; the Client localizes the structured schedule.
      scheduleSummary: definition.rrule,
      timeZone: definition.timeZone,
      provider: definition.provider,
      model: definition.model,
      reasoningEffort: definition.reasoningEffort,
      permission: definition.permissionPreset,
      ...(definition.nextRunAt === null ? {} : { nextRunAt: definition.nextRunAt }),
      ...(definition.lastRun === null ? {} : {
        lastRunAt: definition.lastRun.finishedAt ?? definition.lastRun.startedAt ?? definition.lastRun.scheduledFor,
        lastRunStatus: definition.lastRun.status,
      }),
      createdAt: definition.createdAt,
      updatedAt: definition.updatedAt,
    })),
    runs: snapshot.runs.map(run => ({
      id: run.id,
      automationId: run.automationId,
      automationName: names.get(run.automationId) ?? 'Deleted automation',
      status: run.status,
      trigger: run.trigger,
      scheduledFor: run.scheduledFor,
      ...(run.startedAt === null ? {} : { startedAt: run.startedAt }),
      ...(run.finishedAt === null ? {} : { finishedAt: run.finishedAt }),
      ...(run.sessionId === null ? {} : { sessionId: run.sessionId }),
      sessionArchived: run.sessionArchived,
      ...(run.summary === null ? {} : { summary: run.summary }),
      ...(run.error === null ? {} : { error: run.error.message }),
      unread: run.unread,
      // Durable re-add source: the prompt and model/permission target captured
      // when the run started, so a deleted automation can still be rebuilt.
      promptSnapshot: run.promptSnapshot,
      provider: run.targetSnapshot.provider,
      model: run.targetSnapshot.model,
      reasoningEffort: run.targetSnapshot.reasoningEffort,
      permission: run.targetSnapshot.permissionPreset,
    })),
    settings: service.settings(),
    serverNow: snapshot.generatedAt,
  }
}

/** Register the channel as loopback-only because it controls unattended writes. */
export function registerAutomationRpc(ctx: RpcContext, service: AutomationService): () => Promise<void> {
  return ctx.connection.rpc.handle('/dsh-automation', async (endpoint, rawPayload, signal) => {
    try {
      if (signal.aborted) throw new Error('The request was cancelled.')
      const payload = record(rawPayload, 'payload')
      switch (endpoint) {
        case 'snapshot':
          return { ok: true, value: await snapshotValue(service, payload, signal) }
        case 'create': {
          const input = record(payload.input, 'input')
          const timeZone = string(input.timeZone, 'input.timeZone')
          const target = modelFields(input, true)
          const permission = input.permission === undefined ? 'read-only' : string(input.permission, 'input.permission')
          if (permission !== 'read-only' && permission !== 'workspace-write') {
            throw new Error('input.permission must be read-only or workspace-write')
          }
          const value = await service.create(scopeOf(payload), {
            name: string(input.name, 'input.name'),
            prompt: string(input.prompt, 'input.prompt'),
            schedule: toDomainSchedule(input.schedule, timeZone),
            ...target,
            permissionPreset: permission,
          }, signal)
          return { ok: true, value: { id: value.id, revision: value.revision } }
        }
        case 'update': {
          const id = string(payload.automationId, 'automationId')
          const input = record(payload.input, 'input')
          const value: {
            expectedRevision: number
            name?: string
            prompt?: string
            schedule?: DomainSchedule
            provider?: string | null
            model?: string | null
            reasoningEffort?: string | null
            permissionPreset?: 'read-only' | 'workspace-write'
          } = {
            expectedRevision: positiveInteger(payload.expectedRevision, 'expectedRevision'),
          }
          if (input.name !== undefined) value.name = string(input.name, 'input.name')
          if (input.prompt !== undefined) value.prompt = string(input.prompt, 'input.prompt')
          Object.assign(value, modelFields(input, false))
          if (input.schedule !== undefined) {
            const timeZone = string(input.timeZone, 'input.timeZone')
            value.schedule = toDomainSchedule(input.schedule, timeZone)
          } else if (input.timeZone !== undefined) {
            throw new Error('input.timeZone requires input.schedule')
          }
          if (input.permission !== undefined) {
            const permission = string(input.permission, 'input.permission')
            if (permission !== 'read-only' && permission !== 'workspace-write') {
              throw new Error('input.permission must be read-only or workspace-write')
            }
            value.permissionPreset = permission
          }
          const updated = await service.update(scopeOf(payload), id, value, signal)
          return { ok: true, value: { id: updated.id, revision: updated.revision } }
        }
        case 'mutate': {
          const id = string(payload.automationId, 'automationId')
          const mutation = string(payload.mutation, 'mutation')
          if (mutation === 'delete') {
            return { ok: true, value: await service.delete(scopeOf(payload), id, signal) }
          }
          if (mutation !== 'pause' && mutation !== 'resume') {
            throw new Error('mutation must be pause, resume, or delete')
          }
          const value = await service.update(scopeOf(payload), id, {
            status: mutation === 'pause' ? 'paused' : 'active',
          }, signal)
          return { ok: true, value: { id: value.id, revision: value.revision } }
        }
        case 'run-now': {
          const mode = optionalString(payload.mode, 'mode')
          if (mode !== undefined && mode !== 'plain' && mode !== 'ahead') {
            throw new Error('mode must be plain or ahead')
          }
          const run = await service.runNow(
            scopeOf(payload),
            string(payload.automationId, 'automationId'),
            { replaceNext: mode === 'ahead' },
            signal,
          )
          return { ok: true, value: { runId: run.id } }
        }
        case 'mark-read': {
          const run = await service.markRead(scopeOf(payload), string(payload.runId, 'runId'), signal)
          return { ok: true, value: { runId: run.id, unread: run.unread } }
        }
        case 'archive-run': {
          const run = await service.archiveRun(scopeOf(payload), string(payload.runId, 'runId'), signal)
          return { ok: true, value: { runId: run.id, sessionArchived: true } }
        }
        case 'delete-run': {
          const value = await service.deleteRun(scopeOf(payload), string(payload.runId, 'runId'), signal)
          return { ok: true, value }
        }
        case 'settings-update': {
          const settings = record(payload.settings, 'settings')
          const catchUpMissedRuns = settings.catchUpMissedRuns
          if (typeof catchUpMissedRuns !== 'boolean') {
            throw new Error('settings.catchUpMissedRuns must be a boolean')
          }
          const catchUpMissedRunsMax = integer(settings.catchUpMissedRunsMax, 'settings.catchUpMissedRunsMax')
          if (catchUpMissedRunsMax < 1 || catchUpMissedRunsMax > 1_000) {
            throw new Error('settings.catchUpMissedRunsMax must be between 1 and 1000')
          }
          const misfireGraceMinutes = integer(settings.misfireGraceMinutes, 'settings.misfireGraceMinutes')
          if (misfireGraceMinutes < 0 || misfireGraceMinutes > 525_600) {
            throw new Error('settings.misfireGraceMinutes must be between 0 and 525600')
          }
          const value = await service.updateSettings(scopeOf(payload), {
            catchUpMissedRuns,
            catchUpMissedRunsMax,
            misfireGraceMinutes,
          }, signal)
          return { ok: true, value: { settings: value } }
        }
        default:
          throw new Error(`unknown automation endpoint '${endpoint}'`)
      }
    } catch (error) {
      return errorResult(error, signal.aborted)
    }
  }, { authority: 'loopback' })
}

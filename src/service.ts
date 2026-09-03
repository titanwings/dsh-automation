/** Durable automation authority: definitions, occurrence claims, clock, and run execution. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-workspace'
import {
  automationDomainSpec,
  createDefinition,
  createManualRun,
  createScheduledRun,
  deleteDefinition,
  updateDefinition,
} from './domain.ts'
import { executeAutomationRun } from './executor.ts'
import { latestDueOccurrence, nextOccurrence, occurrencesBetween } from './recurrence.ts'
import type {
  AutomationDefinition,
  AutomationRun,
  AutomationSchedule,
  PermissionPreset,
  UpdateAutomationInput,
} from './types.ts'

const MAX_TIMER_DELAY_MS = 2_147_483_647
export const AUTOMATION_SESSION_PREFIX = 'dsh-automation-session-'

export interface AutomationConfig {
  readonly maxConcurrentRuns: number
  readonly runTimeoutMs: number
  readonly misfireGraceMs: number
  readonly historyLimit: number
  readonly archiveRunSessions: boolean
  /** Replay missed occurrences after a host resume instead of skipping stale ones. */
  readonly catchUpMissedRuns: boolean
  /** Backlog cap per automation when catchUpMissedRuns is enabled (most recent occurrences win). */
  readonly catchUpMissedRunsMax: number
}

/** Durable host-wide policy, layered over the cordis config defaults. */
export interface AutomationSettings {
  readonly catchUpMissedRuns: boolean
  readonly catchUpMissedRunsMax: number
  readonly misfireGraceMinutes: number
}

/** Minimal shape of the `ctx.settings` namespace owner the service consumes. */
export interface AutomationSettingsOwner {
  get(): Readonly<AutomationSettings>
  update(next: AutomationSettings): Promise<unknown>
}

export interface CreateRequest {
  readonly name: string
  readonly prompt: string
  readonly schedule: AutomationSchedule
  readonly provider?: string | null
  readonly model?: string | null
  readonly reasoningEffort?: string | null
  readonly permissionPreset?: PermissionPreset
}

export interface AutomationScope {
  readonly sessionId: string
  readonly creatorKind: 'agent' | 'web'
}

export interface AutomationSnapshot {
  readonly generatedAt: string
  readonly workspace: { readonly id: string; readonly title: string; readonly path: string }
  readonly definitions: readonly AutomationDefinitionView[]
  readonly runs: readonly AutomationRunView[]
}

export interface AutomationDefinitionView extends AutomationDefinition {
  readonly nextRunAt: string | null
  readonly lastRun: AutomationRun | null
}

export interface AutomationRunView extends AutomationRun {
  readonly sessionArchived: boolean
}

interface SessionEventLike {
  readonly type: string
  readonly data: unknown
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toIso(ms = Date.now()): string {
  return new Date(ms).toISOString()
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new Error('The automation request was cancelled.')
}

function compareRuns(left: AutomationRun, right: AutomationRun): number {
  return Date.parse(right.scheduledFor) - Date.parse(left.scheduledFor)
    || right.id.localeCompare(left.id)
}

/** One host-lifetime service. Timer state is disposable; domain records are authority. */
export class AutomationService {
  private definitions!: KvTable<string, AutomationDefinition>
  private runs!: KvTable<string, AutomationRun>
  private timer: ReturnType<typeof setTimeout> | undefined
  private operationTail: Promise<void> = Promise.resolve()
  private pumpScheduled = false
  private requested = false
  private started = false
  private stopping = false
  private readonly active = new Map<string, { readonly abort: AbortController; readonly promise: Promise<void> }>()

  private constructor(
    private readonly ctx: Context,
    private readonly domain: Domain<typeof automationDomainSpec>,
    private readonly config: AutomationConfig,
  ) {}

  private settingsOwner: AutomationSettingsOwner | undefined

  /**
   * Bind the durable `ctx.settings` namespace owner (registered by the plugin
   * entry) so runtime policy changes survive restarts. Without an owner the
   * cordis config values remain the effective policy, which keeps the service
   * usable in isolation (tests, missing settings provider).
   */
  attachSettings(owner: AutomationSettingsOwner): void {
    this.settingsOwner = owner
  }

  /** Effective host-wide policy: the settings namespace when attached, else config defaults. */
  settings(): Readonly<AutomationSettings> {
    const owner = this.settingsOwner
    if (owner !== undefined) return owner.get()
    return {
      catchUpMissedRuns: this.config.catchUpMissedRuns,
      catchUpMissedRunsMax: this.config.catchUpMissedRunsMax,
      misfireGraceMinutes: Math.round(this.config.misfireGraceMs / 60_000),
    }
  }

  /** Persist a new host-wide policy through the settings namespace. */
  async updateSettings(scope: AutomationScope, next: AutomationSettings, signal?: AbortSignal): Promise<AutomationSettings> {
    return this.serialize(async () => {
      await this.resolveScope(scope)
      throwIfCancelled(signal)
      const owner = this.settingsOwner
      if (owner === undefined) throw new Error('The settings namespace is unavailable.')
      await owner.update(next)
      return owner.get()
    }, signal)
  }

  static async open(ctx: Context, config: AutomationConfig): Promise<AutomationService> {
    const domain = await ctx.storageDomain.open(automationDomainSpec)
    try {
      const service = new AutomationService(ctx, domain, config)
      service.definitions = domain.table('definitions') as KvTable<string, AutomationDefinition>
      service.runs = domain.table('runs') as KvTable<string, AutomationRun>
      await service.recoverInterruptedRuns()
      await service.flagLegacyProblemRuns()
      await service.archiveTerminalRunSessions()
      await service.pruneAllHistory()
      return service
    } catch (error) {
      await domain.close().catch(() => {})
      throw error
    }
  }

  /** Start the disposable clock only after the surrounding Loader has settled. */
  start(): void {
    if (this.started || this.stopping) return
    this.started = true
    this.requestPump()
  }

  /**
   * Automation-created sessions must never receive management tools. The run
   * table covers live/new sessions; durable message provenance covers an old
   * session even after its bounded run record has been pruned.
   */
  ownsSession(sessionId: string, events: readonly SessionEventLike[] = []): boolean {
    if (sessionId.startsWith(AUTOMATION_SESSION_PREFIX)) return true
    if ([...this.runs.entries()].some(([, run]) => run.sessionId === sessionId)) return true
    return events.some((event) => {
      if (event.type !== 'user/message' || typeof event.data !== 'object' || event.data === null) return false
      const source = (event.data as { readonly source?: unknown }).source
      return typeof source === 'object' && source !== null
        && (source as { readonly kind?: unknown }).kind === 'automation'
    })
  }

  async dispose(): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    this.requested = false
    this.clearTimer()
    // A pump that was already admitted may be between durable writes. Drain
    // it before taking the active-run snapshot so no late run escapes abort.
    await this.operationTail.catch(() => {})
    for (const { abort } of this.active.values()) abort.abort()
    await Promise.allSettled([...this.active.values()].map(value => value.promise))
    await this.domain.close()
  }

  async snapshot(scope: AutomationScope, signal?: AbortSignal): Promise<AutomationSnapshot> {
    return this.serialize(async () => {
      const resolved = await this.resolveScope(scope)
      throwIfCancelled(signal)
      const definitions = [...this.definitions.entries()]
        .map(([, definition]) => definition)
        .filter(definition => definition.workspaceId === resolved.workspace.id)
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      const workspaceRuns = [...this.runs.entries()]
        .map(([, run]) => run)
        .filter(run => run.targetSnapshot.workspaceId === resolved.workspace.id)
        .sort(compareRuns)
      const archivedSessionIds = new Set(this.ctx.workspaceRegistry.archivedSessionIds.map(String))
      const runs = workspaceRuns.slice(0, this.config.historyLimit).map((run): AutomationRunView => ({
        ...run,
        sessionArchived: run.sessionId !== null && archivedSessionIds.has(run.sessionId),
      }))
      const generatedAt = toIso()
      return {
        generatedAt,
        workspace: resolved.workspace,
        definitions: definitions.map((definition) => {
          const related = workspaceRuns.filter(run => run.automationId === definition.id)
          // Occurrences already fulfilled by a succeeded "run ahead"/launch run
          // are not pending: skip them when deriving the next run time.
          let nextRunAt: string | null = nextOccurrence(definition.schedule, generatedAt)
          while (nextRunAt !== null && related.some(run => (
            run.status === 'succeeded' && run.replacesScheduledFor === nextRunAt
          ))) {
            nextRunAt = nextOccurrence(definition.schedule, nextRunAt)
          }
          return {
            ...definition,
            nextRunAt,
            // workspaceRuns is sorted newest-first, so the first match is the latest run.
            lastRun: related[0] ?? null,
          }
        }),
        runs,
      }
    }, signal)
  }

  async create(scope: AutomationScope, request: CreateRequest, signal?: AbortSignal): Promise<AutomationDefinition> {
    const definition = await this.serialize(async () => {
      const resolved = await this.resolveScope(scope)
      throwIfCancelled(signal)
      const now = toIso()
      if (request.schedule.kind === 'once' && nextOccurrence(request.schedule, now) === null) {
        throw new Error('A one-time automation must be scheduled in the future.')
      }
      const providerSpecified = request.provider !== undefined
      const modelSpecified = request.model !== undefined
      if (providerSpecified !== modelSpecified) throw new Error('provider and model must be provided together')
      if (!providerSpecified && request.reasoningEffort !== undefined) {
        throw new Error('reasoningEffort requires an explicit provider and model')
      }
      // Backward compatibility: an omitted pair captures the source Session's
      // complete selection. An explicit null pair is the durable live-default marker.
      const inheritedSelection = resolved.agent.session.requestHeader()?.config
        ?? this.ctx.agentDefaultModel.currentSelection()
      const selection = providerSpecified
        ? {
            provider: request.provider!,
            model: request.model!,
            reasoningEffort: request.reasoningEffort ?? null,
          }
        : {
            provider: inheritedSelection.provider,
            model: inheritedSelection.model,
            reasoningEffort: inheritedSelection.reasoningEffort ?? null,
          }
      const agentPreset = this.ctx.agentPresets.composedPreset(resolved.agent.ctx)
        ?? resolved.agent.session.header.agentPreset
        ?? 'standard'
      const value = createDefinition({
        id: `automation_${randomUUID()}`,
        name: request.name,
        prompt: request.prompt,
        schedule: request.schedule,
        workspaceId: resolved.workspace.id,
        cwd: resolved.workspace.path,
        agentPreset,
        provider: selection.provider,
        model: selection.model,
        reasoningEffort: selection.reasoningEffort,
        permissionPreset: request.permissionPreset ?? 'read-only',
        createdBy: { kind: scope.creatorKind, sessionId: scope.sessionId },
        now,
      })
      await this.definitions.put(value.id, value)
      return value
    }, signal)
    this.requestPump()
    return definition
  }

  async update(
    scope: AutomationScope,
    id: string,
    input: Omit<UpdateAutomationInput, 'now'> & {
      readonly status?: 'active' | 'paused'
      readonly expectedRevision?: number
    },
    signal?: AbortSignal,
  ): Promise<AutomationDefinition> {
    const next = await this.serialize(async () => {
      const current = await this.ownedDefinition(scope, id)
      throwIfCancelled(signal)
      const now = toIso()
      const { status, expectedRevision, ...fields } = input
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw new Error('The automation changed since it was opened. Close and reopen the editor before saving again.')
      }
      if (fields.schedule?.kind === 'once' && nextOccurrence(fields.schedule, now) === null) {
        throw new Error('A one-time automation must be scheduled in the future.')
      }
      const statusChanged = status !== undefined && status !== current.status
      const value = Object.keys(fields).length === 0 && !statusChanged
        ? current
        : updateDefinition(current, { ...fields, ...(status === undefined ? {} : { status }), now })
      if (value !== current) await this.definitions.put(id, value)
      return value
    }, signal)
    this.requestPump()
    return next
  }

  async delete(
    scope: AutomationScope,
    id: string,
    signal?: AbortSignal,
  ): Promise<{ readonly id: string; readonly deleted: boolean }> {
    const deleted = await this.serialize(async () => {
      const current = await this.ownedDefinition(scope, id)
      throwIfCancelled(signal)
      deleteDefinition(current)
      return this.definitions.delete(id)
    }, signal)
    this.requestPump()
    return { id, deleted }
  }

  async runNow(
    scope: AutomationScope,
    id: string,
    options: { readonly replaceNext?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<AutomationRun> {
    const run = await this.serialize(async () => {
      const definition = await this.ownedDefinition(scope, id)
      throwIfCancelled(signal)
      const alreadyActive = [...this.runs.entries()].some(([, candidate]) => (
        candidate.automationId === id
        && (candidate.status === 'queued' || candidate.status === 'running')
      ))
      if (alreadyActive) throw new Error('The automation already has a queued or running run.')
      const now = toIso()
      // "Run ahead": this manual run takes the place of the next scheduled
      // occurrence. Once it succeeds that occurrence is treated as handled.
      // Without a future occurrence the manual run is a plain one-off.
      const replacesScheduledFor = options.replaceNext === true
        ? nextOccurrence(definition.schedule, now)
        : null
      const value = createManualRun(definition, now, undefined, replacesScheduledFor)
      await this.runs.put(value.id, value)
      return value
    }, signal)
    this.requestPump()
    return run
  }

  async markRead(scope: AutomationScope, runId: string, signal?: AbortSignal): Promise<AutomationRun> {
    return this.serialize(async () => {
      const run = this.runs.get(runId)
      if (run === undefined) throw new Error(`unknown automation run '${runId}'`)
      const { workspace } = await this.resolveScope(scope)
      throwIfCancelled(signal)
      if (run.targetSnapshot.workspaceId !== workspace.id) {
        throw new Error('The automation run belongs to another workspace.')
      }
      if (!run.unread) return run
      const next = {
        ...run,
        unread: false,
        ...(run.reviewedAt === undefined ? { reviewedAt: toIso() } : {}),
      }
      await this.runs.put(runId, next)
      return next
    }, signal)
  }

  /** Archive the Session of one run so it leaves every conversation-list grouping surface. */
  async archiveRun(scope: AutomationScope, runId: string, signal?: AbortSignal): Promise<AutomationRun> {
    return this.serialize(async () => {
      const run = this.runs.get(runId)
      if (run === undefined) throw new Error(`unknown automation run '${runId}'`)
      const { workspace } = await this.resolveScope(scope)
      throwIfCancelled(signal)
      if (run.targetSnapshot.workspaceId !== workspace.id) {
        throw new Error('The automation run belongs to another workspace.')
      }
      if (run.sessionId === null) throw new Error('The automation run has no Session to archive.')
      await this.ctx.workspaceRegistry.archiveSession(SessionId(run.sessionId))
      return this.runs.get(runId) ?? run
    }, signal)
  }

  /** Delete one durable run record while retaining its Session and any definition. */
  async deleteRun(scope: AutomationScope, runId: string, signal?: AbortSignal): Promise<{ readonly id: string; readonly deleted: boolean }> {
    const deleted = await this.serialize(async () => {
      const run = this.runs.get(runId)
      if (run === undefined) throw new Error(`unknown automation run '${runId}'`)
      const { workspace } = await this.resolveScope(scope)
      throwIfCancelled(signal)
      if (run.targetSnapshot.workspaceId !== workspace.id) {
        throw new Error('The automation run belongs to another workspace.')
      }
      if (run.status === 'queued' || run.status === 'running') {
        throw new Error('The automation run is still queued or running.')
      }
      return this.runs.delete(runId)
    }, signal)
    return { id: runId, deleted }
  }

  private async resolveScope(scope: AutomationScope) {
    const agent = this.ctx.agents.get(SessionId(scope.sessionId))
    if (agent === undefined) throw new Error('The automation UI/tool requires a live source session.')
    const cwd = agent.session.header.cwd
    if (cwd === undefined) throw new Error('The source session has no workspace directory.')
    const workspace = await this.ctx.workspaceRegistry.resolveByPath(cwd)
    if (workspace === undefined) throw new Error('The source session directory is not registered as a DSH workspace.')
    if (this.ctx.agents.get(SessionId(scope.sessionId)) !== agent) {
      throw new Error('The automation UI/tool requires a live source session.')
    }
    return { agent, workspace }
  }

  private async ownedDefinition(scope: AutomationScope, id: string): Promise<AutomationDefinition> {
    const definition = this.definitions.get(id)
    if (definition === undefined) throw new Error(`unknown automation '${id}'`)
    const { workspace } = await this.resolveScope(scope)
    if (definition.workspaceId !== workspace.id) throw new Error('The automation belongs to another workspace.')
    return definition
  }

  private requestPump(): void {
    if (this.stopping || !this.started) return
    this.clearTimer()
    this.requested = true
    if (this.pumpScheduled) return
    this.pumpScheduled = true
    void this.serialize(async () => {
      try {
        while (this.requested && !this.stopping) {
          this.requested = false
          await this.pumpOnce()
        }
      } catch (error: unknown) {
        this.ctx.logger.warn(`dsh-automation: scheduler pump failed: ${asMessage(error)}`)
        this.armRetryTimer()
      } finally {
        this.pumpScheduled = false
      }
    }).catch((error: unknown) => {
      if (!this.stopping) this.ctx.logger.warn(`dsh-automation: scheduler admission failed: ${asMessage(error)}`)
    })
  }

  private async pumpOnce(): Promise<void> {
    if (this.stopping) return
    const now = toIso()
    for (const [, definition] of this.definitions.entries()) {
      if (definition.status !== 'active') continue
      if (this.settings().catchUpMissedRuns) await this.claimMissedRuns(definition, now)
      else await this.claimLatestDue(definition, now)
    }
    if (this.stopping) return
    await this.startQueuedRuns()
    if (this.stopping) return
    this.armNextTimer(now)
  }

  private async claimLatestDue(definition: AutomationDefinition, now: string): Promise<void> {
    const scheduledFor = latestDueOccurrence(definition.schedule, now)
    // Creation, edits, and resume establish an exclusive activation boundary:
    // only occurrences strictly after it are eligible for unattended work.
    if (scheduledFor === null || Date.parse(scheduledFor) <= Date.parse(definition.updatedAt)) return
    const related = [...this.runs.entries()].map(([, run]) => run)
      .filter(run => run.automationId === definition.id)
    if (related.some(run => run.trigger === 'schedule' && run.scheduledFor === scheduledFor)) return
    if (this.isReplacedByManualRun(related, scheduledFor)) return
    const candidate = createScheduledRun(definition, scheduledFor)
    if (this.runs.get(candidate.id) !== undefined) return
    const overlapping = related.some(run => run.status === 'queued' || run.status === 'running')
    const age = Date.parse(now) - Date.parse(scheduledFor)
    const graceMs = this.settings().misfireGraceMinutes * 60_000
    if (overlapping || age > graceMs) {
      const reason = overlapping
        ? { code: 'overlap', message: 'Skipped because the previous run is still active.' }
        : { code: 'misfire', message: 'Skipped because the host resumed outside the catch-up window.' }
      await this.runs.put(candidate.id, {
        ...candidate,
        status: 'skipped',
        finishedAt: now,
        error: reason,
        unread: true,
      })
      await this.pruneWorkspaceHistory(candidate.targetSnapshot.workspaceId)
      return
    }
    await this.runs.put(candidate.id, candidate)
  }

  /**
   * Catch-up admission: after a host resume, claim every scheduled occurrence
   * in (handledThrough, now] that has no run record yet, so nothing the host
   * missed while it was offline is skipped. Interval schedules stay on the
   * grace/skip path (backlog replay makes no sense for fixed-rate reminders).
   * The replay wait ("misfireGraceMinutes") also bounds how far back the
   * backlog reaches: only occurrences inside the wait window are replayed,
   * and the most recent `catchUpMissedRunsMax` of those win. Editing a
   * definition does not cancel its unhandled past occurrences.
   */
  private async claimMissedRuns(definition: AutomationDefinition, now: string): Promise<void> {
    if (definition.schedule.kind === 'interval') {
      await this.claimLatestDue(definition, now)
      return
    }
    const nowMs = Date.parse(now)
    const related = [...this.runs.entries()]
      .map(([, run]) => run)
      .filter(run => run.automationId === definition.id)
    if (related.some(run => run.status === 'queued' || run.status === 'running')) return
    const handledThrough = related
      .filter(run => run.trigger === 'schedule')
      .map(run => Date.parse(run.scheduledFor))
      .reduce((latest, candidate) => Math.max(latest, candidate), Number.NEGATIVE_INFINITY)
    const waitMs = this.settings().misfireGraceMinutes * 60_000
    const sinceMs = Math.max(Date.parse(definition.createdAt), handledThrough, nowMs - waitMs)
    if (sinceMs >= nowMs) return
    // Daily/weekly/once schedules produce at most one occurrence per day, so a
    // window-sized limit returns the full candidate list without truncating
    // the recent end; the backlog slice below then keeps the newest cap.
    const windowDays = Math.ceil((nowMs - sinceMs) / 86_400_000) + 2
    const candidates = occurrencesBetween(
      definition.schedule,
      new Date(sinceMs).toISOString(),
      now,
      windowDays,
    )
    const backlog = candidates.slice(-this.settings().catchUpMissedRunsMax)
    for (const scheduledFor of backlog) {
      if (related.some(run => run.trigger === 'schedule' && run.scheduledFor === scheduledFor)) continue
      if (this.isReplacedByManualRun(related, scheduledFor)) continue
      const candidate = createScheduledRun(definition, scheduledFor)
      if (this.runs.get(candidate.id) !== undefined) continue
      await this.runs.put(candidate.id, candidate)
    }
    // Occurrences older than the wait window are marked as missed instead of
    // replayed (most recent ones only), so the run history explains them and
    // the user can still run them manually.
    const staleSinceMs = Math.max(Date.parse(definition.createdAt), handledThrough)
    const staleUntilMs = nowMs - waitMs
    if (staleUntilMs > staleSinceMs) {
      const staleDays = Math.ceil((staleUntilMs - staleSinceMs) / 86_400_000) + 2
      const stale = occurrencesBetween(
        definition.schedule,
        new Date(staleSinceMs).toISOString(),
        new Date(staleUntilMs).toISOString(),
        staleDays,
      ).slice(-this.settings().catchUpMissedRunsMax)
      for (const scheduledFor of stale) {
        if (related.some(run => run.trigger === 'schedule' && run.scheduledFor === scheduledFor)) continue
        if (this.isReplacedByManualRun(related, scheduledFor)) continue
        const candidate = createScheduledRun(definition, scheduledFor)
        if (this.runs.get(candidate.id) !== undefined) continue
        await this.runs.put(candidate.id, {
          ...candidate,
          status: 'skipped',
          finishedAt: now,
          error: { code: 'misfire', message: 'Skipped because it fell outside the replay wait window.' },
          unread: true,
        })
      }
    }
  }

  /** A succeeded "run ahead" manual run counts as having handled its target occurrence. */
  private isReplacedByManualRun(
    related: readonly AutomationRun[],
    scheduledFor: string,
  ): boolean {
    return related.some(run => (
      run.trigger === 'manual'
      && run.status === 'succeeded'
      && run.replacesScheduledFor === scheduledFor
    ))
  }

  private async startQueuedRuns(): Promise<void> {
    if (this.stopping) return
    const capacity = Math.max(0, this.config.maxConcurrentRuns - this.active.size)
    if (capacity === 0) return
    const activeAutomationIds = new Set(
      [...this.active.keys()]
        .map(id => this.runs.get(id)?.automationId)
        .filter((id): id is string => id !== undefined),
    )
    const candidates = [...this.runs.entries()].map(([, run]) => run)
      .filter(run => run.status === 'queued' && !this.active.has(run.id))
      .sort((left, right) => Date.parse(left.scheduledFor) - Date.parse(right.scheduledFor))
    const queued: AutomationRun[] = []
    for (const run of candidates) {
      if (activeAutomationIds.has(run.automationId)) continue
      activeAutomationIds.add(run.automationId)
      queued.push(run)
      if (queued.length === capacity) break
    }
    for (const run of queued) this.startRun(run)
  }

  private startRun(run: AutomationRun): void {
    const abort = new AbortController()
    const promise = this.executeRun(run, abort.signal)
      .catch(async (error: unknown) => {
        this.ctx.logger.warn(`dsh-automation: run '${run.id}' failed outside its execution boundary: ${asMessage(error)}`)
        try {
          const current = this.runs.get(run.id)
          if (current !== undefined && (current.status === 'queued' || current.status === 'running')) {
            const failed: AutomationRun = {
              ...current,
              status: 'failed',
              finishedAt: toIso(),
              error: { code: 'persistence_error', message: 'The run could not persist its execution state.' },
              unread: true,
            }
            await this.runs.put(run.id, failed)
            await this.archiveRunSession(failed)
            await this.pruneWorkspaceHistory(current.targetSnapshot.workspaceId)
          }
        } catch (recordError: unknown) {
          this.ctx.logger.warn(`dsh-automation: could not persist failure for run '${run.id}': ${asMessage(recordError)}`)
        }
      })
      .finally(() => {
        this.active.delete(run.id)
        this.requestPump()
      })
    this.active.set(run.id, { abort, promise })
  }

  private async executeRun(run: AutomationRun, signal: AbortSignal): Promise<void> {
    const definition = this.definitions.get(run.automationId)
    if (definition === undefined) {
      await this.runs.put(run.id, {
        ...run,
        status: 'failed',
        finishedAt: toIso(),
        error: { code: 'definition_deleted', message: 'The automation was deleted before this run started.' },
        unread: true,
      })
      await this.pruneWorkspaceHistory(run.targetSnapshot.workspaceId)
      return
    }
    const startedAt = toIso()
    // The durable identity lives in the SessionId itself. This remains true
    // even if Agent creation fails before the first automation-sourced message
    // is appended and after bounded run history has pruned the owning row.
    const sessionId = `${AUTOMATION_SESSION_PREFIX}${randomUUID()}`
    const running: AutomationRun = { ...run, status: 'running', startedAt, sessionId }
    await this.runs.put(run.id, running)
    const completion = await executeAutomationRun(this.ctx, definition, run, {
      runTimeoutMs: this.config.runTimeoutMs,
      sessionId,
      signal,
    })
    const finishedAt = toIso()
    const completed: AutomationRun = {
      ...running,
      status: completion.status,
      sessionId: completion.sessionId ?? null,
      finishedAt,
      summary: completion.summary ?? null,
      error: completion.error ?? null,
      unread: true,
    }
    await this.runs.put(run.id, completed)
    await this.archiveRunSession(completed)
    await this.pruneWorkspaceHistory(run.targetSnapshot.workspaceId)
  }

  private armNextTimer(now: string): void {
    if (this.stopping) return
    let target: number | undefined
    for (const [, definition] of this.definitions.entries()) {
      if (definition.status !== 'active') continue
      const next = nextOccurrence(definition.schedule, now)
      if (next === null) continue
      const candidate = Date.parse(next)
      if (target === undefined || candidate < target) target = candidate
    }
    if (target === undefined) return
    const delay = Math.max(1, Math.min(target - Date.parse(now), MAX_TIMER_DELAY_MS))
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.requestPump()
    }, delay)
  }

  private armRetryTimer(): void {
    if (this.stopping || this.timer !== undefined) return
    const delay = Math.max(1_000, Math.min(60_000, this.config.misfireGraceMs || 60_000))
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.requestPump()
    }, delay)
  }

  private clearTimer(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Serialize service-level mutations and scheduler admission around domain writes. */
  private serialize<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.stopping) return Promise.reject(new Error('The automation service is stopping.'))
    if (signal?.aborted === true) return Promise.reject(new Error('The automation request was cancelled.'))
    const result = this.operationTail.then(async () => {
      throwIfCancelled(signal)
      return operation()
    })
    this.operationTail = result.then(() => {}, () => {})
    return result
  }

  private async recoverInterruptedRuns(): Promise<void> {
    const finishedAt = toIso()
    for (const [id, run] of this.runs.entries()) {
      if (run.status !== 'queued' && run.status !== 'running') continue
      await this.runs.put(id, {
        ...run,
        status: 'failed',
        finishedAt,
        error: {
          code: 'host_interrupted',
          message: 'The DSH Host stopped before this automation run reached a terminal state.',
        },
        unread: true,
      })
    }
  }

  /**
   * Skipped/cancelled runs recorded before unread tracking never asked for
   * attention. Surface them once: records the user explicitly marked as
   * reviewed carry `reviewedAt`, so they stay dismissed across restarts.
   */
  private async flagLegacyProblemRuns(): Promise<void> {
    for (const [id, run] of this.runs.entries()) {
      if (run.status !== 'skipped' && run.status !== 'cancelled') continue
      if (run.unread || run.reviewedAt !== undefined) continue
      await this.runs.put(id, { ...run, unread: true })
    }
  }

  /** Archive terminal run Sessions without changing their durable run result. */
  private async archiveRunSession(run: AutomationRun): Promise<void> {
    if (!this.config.archiveRunSessions || run.sessionId === null
      || run.status === 'queued' || run.status === 'running') return
    try {
      await this.ctx.workspaceRegistry.archiveSession(SessionId(run.sessionId))
    } catch (error: unknown) {
      this.ctx.logger.warn(`dsh-automation: could not archive Session '${run.sessionId}': ${asMessage(error)}`)
    }
  }

  /** Retry terminal Session archival on startup before bounded run pruning. */
  private async archiveTerminalRunSessions(): Promise<void> {
    for (const [, run] of this.runs.entries()) await this.archiveRunSession(run)
  }

  /** Keep every active record plus the configured newest terminal records per automation. */
  private async pruneWorkspaceHistory(workspaceId: string): Promise<void> {
    const terminalByAutomation = new Map<string, AutomationRun[]>()
    for (const run of [...this.runs.entries()]
      .map(([, run]) => run)
      .filter(run => run.targetSnapshot.workspaceId === workspaceId
        && run.status !== 'queued' && run.status !== 'running')
    ) {
      const existing = terminalByAutomation.get(run.automationId) ?? []
      existing.push(run)
      terminalByAutomation.set(run.automationId, existing)
    }
    for (const terminal of terminalByAutomation.values()) {
      terminal.sort(compareRuns)
      for (const run of terminal.slice(this.config.historyLimit)) await this.runs.delete(run.id)
    }
  }

  private async pruneAllHistory(): Promise<void> {
    const workspaces = new Set(
      [...this.runs.entries()].map(([, run]) => run.targetSnapshot.workspaceId),
    )
    for (const workspaceId of workspaces) await this.pruneWorkspaceHistory(workspaceId)
  }
}

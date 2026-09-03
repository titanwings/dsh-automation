import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefinition, createManualRun, createScheduledRun } from '../src/domain.ts'
import { AutomationService, type AutomationConfig } from '../src/service.ts'
import type { AutomationDefinition, AutomationRun } from '../src/types.ts'

class MemoryTable<Value> {
  constructor(
    readonly records = new Map<string, Value>(),
    private readonly writable: () => boolean = () => true,
  ) {}
  get(key: string): Value | undefined { return this.records.get(key) }
  entries(): IterableIterator<[string, Value]> { return new Map(this.records).entries() }
  keys(): IterableIterator<string> { return new Map(this.records).keys() }
  get size(): number { return this.records.size }
  async put(key: string, value: Value): Promise<void> {
    if (!this.writable()) throw new Error('domain is closed')
    this.records.set(key, value)
  }
  async delete(key: string): Promise<boolean> {
    if (!this.writable()) throw new Error('domain is closed')
    return this.records.delete(key)
  }
  async update(key: string, transform: (current: Value) => Value): Promise<Value> {
    if (!this.writable()) throw new Error('domain is closed')
    const current = this.records.get(key)
    if (current === undefined) throw new Error(`missing key '${key}'`)
    const next = transform(current)
    this.records.set(key, next)
    return next
  }
}

class MemoryDomain {
  readonly definitions: MemoryTable<AutomationDefinition>
  readonly runs: MemoryTable<AutomationRun>
  closed = false
  constructor(
    definitions: readonly AutomationDefinition[] = [],
    runs: readonly AutomationRun[] = [],
  ) {
    const writable = () => !this.closed
    this.definitions = new MemoryTable(new Map(definitions.map(value => [value.id, value])), writable)
    this.runs = new MemoryTable(new Map(runs.map(value => [value.id, value])), writable)
  }
  table(name: 'definitions' | 'runs'): MemoryTable<AutomationDefinition> | MemoryTable<AutomationRun> {
    return name === 'definitions' ? this.definitions : this.runs
  }
  async close(): Promise<void> { this.closed = true }
}

const scope = { sessionId: 'session-source', creatorKind: 'web' as const }
const otherWorkspaceScope = { sessionId: 'session-other-workspace', creatorKind: 'web' as const }
const defaults: AutomationConfig = {
  maxConcurrentRuns: 0,
  runTimeoutMs: 60_000,
  misfireGraceMs: 15 * 60_000,
  historyLimit: 200,
  archiveRunSessions: false,
  catchUpMissedRuns: false,
  catchUpMissedRunsMax: 30,
}

function storedDefinition(now: string): AutomationDefinition {
  return createDefinition({
    id: 'automation-existing',
    name: 'Existing automation',
    prompt: 'Inspect the repository and return a bounded report.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
    workspaceId: 'workspace-1',
    cwd: '/workspace/repo',
    agentPreset: 'standard',
    createdBy: { kind: 'web', sessionId: scope.sessionId },
    now,
  })
}

async function harness(seed?: {
  readonly definitions?: readonly AutomationDefinition[]
  readonly runs?: readonly AutomationRun[]
  readonly config?: Partial<AutomationConfig>
  readonly completeRuns?: boolean
  readonly rejectArchive?: boolean
  readonly resolveWorkspaceGate?: Promise<void>
  readonly onResolveWorkspace?: () => void
}): Promise<{
  service: AutomationService
  domain: MemoryDomain
  archivedSessionIds: string[]
  warnings: string[]
  removeSourceAgent(): void
}> {
  const domain = new MemoryDomain(seed?.definitions, seed?.runs)
  const workspace = {
    id: 'workspace-1', title: 'Repository', path: '/workspace/repo',
    status: async () => 'ok' as const,
    attachSession: async () => {},
  }
  const otherWorkspace = {
    id: 'workspace-2', title: 'Other repository', path: '/workspace/other',
    status: async () => 'ok' as const,
    attachSession: async () => {},
  }
  const sourceAgent = {
    id: scope.sessionId,
    ctx: {},
    session: {
      header: { cwd: workspace.path, agentPreset: 'legacy-preset' },
      requestHeader: () => ({
        config: { provider: 'current-provider', model: 'current-model', reasoningEffort: 'source-effort' },
      }),
    },
  }
  const otherSourceAgent = {
    id: otherWorkspaceScope.sessionId,
    ctx: {},
    session: {
      header: { cwd: otherWorkspace.path, agentPreset: 'legacy-preset' },
      requestHeader: () => ({
        config: { provider: 'current-provider', model: 'current-model', reasoningEffort: 'source-effort' },
      }),
    },
  }
  let liveSourceAgent: typeof sourceAgent | undefined = sourceAgent
  const archivedSessionIds: string[] = []
  const warnings: string[] = []
  const runSession = {
    seq: 0,
    events: [] as Array<{ seq: number; type: string; data: Record<string, unknown> }>,
  }
  const runAgent = {
    session: runSession,
    whenIdle: async () => {},
    followup: () => {
      runSession.events.push(
        { seq: 0, type: 'turn/start', data: {} },
        { seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'completed result' }] } } },
        { seq: 2, type: 'turn/end', data: { reason: { kind: 'completed' } } },
      )
      runSession.seq = 3
    },
    cancel: () => {},
  }
  const ctx = {
    storageDomain: { open: async () => domain },
    workspaceRegistry: {
      get archivedSessionIds() { return archivedSessionIds },
      resolveByPath: async (path: string) => {
        seed?.onResolveWorkspace?.()
        await seed?.resolveWorkspaceGate
        if (path === workspace.path) return workspace
        if (path === otherWorkspace.path) return otherWorkspace
        return undefined
      },
      get: () => workspace,
      archiveSession: async (sessionId: string) => {
        if (seed?.rejectArchive) throw new Error('archive unavailable')
        if (!archivedSessionIds.includes(sessionId)) archivedSessionIds.push(sessionId)
      },
    },
    agents: {
      get: (id: string) => {
        if (id === liveSourceAgent?.id) return liveSourceAgent
        if (id === otherSourceAgent.id) return otherSourceAgent
        return undefined
      },
      withoutInitiator: (task: () => unknown) => task(),
      create: async (input: { setup: (ctx: unknown) => Promise<void> }) => {
        if (!seed?.completeRuns) throw new Error('executor is not expected in service unit tests')
        await input.setup({ agent: runAgent, tools: { guard: () => {} } })
        return { agent: runAgent, dispose: async () => {} }
      },
    },
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'provider', model: 'model', reasoningEffort: 'default-effort' }),
    },
    agentPresets: {
      mount: async () => ({ id: 'standard' }),
      composedPreset: () => 'code',
    },
    sessions: { flush: async () => true },
    logger: { warn: (message: string) => { warnings.push(message) } },
  }
  const service = await AutomationService.open(ctx as never, { ...defaults, ...seed?.config })
  return {
    service,
    domain,
    archivedSessionIds,
    warnings,
    removeSourceAgent: () => { liveSourceAgent = undefined },
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('condition did not become true')
}

async function flushMicrotasks(rounds = 30): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve()
}

test('run now admits at most one queued or running occurrence per automation', async () => {
  const { service } = await harness()
  const definition = await service.create(scope, {
    name: 'Regression triage',
    prompt: 'Inspect test failures and return evidence without editing files.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
  })
  const first = await service.runNow(scope, definition.id)
  assert.equal(definition.agentPreset, 'code')
  assert.equal(definition.provider, 'current-provider')
  assert.equal(definition.model, 'current-model')
  assert.equal(definition.reasoningEffort, 'source-effort')
  assert.equal(first.status, 'queued')
  await assert.rejects(() => service.runNow(scope, definition.id), /queued or running/)
  await service.dispose()
})

test('create distinguishes legacy capture, explicit pinning, and live-global targets', async () => {
  const { service } = await harness()
  const request = {
    name: 'Model target',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'daily' as const, time: '09:00', timeZone: 'UTC' },
  }

  const captured = await service.create(scope, request)
  assert.deepEqual(
    { provider: captured.provider, model: captured.model, reasoningEffort: captured.reasoningEffort },
    { provider: 'current-provider', model: 'current-model', reasoningEffort: 'source-effort' },
  )

  const pinned = await service.create(scope, {
    ...request,
    name: 'Pinned model target',
    provider: 'provider-route',
    model: 'model-id',
    reasoningEffort: 'adapter-owned-effort',
  })
  assert.deepEqual(
    { provider: pinned.provider, model: pinned.model, reasoningEffort: pinned.reasoningEffort },
    { provider: 'provider-route', model: 'model-id', reasoningEffort: 'adapter-owned-effort' },
  )

  const followsGlobal = await service.create(scope, {
    ...request,
    name: 'Live global target',
    provider: null,
    model: null,
  })
  assert.deepEqual(
    { provider: followsGlobal.provider, model: followsGlobal.model, reasoningEffort: followsGlobal.reasoningEffort },
    { provider: null, model: null, reasoningEffort: null },
  )

  await assert.rejects(() => service.create(scope, {
    ...request,
    name: 'Partial target',
    provider: 'provider-route',
  }), /provided together/)
  await assert.rejects(() => service.create(scope, {
    ...request,
    name: 'Effort without route',
    reasoningEffort: 'high',
  }), /explicit provider/)
  await service.dispose()
})

test('concurrent updates are serialized and a deletion cannot be resurrected', async () => {
  const { service } = await harness()
  const definition = await service.create(scope, {
    name: 'Health report',
    prompt: 'Inspect repository health.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
  })
  await Promise.all([
    service.update(scope, definition.id, { name: 'Repository health' }),
    service.update(scope, definition.id, { prompt: 'Inspect repository health and cite files.' }),
  ])
  const updated = (await service.snapshot(scope)).definitions[0]!
  assert.equal(updated.revision, 3)
  assert.equal(updated.name, 'Repository health')
  assert.match(updated.prompt, /cite files/)

  const deleting = service.delete(scope, definition.id)
  const staleUpdate = service.update(scope, definition.id, { name: 'Must not reappear' })
  await deleting
  await assert.rejects(() => staleUpdate, /unknown automation/)
  assert.equal((await service.snapshot(scope)).definitions.length, 0)
  await service.dispose()
})

test('one update that changes fields and status advances the definition revision once', async () => {
  const { service } = await harness()
  const definition = await service.create(scope, {
    name: 'Combined update',
    prompt: 'Inspect repository health.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
  })

  const paused = await service.update(scope, definition.id, {
    name: 'Paused health report',
    status: 'paused',
  })
  assert.equal(paused.revision, definition.revision + 1)
  assert.equal(paused.name, 'Paused health report')
  assert.equal(paused.status, 'paused')
  await service.dispose()
})

test('a stale Web edit cannot overwrite a newer automation revision', async () => {
  const { service } = await harness()
  const definition = await service.create(scope, {
    name: 'Editable report',
    prompt: 'Inspect repository health.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
  })
  await service.update(scope, definition.id, {
    expectedRevision: definition.revision,
    prompt: 'Inspect repository health and cite files.',
  })

  await assert.rejects(
    () => service.update(scope, definition.id, {
      expectedRevision: definition.revision,
      name: 'Stale browser draft',
    }),
    /changed since it was opened/,
  )
  const current = (await service.snapshot(scope)).definitions[0]!
  assert.equal(current.name, 'Editable report')
  assert.match(current.prompt, /cite files/)
  await service.dispose()
})

test('mark read is workspace-scoped and clears durable attention state', async () => {
  const definition = storedDefinition('2026-08-13T00:00:00Z')
  const failed: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:05:00Z', 'unread-failure'),
    status: 'failed',
    finishedAt: '2026-08-13T00:06:00Z',
    error: { code: 'fixture', message: 'failed run' },
    unread: true,
  }
  // Deleted definitions deliberately leave their runs behind for audit. Those
  // retained failures must still be dismissible by a Session in the same
  // workspace, or the UI's attention count can never clear.
  const { service, domain } = await harness({ runs: [failed] })

  const updated = await service.markRead(scope, failed.id)
  assert.equal(updated.unread, false)
  assert.equal(domain.runs.get(failed.id)?.unread, false)

  await assert.rejects(
    () => service.markRead({ sessionId: 'unknown-session', creatorKind: 'web' }, failed.id),
    /live source session/,
  )
  await assert.rejects(
    () => service.markRead(otherWorkspaceScope, failed.id),
    /another workspace/,
  )
  await service.dispose()
})

test('mark read is serialized ahead of disposal so it cannot write after domain close', async () => {
  const definition = storedDefinition('2026-08-13T00:00:00Z')
  const failed: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:05:00Z', 'mark-read-dispose'),
    status: 'failed',
    finishedAt: '2026-08-13T00:06:00Z',
    error: { code: 'fixture', message: 'failed run' },
    unread: true,
  }
  let releaseWorkspace = () => {}
  const resolveWorkspaceGate = new Promise<void>(resolve => { releaseWorkspace = resolve })
  let reportResolveStarted = () => {}
  const resolveStarted = new Promise<void>(resolve => { reportResolveStarted = resolve })
  const { service, domain } = await harness({
    runs: [failed],
    resolveWorkspaceGate,
    onResolveWorkspace: reportResolveStarted,
  })

  const marking = service.markRead(scope, failed.id)
  await resolveStarted
  const disposing = service.dispose()
  await new Promise<void>(resolve => setImmediate(resolve))
  const closedBeforeMutationSettled = domain.closed
  releaseWorkspace()
  const [markResult, disposeResult] = await Promise.allSettled([marking, disposing])

  assert.equal(closedBeforeMutationSettled, false, 'dispose must drain an admitted mark-read mutation')
  assert.equal(markResult.status, 'fulfilled')
  assert.equal(disposeResult.status, 'fulfilled')
  assert.equal(domain.runs.get(failed.id)?.unread, false)
  assert.equal(domain.closed, true)
})

test('snapshot holds the domain read lease until workspace resolution completes', async () => {
  let releaseWorkspace = () => {}
  const resolveWorkspaceGate = new Promise<void>(resolve => { releaseWorkspace = resolve })
  let reportResolveStarted = () => {}
  const resolveStarted = new Promise<void>(resolve => { reportResolveStarted = resolve })
  const { service, domain } = await harness({
    resolveWorkspaceGate,
    onResolveWorkspace: reportResolveStarted,
  })

  const snapshotting = service.snapshot(scope)
  await resolveStarted
  const disposing = service.dispose()
  await new Promise<void>(resolve => setImmediate(resolve))
  const closedBeforeSnapshotSettled = domain.closed
  releaseWorkspace()
  const [snapshotResult, disposeResult] = await Promise.allSettled([snapshotting, disposing])

  assert.equal(closedBeforeSnapshotSettled, false, 'dispose must drain an admitted snapshot')
  assert.equal(snapshotResult.status, 'fulfilled')
  assert.equal(disposeResult.status, 'fulfilled')
  assert.equal(domain.closed, true)
})

test('a source Session disposed during workspace resolution cannot mutate durable state', async () => {
  const definition = storedDefinition('2026-08-13T00:00:00Z')
  let releaseWorkspace = () => {}
  const resolveWorkspaceGate = new Promise<void>(resolve => { releaseWorkspace = resolve })
  let reportResolveStarted = () => {}
  const resolveStarted = new Promise<void>(resolve => { reportResolveStarted = resolve })
  const { service, domain, removeSourceAgent } = await harness({
    definitions: [definition],
    resolveWorkspaceGate,
    onResolveWorkspace: reportResolveStarted,
  })

  const mutation = service.runNow(scope, definition.id)
  await resolveStarted
  removeSourceAgent()
  releaseWorkspace()

  await assert.rejects(mutation, /live source session/)
  assert.equal(domain.runs.size, 0)
  await service.dispose()
})

test('a mutation cancelled while waiting for the service queue never writes durable state', async () => {
  const definition = storedDefinition('2026-08-13T00:00:00Z')
  const failed: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:05:00Z', 'queue-blocker'),
    status: 'failed',
    finishedAt: '2026-08-13T00:06:00Z',
    error: { code: 'fixture', message: 'failed run' },
    unread: true,
  }
  let releaseWorkspace = () => {}
  const resolveWorkspaceGate = new Promise<void>(resolve => { releaseWorkspace = resolve })
  let reportResolveStarted = () => {}
  const resolveStarted = new Promise<void>(resolve => { reportResolveStarted = resolve })
  const { service, domain } = await harness({
    definitions: [definition],
    runs: [failed],
    resolveWorkspaceGate,
    onResolveWorkspace: reportResolveStarted,
  })
  const blockingMutation = service.markRead(scope, failed.id)
  await resolveStarted

  const controller = new AbortController()
  const cancelledMutation = (service.runNow as unknown as (
    requestScope: typeof scope,
    automationId: string,
    options: { readonly replaceNext?: boolean },
    signal: AbortSignal,
  ) => Promise<AutomationRun>)(scope, definition.id, {}, controller.signal)
  controller.abort()
  releaseWorkspace()

  await blockingMutation
  await assert.rejects(cancelledMutation, /cancelled/)
  assert.deepEqual([...domain.runs.records.keys()], [failed.id])
  await service.dispose()
})

test('a snapshot cancelled while waiting for the service queue does not enter workspace resolution', async () => {
  const definition = storedDefinition('2026-08-13T00:00:00Z')
  const failed: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:05:00Z', 'snapshot-queue-blocker'),
    status: 'failed',
    finishedAt: '2026-08-13T00:06:00Z',
    error: { code: 'fixture', message: 'failed run' },
    unread: true,
  }
  let releaseWorkspace = () => {}
  const resolveWorkspaceGate = new Promise<void>(resolve => { releaseWorkspace = resolve })
  let resolves = 0
  let reportFirstResolveStarted = () => {}
  const firstResolveStarted = new Promise<void>(resolve => { reportFirstResolveStarted = resolve })
  const { service } = await harness({
    runs: [failed],
    resolveWorkspaceGate,
    onResolveWorkspace: () => {
      resolves += 1
      if (resolves === 1) reportFirstResolveStarted()
    },
  })
  const blockingMutation = service.markRead(scope, failed.id)
  await firstResolveStarted

  const controller = new AbortController()
  const cancelledSnapshot = service.snapshot(scope, controller.signal)
  controller.abort()
  releaseWorkspace()

  await blockingMutation
  await assert.rejects(cancelledSnapshot, /cancelled/)
  assert.equal(resolves, 1)
  await service.dispose()
})

test('opening after a host stop terminalizes queued work without rerunning it', async () => {
  const definition = storedDefinition('2026-08-13T00:00:00Z')
  const queued = createManualRun(definition, '2026-08-13T00:05:00Z', 'interrupted')
  const { service, domain } = await harness({ definitions: [definition], runs: [queued] })
  const recovered = domain.runs.get(queued.id)!
  assert.equal(recovered.status, 'failed')
  assert.equal(recovered.error?.code, 'host_interrupted')
  assert.equal(recovered.unread, true)
  await service.dispose()
  assert.equal(domain.closed, true)
})

test('startup recovery archives an interrupted run Session after terminalizing its audit row', async () => {
  const definition = storedDefinition('2026-08-13T00:00:00Z')
  const interrupted: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:05:00Z', 'interrupted-session'),
    status: 'running',
    sessionId: 'dsh-automation-session-interrupted',
    startedAt: '2026-08-13T00:05:30Z',
  }
  const { service, domain, archivedSessionIds } = await harness({
    definitions: [definition],
    runs: [interrupted],
    config: { archiveRunSessions: true },
  })
  try {
    assert.equal(domain.runs.get(interrupted.id)?.status, 'failed')
    assert.equal(domain.runs.get(interrupted.id)?.error?.code, 'host_interrupted')
    assert.deepEqual(archivedSessionIds, [interrupted.sessionId])
  } finally {
    await service.dispose()
  }
})

test('configured run-session archival hides a completed Session without deleting its audit row', async () => {
  const { service, domain, archivedSessionIds } = await harness({
    completeRuns: true,
    config: { maxConcurrentRuns: 1, archiveRunSessions: true },
  })
  try {
    const definition = await service.create(scope, {
      name: 'Archived result',
      prompt: 'Return one bounded result.',
      schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
    })
    const queued = await service.runNow(scope, definition.id)

    service.start()
    await waitFor(() => domain.runs.get(queued.id)?.status === 'succeeded')
    const completed = domain.runs.get(queued.id)!
    assert.equal(completed.summary, 'completed result')
    assert.match(completed.sessionId ?? '', /^dsh-automation-session-/)
    assert.deepEqual(archivedSessionIds, [completed.sessionId])
    assert.equal((await service.snapshot(scope)).runs[0]?.sessionArchived, true)
  } finally {
    await service.dispose()
  }
})

test('archive failure leaves the completed result successful and visible for retry after restart', async () => {
  const { service, domain, archivedSessionIds, warnings } = await harness({
    completeRuns: true,
    rejectArchive: true,
    config: { maxConcurrentRuns: 1, archiveRunSessions: true },
  })
  let definition: AutomationDefinition | undefined
  let completed: AutomationRun | undefined
  try {
    definition = await service.create(scope, {
      name: 'Archive retry',
      prompt: 'Return one bounded result.',
      schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
    })
    const queued = await service.runNow(scope, definition.id)

    service.start()
    await waitFor(() => domain.runs.get(queued.id)?.status === 'succeeded')
    completed = domain.runs.get(queued.id)!
    assert.equal(completed.status, 'succeeded')
    assert.deepEqual(archivedSessionIds, [])
    assert.equal(warnings.some(message => message.includes('could not archive')), true)
    assert.equal((await service.snapshot(scope)).runs[0]?.sessionArchived, false)
  } finally {
    await service.dispose()
  }
  assert.ok(definition)
  assert.ok(completed)

  const retry = await harness({
    definitions: [definition],
    runs: [completed],
    config: { archiveRunSessions: true },
  })
  try {
    assert.deepEqual(retry.archivedSessionIds, [completed.sessionId])
    assert.equal(retry.domain.runs.get(completed.id)?.status, 'succeeded')
  } finally {
    await retry.service.dispose()
  }
})

test('archiveRunSessions false keeps completed Sessions in the ordinary list', async () => {
  const { service, domain, archivedSessionIds } = await harness({
    completeRuns: true,
    config: { maxConcurrentRuns: 1, archiveRunSessions: false },
  })
  try {
    const definition = await service.create(scope, {
      name: 'Visible result',
      prompt: 'Return one bounded result.',
      schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
    })
    const queued = await service.runNow(scope, definition.id)

    service.start()
    await waitFor(() => domain.runs.get(queued.id)?.status === 'succeeded')
    assert.deepEqual(archivedSessionIds, [])
    assert.equal((await service.snapshot(scope)).runs[0]?.sessionArchived, false)
  } finally {
    await service.dispose()
  }
})

test('durable retention is bounded per automation and keeps automation session identity', async () => {
  const definition = storedDefinition('2026-08-13T00:00:00Z')
  const otherDefinition = createDefinition({
    ...definition,
    id: 'automation-other',
    name: 'Other automation',
    now: '2026-08-13T00:00:00Z',
  })
  const oldRun: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:01:00Z', 'old'),
    status: 'succeeded',
    finishedAt: '2026-08-13T00:02:00Z',
  }
  const newRun: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:03:00Z', 'new'),
    status: 'failed',
    finishedAt: '2026-08-13T00:04:00Z',
    error: { code: 'fixture', message: 'newer terminal result' },
  }
  const activeRun = createManualRun(definition, '2026-08-13T00:05:00Z', 'active')
  const otherRun: AutomationRun = {
    ...createManualRun(otherDefinition, '2026-08-13T00:00:30Z', 'other'),
    status: 'succeeded',
    sessionId: 'session-other-automation',
    finishedAt: '2026-08-13T00:00:45Z',
  }
  const { service, domain } = await harness({
    definitions: [definition, otherDefinition],
    runs: [oldRun, newRun, activeRun, otherRun],
    config: { historyLimit: 1 },
  })
  assert.equal(domain.runs.get(oldRun.id), undefined)
  // Startup recovery terminalizes the active record before retention, so only
  // the newest recovered terminal remains at a limit of one.
  assert.equal(domain.runs.get(activeRun.id)?.status, 'failed')
  assert.equal(domain.runs.get(newRun.id), undefined)
  assert.equal(domain.runs.get(otherRun.id)?.status, 'succeeded')
  assert.equal(service.ownsSession(otherRun.sessionId!), true)
  assert.equal(service.ownsSession('dsh-automation-session-pruned-before-prompt'), true)
  assert.equal(service.ownsSession('session-pruned', [{
    type: 'user/message',
    data: { source: { kind: 'automation', automationId: definition.id } },
  }]), true)
  assert.equal(service.ownsSession('session-human', [{
    type: 'user/message',
    data: { source: { kind: 'user' } },
  }]), false)
  await service.dispose()
})

test('a queued run whose definition is deleted still enforces terminal retention', async () => {
  const { service, domain } = await harness({
    config: { maxConcurrentRuns: 1, historyLimit: 1 },
  })
  const definition = await service.create(scope, {
    name: 'Deletion race',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
  })
  const oldRun: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:01:00Z', 'old-retained'),
    status: 'succeeded',
    finishedAt: '2026-08-13T00:02:00Z',
  }
  await domain.runs.put(oldRun.id, oldRun)
  const queued = await service.runNow(scope, definition.id)
  await service.delete(scope, definition.id)

  service.start()
  await waitFor(() => domain.runs.get(queued.id)?.status === 'failed')
  const related = [...domain.runs.records.values()]
    .filter(run => run.automationId === definition.id)
  assert.equal(domain.runs.get(queued.id)?.error?.code, 'definition_deleted')
  assert.equal(domain.runs.get(queued.id)?.unread, true)
  assert.deepEqual(related.map(run => run.id), [queued.id])
  await service.dispose()
})

test('the clock dispatches a due one-time occurrence exactly once without run-now', async (context) => {
  const now = Date.parse('2026-08-13T00:00:00Z')
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })
  const { service, domain } = await harness({ config: { maxConcurrentRuns: 1 } })
  const at = new Date(now + 60_000).toISOString()
  const definition = await service.create(scope, {
    name: 'Actual clock occurrence',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'once', at, timeZone: 'UTC' },
  })

  service.start()
  await flushMicrotasks()
  context.mock.timers.tick(59_999)
  await flushMicrotasks()
  assert.equal(domain.runs.size, 0)

  context.mock.timers.tick(1)
  await flushMicrotasks()
  const runs = [...domain.runs.records.values()]
  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.automationId, definition.id)
  assert.equal(runs[0]?.trigger, 'schedule')
  assert.equal(runs[0]?.scheduledFor, at)
  assert.equal(runs[0]?.status, 'failed')
  assert.equal(runs[0]?.error?.code, 'executor_error')

  context.mock.timers.tick(60_000)
  await flushMicrotasks()
  assert.equal(domain.runs.size, 1)
  await service.dispose()
})

test('pause blocks a due interval and resume waits for the next future occurrence', async (context) => {
  const now = Date.parse('2026-08-13T00:00:00Z')
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })
  const { service, domain } = await harness({ config: { maxConcurrentRuns: 1 } })
  const definition = await service.create(scope, {
    name: 'Pause and resume',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'interval', everyMinutes: 5, anchor: new Date(now).toISOString(), timeZone: 'UTC' },
  })
  await service.update(scope, definition.id, { status: 'paused' })
  service.start()
  await flushMicrotasks()

  context.mock.timers.tick(5 * 60_000)
  await flushMicrotasks()
  assert.equal(domain.runs.size, 0, 'a paused definition must not claim the due occurrence')

  await service.update(scope, definition.id, { status: 'active' })
  await flushMicrotasks()
  assert.equal(domain.runs.size, 0, 'resume must not replay the occurrence at the activation boundary')

  context.mock.timers.tick(5 * 60_000)
  await flushMicrotasks()
  const runs = [...domain.runs.records.values()]
  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.trigger, 'schedule')
  assert.equal(runs[0]?.scheduledFor, new Date(now + 10 * 60_000).toISOString())
  await service.dispose()
})

test('archiveRun archives the run Session and rejects foreign or sessionless runs', async () => {
  const definition = storedDefinition('2026-08-13T00:00:00Z')
  const runWithSession: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:01:00Z', 'archive-me'),
    status: 'succeeded',
    sessionId: 'dsh-automation-session-archive-me',
    finishedAt: '2026-08-13T00:02:00Z',
  }
  const runWithoutSession: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:03:00Z', 'no-session'),
    status: 'failed',
    finishedAt: '2026-08-13T00:04:00Z',
    error: { code: 'executor_error', message: 'no session minted' },
  }
  const foreignRun: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:05:00Z', 'foreign'),
    status: 'succeeded',
    targetSnapshot: { ...createManualRun(definition, '2026-08-13T00:05:00Z', 'foreign-target').targetSnapshot, workspaceId: 'workspace-2' },
    sessionId: 'dsh-automation-session-foreign',
    finishedAt: '2026-08-13T00:06:00Z',
  }
  const { service, archivedSessionIds } = await harness({
    definitions: [definition],
    runs: [runWithSession, runWithoutSession, foreignRun],
  })

  const archived = await service.archiveRun(scope, runWithSession.id)
  assert.equal(archived.id, runWithSession.id)
  assert.deepEqual(archivedSessionIds, ['dsh-automation-session-archive-me'])

  await assert.rejects(() => service.archiveRun(scope, runWithoutSession.id), /no Session to archive/)
  await assert.rejects(() => service.archiveRun(scope, foreignRun.id), /another workspace/)
  await assert.rejects(() => service.archiveRun(scope, 'run-missing'), /unknown automation run/)
  await service.dispose()
})

test('deleteRun removes terminal records only and keeps active runs durable', async () => {
  const definition = storedDefinition('2026-08-13T00:00:00Z')
  const terminalRun: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:01:00Z', 'delete-me'),
    status: 'succeeded',
    sessionId: 'dsh-automation-session-delete-me',
    finishedAt: '2026-08-13T00:02:00Z',
  }
  const foreignRun: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:05:00Z', 'foreign-delete'),
    status: 'succeeded',
    targetSnapshot: { ...createManualRun(definition, '2026-08-13T00:05:00Z', 'foreign-delete-target').targetSnapshot, workspaceId: 'workspace-2' },
    finishedAt: '2026-08-13T00:06:00Z',
  }
  const { service, domain } = await harness({
    definitions: [definition],
    runs: [terminalRun, foreignRun],
  })
  const queuedRun = await service.runNow(scope, definition.id)

  assert.deepEqual(await service.deleteRun(scope, terminalRun.id), { id: terminalRun.id, deleted: true })
  assert.equal(domain.runs.get(terminalRun.id), undefined)
  assert.equal(domain.runs.get(queuedRun.id)?.status, 'queued')

  await assert.rejects(() => service.deleteRun(scope, queuedRun.id), /still queued or running/)
  await assert.rejects(() => service.deleteRun(scope, foreignRun.id), /another workspace/)
  await assert.rejects(() => service.deleteRun(scope, 'run-missing'), /unknown automation run/)
  await service.dispose()
})

test('startup surfaces legacy skipped/cancelled runs once and keeps reviewed ones dismissed', async () => {
  const definition = storedDefinition('2026-08-13T00:00:00Z')
  const legacySkipped: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:01:00Z', 'legacy-skipped'),
    status: 'skipped',
    finishedAt: '2026-08-13T00:02:00Z',
    error: { code: 'misfire', message: 'Skipped because the host resumed outside the catch-up window.' },
  }
  const reviewedCancelled: AutomationRun = {
    ...createManualRun(definition, '2026-08-13T00:03:00Z', 'reviewed-cancelled'),
    status: 'cancelled',
    finishedAt: '2026-08-13T00:04:00Z',
    error: { code: 'cancelled', message: 'The automation was cancelled.' },
    unread: false,
    reviewedAt: '2026-08-14T00:00:00Z',
  }
  const { service, domain } = await harness({
    definitions: [definition],
    runs: [legacySkipped, reviewedCancelled],
  })

  assert.equal(domain.runs.get(legacySkipped.id)?.unread, true)
  assert.equal(domain.runs.get(reviewedCancelled.id)?.unread, false)

  const marked = await service.markRead(scope, legacySkipped.id)
  assert.equal(marked.unread, false)
  assert.equal(typeof marked.reviewedAt, 'string')

  // Re-opening must not resurrect the dismissed record.
  await service.dispose()
  const reopened = await harness({
    definitions: [definition],
    runs: [...domain.runs.records.values()],
  })
  assert.equal(reopened.domain.runs.get(legacySkipped.id)?.unread, false)
  await reopened.service.dispose()
})

test('scheduler materializes only the latest due interval and records overlap', async () => {
  const anchorMs = Date.now() - 6 * 60_000
  const anchor = new Date(anchorMs).toISOString()
  const definition = createDefinition({
    id: 'automation-interval',
    name: 'Interval check',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'interval', everyMinutes: 5, anchor, timeZone: 'UTC' },
    workspaceId: 'workspace-1',
    cwd: '/workspace/repo',
    agentPreset: 'standard',
    createdBy: { kind: 'web', sessionId: scope.sessionId },
    now: new Date(anchorMs - 60_000).toISOString(),
  })
  const { service, domain } = await harness({ definitions: [definition] })
  try {
    const manual = await service.runNow(scope, definition.id)
    service.start()
    await waitFor(() => domain.runs.records.size === 2)
    const scheduled = [...domain.runs.records.values()].find(run => run.trigger === 'schedule')!
    assert.equal(manual.status, 'queued')
    assert.equal(scheduled.status, 'skipped')
    assert.equal(scheduled.unread, true)
    assert.equal(scheduled.error?.code, 'overlap')
    assert.equal(Date.parse(scheduled.scheduledFor), Date.parse(anchor) + 5 * 60_000)
  } finally {
    await service.dispose()
  }
})

test('catch-up mode queues every missed daily occurrence instead of misfire skipping', async (context) => {
  const now = Date.parse('2026-08-13T10:00:00Z')
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })
  const createdAt = '2026-08-11T08:00:00Z'
  const definition = createDefinition({
    id: 'automation-catchup-daily',
    name: 'Catch-up daily',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
    workspaceId: 'workspace-1',
    cwd: '/workspace/repo',
    agentPreset: 'standard',
    createdBy: { kind: 'web', sessionId: scope.sessionId },
    now: createdAt,
  })
  const { service, domain } = await harness({
    definitions: [definition],
    config: { catchUpMissedRuns: true, misfireGraceMs: 1e12, catchUpMissedRunsMax: 30 },
  })
  try {
    service.start()
    await flushMicrotasks()
    const runs = [...domain.runs.records.values()]
    assert.equal(runs.length, 3)
    assert.deepEqual(runs.map(run => run.scheduledFor), [
      '2026-08-11T09:00:00.000Z',
      '2026-08-12T09:00:00.000Z',
      '2026-08-13T09:00:00.000Z',
    ])
    for (const run of runs) {
      assert.equal(run.trigger, 'schedule')
      assert.equal(run.status, 'queued')
    }
    assert.equal(runs.some(run => run.status === 'skipped'), false)
  } finally {
    await service.dispose()
  }
})

test('catch-up mode caps backlog to the most recent occurrences and never replays handled ones', async (context) => {
  const now = Date.parse('2026-08-13T10:00:00Z')
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })
  const definition = createDefinition({
    id: 'automation-catchup-cap',
    name: 'Catch-up cap',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
    workspaceId: 'workspace-1',
    cwd: '/workspace/repo',
    agentPreset: 'standard',
    createdBy: { kind: 'web', sessionId: scope.sessionId },
    now: '2026-07-04T08:00:00Z',
  })
  const handled = {
    ...createScheduledRun(definition, '2026-07-10T09:00:00.000Z'),
    status: 'succeeded' as const,
    finishedAt: '2026-07-10T09:05:00.000Z',
    sessionId: null,
  }
  const { service, domain } = await harness({
    definitions: [definition],
    runs: [handled],
    config: { catchUpMissedRuns: true, misfireGraceMs: 1e12, catchUpMissedRunsMax: 30 },
  })
  try {
    service.start()
    await flushMicrotasks()
    const runs = [...domain.runs.records.values()]
    const claimed = runs.filter(run => run.trigger === 'schedule' && run.status === 'queued')
    assert.equal(runs.length, 31)
    assert.equal(claimed.length, 30)
    // The most recent 30 of the 34 unhandled occurrences (7/11-8/13) win,
    // so the earliest 4 (7/11-7/14) are dropped.
    assert.equal(claimed[0]?.scheduledFor, '2026-07-15T09:00:00.000Z')
    assert.equal(claimed.at(-1)?.scheduledFor, '2026-08-13T09:00:00.000Z')
    const scheduledFors = claimed.map(run => run.scheduledFor)
    assert.equal(new Set(scheduledFors).size, 30)
    assert.equal(scheduledFors.includes(handled.scheduledFor), false)
  } finally {
    await service.dispose()
  }
})

test('catch-up disabled keeps the stale-occurrence misfire skip unchanged', async (context) => {
  const now = Date.parse('2026-08-13T10:00:00Z')
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })
  const definition = createDefinition({
    id: 'automation-grace-skip',
    name: 'Grace skip',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
    workspaceId: 'workspace-1',
    cwd: '/workspace/repo',
    agentPreset: 'standard',
    createdBy: { kind: 'web', sessionId: scope.sessionId },
    now: '2026-08-11T08:00:00Z',
  })
  const { service, domain } = await harness({ definitions: [definition] })
  try {
    service.start()
    await flushMicrotasks()
    const runs = [...domain.runs.records.values()]
    assert.equal(runs.length, 1)
    assert.equal(runs[0]?.trigger, 'schedule')
    assert.equal(runs[0]?.status, 'skipped')
    assert.equal(runs[0]?.unread, true)
    assert.equal(runs[0]?.error?.code, 'misfire')
    assert.equal(runs[0]?.scheduledFor, '2026-08-13T09:00:00.000Z')
  } finally {
    await service.dispose()
  }
})

test('settings owner overrides the cordis defaults and persists through updateSettings', async (context) => {
  const now = Date.parse('2026-08-13T10:00:00Z')
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })
  const definition = createDefinition({
    id: 'automation-settings-policy',
    name: 'Settings policy',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
    workspaceId: 'workspace-1',
    cwd: '/workspace/repo',
    agentPreset: 'standard',
    createdBy: { kind: 'web', sessionId: scope.sessionId },
    now: '2026-08-11T08:00:00Z',
  })
  // Cordis config says catch up, but the durable settings namespace (stored)
  // says skip: the owner must win at admission time.
  let stored = { catchUpMissedRuns: false, catchUpMissedRunsMax: 30, misfireGraceMinutes: 15 }
  const owner = {
    get: () => stored,
    update: async (next: typeof stored) => { stored = next },
  }
  const { service, domain } = await harness({
    definitions: [definition],
    config: { catchUpMissedRuns: true, misfireGraceMs: 1e12, catchUpMissedRunsMax: 30 },
  })
  try {
    // Before attachment the config fallback applies.
    assert.equal(service.settings().catchUpMissedRuns, true)
    service.attachSettings(owner)
    assert.deepEqual(service.settings(), stored)

    service.start()
    await flushMicrotasks()
    const runs = [...domain.runs.records.values()]
    assert.equal(runs.length, 1)
    assert.equal(runs[0]?.status, 'skipped')
    assert.equal(runs[0]?.error?.code, 'misfire')

    const saved = await service.updateSettings(scope, {
      catchUpMissedRuns: true,
      catchUpMissedRunsMax: 7,
      misfireGraceMinutes: 45,
    })
    assert.deepEqual(saved, stored)
    assert.deepEqual(service.settings(), {
      catchUpMissedRuns: true,
      catchUpMissedRunsMax: 7,
      misfireGraceMinutes: 45,
    })
  } finally {
    await service.dispose()
  }
})

test('catch-up replays occurrences inside the wait window and marks older ones missed', async (context) => {
  const now = Date.parse('2026-08-13T10:00:00Z')
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })
  const definition = createDefinition({
    id: 'automation-catchup-window',
    name: 'Catch-up window',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
    workspaceId: 'workspace-1',
    cwd: '/workspace/repo',
    agentPreset: 'standard',
    createdBy: { kind: 'web', sessionId: scope.sessionId },
    now: '2026-08-11T08:00:00Z',
  })
  // A 2h wait window starting at 08:00: the two earlier daily runs fall
  // outside and are marked missed; only today's 09:00 occurrence is replayed.
  const { service, domain } = await harness({
    definitions: [definition],
    config: {
      catchUpMissedRuns: true,
      misfireGraceMs: 2 * 60 * 60_000,
      catchUpMissedRunsMax: 30,
    },
  })
  try {
    service.start()
    await flushMicrotasks()
    const runs = [...domain.runs.records.values()]
    assert.equal(runs.length, 3)
    const replayed = runs.filter(run => run.status === 'queued')
    const missed = runs.filter(run => run.status === 'skipped')
    assert.equal(replayed.length, 1)
    assert.equal(replayed[0]?.scheduledFor, '2026-08-13T09:00:00.000Z')
    assert.equal(missed.length, 2)
    assert.deepEqual(missed.map(run => run.scheduledFor).sort(), [
      '2026-08-11T09:00:00.000Z',
      '2026-08-12T09:00:00.000Z',
    ])
    for (const run of missed) {
      assert.equal(run.trigger, 'schedule')
      assert.equal(run.unread, true)
    }
  } finally {
    await service.dispose()
  }
})

test('run-ahead replaces the next schedule occurrence once the manual run succeeds', async (context) => {
  const now = Date.parse('2026-08-13T07:30:00Z')
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })
  const { service, domain } = await harness({ config: { maxConcurrentRuns: 1 }, completeRuns: true })
  const at = '2026-08-13T08:30:00.000Z'
  const definition = await service.create(scope, {
    name: 'Ahead run',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'once', at, timeZone: 'UTC' },
  })
  const manual = await service.runNow(scope, definition.id, { replaceNext: true })
  assert.equal(manual.trigger, 'manual')
  assert.equal(manual.replacesScheduledFor, at)

  service.start()
  await flushMicrotasks(150)
  assert.equal([...domain.runs.records.values()][0]?.status, 'succeeded')
  // The planned 08:30 occurrence must not fire: the succeeded ahead run owns it.
  context.mock.timers.tick(60 * 60_000 + 1)
  await flushMicrotasks(150)
  const runs = [...domain.runs.records.values()]
  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.trigger, 'manual')
  assert.equal(runs[0]?.replacesScheduledFor, at)
  await service.dispose()
})

test('a plain manual run leaves the scheduled occurrence intact', async (context) => {
  const now = Date.parse('2026-08-13T07:30:00Z')
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })
  const { service, domain } = await harness({ config: { maxConcurrentRuns: 1 }, completeRuns: true })
  const at = '2026-08-13T08:30:00.000Z'
  const definition = await service.create(scope, {
    name: 'Plain run',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'once', at, timeZone: 'UTC' },
  })
  const manual = await service.runNow(scope, definition.id)
  assert.equal(manual.replacesScheduledFor, null)

  service.start()
  await flushMicrotasks(150)
  assert.equal([...domain.runs.records.values()][0]?.status, 'succeeded')
  context.mock.timers.tick(60 * 60_000 + 1)
  await flushMicrotasks(150)
  const runs = [...domain.runs.records.values()]
  // The scheduled occurrence is claimed and started despite the manual run;
  // its final state here is a harness artifact (the stub agent is single-use).
  const scheduleRun = runs.find(run => run.trigger === 'schedule')
  assert.equal(runs.length, 2)
  assert.equal(scheduleRun?.scheduledFor, at)
  await service.dispose()
})

test('a failed run-ahead keeps the scheduled occurrence alive', async (context) => {
  const now = Date.parse('2026-08-13T07:30:00Z')
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })
  const { service, domain } = await harness()
  const at = '2026-08-13T08:30:00.000Z'
  const definition = await service.create(scope, {
    name: 'Failed ahead run',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'once', at, timeZone: 'UTC' },
  })
  const manual = await service.runNow(scope, definition.id, { replaceNext: true })
  // Simulate the manual execution failing before the planned time.
  await domain.runs.put(manual.id, {
    ...manual,
    status: 'failed',
    finishedAt: '2026-08-13T07:35:00.000Z',
  })

  service.start()
  await flushMicrotasks(60)
  context.mock.timers.tick(60 * 60_000 + 1)
  await flushMicrotasks(60)
  const runs = [...domain.runs.records.values()]
  assert.equal(runs.length, 2)
  const scheduleRun = runs.find(run => run.trigger === 'schedule')
  assert.equal(scheduleRun?.scheduledFor, at)
  assert.equal(scheduleRun?.status, 'queued')
  await service.dispose()
})

test('snapshot treats an occurrence fulfilled by a run-ahead as not pending', async () => {
  const at = '2099-01-01T08:30:00.000Z'
  const definition = createDefinition({
    id: 'automation-ahead-snapshot',
    name: 'Ahead snapshot',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'once', at, timeZone: 'UTC' },
    workspaceId: 'workspace-1',
    cwd: '/workspace/repo',
    agentPreset: 'standard',
    createdBy: { kind: 'web', sessionId: scope.sessionId },
    now: '2026-09-03T00:00:00.000Z',
  })
  const fulfilled = {
    ...createManualRun(definition, '2026-09-03T00:30:00.000Z', 'ahead'),
    replacesScheduledFor: at,
    status: 'succeeded' as const,
    finishedAt: '2026-09-03T01:00:00.000Z',
    sessionId: null,
  }
  const untouched = createDefinition({
    id: 'automation-plain-snapshot',
    name: 'Plain snapshot',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'once', at, timeZone: 'UTC' },
    workspaceId: 'workspace-1',
    cwd: '/workspace/repo',
    agentPreset: 'standard',
    createdBy: { kind: 'web', sessionId: scope.sessionId },
    now: '2026-09-03T00:00:00.000Z',
  })
  const { service } = await harness({
    definitions: [definition, untouched],
    runs: [fulfilled],
  })
  try {
    const snapshot = await service.snapshot(scope)
    const fulfilledView = snapshot.definitions.find(item => item.id === definition.id)
    const untouchedView = snapshot.definitions.find(item => item.id === untouched.id)
    assert.equal(fulfilledView?.nextRunAt, null)
    assert.equal(fulfilledView?.lastRun?.status, 'succeeded')
    assert.equal(untouchedView?.nextRunAt, at)
  } finally {
    await service.dispose()
  }
})

test('running a daily task ahead today leaves tomorrow\'s occurrence intact', async (context) => {
  const now = Date.parse('2026-08-13T07:30:00Z')
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })
  const { service, domain } = await harness({ config: { maxConcurrentRuns: 1 }, completeRuns: true })
  const definition = await service.create(scope, {
    name: 'Daily ahead',
    prompt: 'Inspect one bounded condition.',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
  })
  const manual = await service.runNow(scope, definition.id, { replaceNext: true })
  // Replaces today's 09:00, not tomorrow's.
  assert.equal(manual.replacesScheduledFor, '2026-08-13T09:00:00.000Z')

  service.start()
  await flushMicrotasks(150)
  assert.equal([...domain.runs.records.values()][0]?.status, 'succeeded')
  // Today's 09:00 passes and is suppressed by the succeeded ahead run...
  context.mock.timers.tick(90 * 60_000 + 1)
  await flushMicrotasks(150)
  assert.equal([...domain.runs.records.values()].length, 1)
  // ...while tomorrow's 09:00 still fires normally (stub agent is single-use,
  // so only its creation is asserted, not its final state).
  context.mock.timers.tick(24 * 60 * 60_000)
  await flushMicrotasks(150)
  const runs = [...domain.runs.records.values()]
  const tomorrowRun = runs.find(run => run.trigger === 'schedule')
  assert.equal(runs.length, 2)
  assert.equal(tomorrowRun?.scheduledFor, '2026-08-14T09:00:00.000Z')
  await service.dispose()
})

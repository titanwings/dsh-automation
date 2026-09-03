import assert from 'node:assert/strict'
import test from 'node:test'
import { registerAutomationRpc } from '../src/rpc.ts'

test('snapshot marks archived run Sessions so the client never offers a broken open action', async () => {
  let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
  const ctx = {
    connection: { rpc: { handle: (_channel: string, value: typeof handler) => { handler = value; return async () => {} } } },
  }
  const service = {
    snapshot: async () => ({
      generatedAt: '2026-08-17T00:00:00.000Z',
      workspace: { id: 'workspace-1', title: 'Repository', path: '/workspace/repo' },
      definitions: [],
      runs: [{
        id: 'run-archived', automationId: 'automation-deleted', definitionRevision: 1,
        occurrenceKey: 'manual:automation-deleted:archived', trigger: 'manual',
        scheduledFor: '2026-08-17T00:00:00.000Z', status: 'succeeded',
        promptSnapshot: 'Inspect one condition.', targetSnapshot: {
          workspaceId: 'workspace-1', cwd: '/workspace/repo', agentPreset: 'code',
          provider: null, model: null, reasoningEffort: null, permissionPreset: 'read-only',
        },
        sessionId: 'dsh-automation-session-archived', sessionArchived: true,
        startedAt: '2026-08-17T00:00:01.000Z', finishedAt: '2026-08-17T00:00:02.000Z',
        summary: 'No regression found.', error: null, unread: false,
      }],
    }),
    settings: () => ({ catchUpMissedRuns: false, catchUpMissedRunsMax: 30, misfireGraceMinutes: 15 }),
  }
  registerAutomationRpc(ctx as never, service as never)

  const response = await handler?.('snapshot', { sessionId: 'session-source' }, new AbortController().signal)
  assert.deepEqual(response, {
    ok: true,
    value: {
      scope: { workspaceId: 'workspace-1', workspaceName: 'Repository', cwd: '/workspace/repo' },
      automations: [],
      runs: [{
        id: 'run-archived', automationId: 'automation-deleted', automationName: 'Deleted automation',
        status: 'succeeded', trigger: 'manual', scheduledFor: '2026-08-17T00:00:00.000Z',
        startedAt: '2026-08-17T00:00:01.000Z', finishedAt: '2026-08-17T00:00:02.000Z',
        sessionId: 'dsh-automation-session-archived', sessionArchived: true,
        summary: 'No regression found.', unread: false,
        promptSnapshot: 'Inspect one condition.',
        provider: null, model: null, reasoningEffort: null, permission: 'read-only',
      }],
      settings: { catchUpMissedRuns: false, catchUpMissedRunsMax: 30, misfireGraceMinutes: 15 },
      serverNow: '2026-08-17T00:00:00.000Z',
    },
  })
})

test('snapshot exposes the complete durable model target to the Web client', async () => {
  let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
  const ctx = {
    connection: { rpc: { handle: (_channel: string, value: typeof handler) => { handler = value; return async () => {} } } },
  }
  const service = {
    snapshot: async () => ({
      generatedAt: '2026-08-17T00:00:00.000Z',
      workspace: { id: 'workspace-1', title: 'Repository', path: '/workspace/repo' },
      definitions: [{
        version: 1, id: 'automation-pinned', revision: 1, name: 'Pinned task',
        prompt: 'Inspect one condition.', status: 'active',
        schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
        rrule: 'RRULE:FREQ=DAILY', timeZone: 'UTC', workspaceId: 'workspace-1',
        cwd: '/workspace/repo', agentPreset: 'code', provider: 'provider-route', model: 'model-id',
        reasoningEffort: 'custom-effort', permissionPreset: 'read-only',
        createdBy: { kind: 'web', sessionId: 'session-source' },
        createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z',
        nextRunAt: '2026-08-18T09:00:00.000Z', lastRun: null,
      }],
      runs: [],
    }),
    settings: () => ({ catchUpMissedRuns: true, catchUpMissedRunsMax: 7, misfireGraceMinutes: 45 }),
  }
  registerAutomationRpc(ctx as never, service as never)

  const response = await handler?.('snapshot', { sessionId: 'session-source' }, new AbortController().signal) as {
    readonly ok: true
    readonly value: {
      readonly automations: readonly Record<string, unknown>[]
      readonly settings: Record<string, unknown>
    }
  }
  assert.equal(response.ok, true)
  assert.deepEqual(response.value.settings, { catchUpMissedRuns: true, catchUpMissedRunsMax: 7, misfireGraceMinutes: 45 })
  assert.deepEqual(response.value.automations[0], {
    id: 'automation-pinned', revision: 1, name: 'Pinned task', prompt: 'Inspect one condition.', status: 'active',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
    scheduleSummary: 'RRULE:FREQ=DAILY', timeZone: 'UTC',
    provider: 'provider-route', model: 'model-id', reasoningEffort: 'custom-effort',
    permission: 'read-only', nextRunAt: '2026-08-18T09:00:00.000Z',
    createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z',
  })
})

test('mark-read RPC is loopback-only and propagates scoped service calls and cancellation', async () => {
  let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
  let removed = false
  const ctx = {
    connection: {
      rpc: {
        handle: (
          channel: string,
          value: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>,
          options: unknown,
        ) => {
          assert.equal(channel, '/dsh-automation')
          assert.deepEqual(options, { authority: 'loopback' })
          handler = value
          return async () => { removed = true }
        },
      },
    },
  }
  const calls: Array<{ scope: unknown; runId: string; signal: AbortSignal | undefined }> = []
  const service = {
    markRead: async (scope: unknown, runId: string, signal?: AbortSignal) => {
      calls.push({ scope, runId, signal })
      return { id: runId, unread: false }
    },
  }
  const remove = registerAutomationRpc(ctx, service as never)
  const controller = new AbortController()

  const response = await handler?.('mark-read', {
    sessionId: 'session-source',
    runId: 'run-deleted-definition',
  }, controller.signal)
  assert.deepEqual(response, {
    ok: true,
    value: { runId: 'run-deleted-definition', unread: false },
  })
  assert.deepEqual(calls, [{
    scope: { sessionId: 'session-source', creatorKind: 'web' },
    runId: 'run-deleted-definition',
    signal: controller.signal,
  }])

  controller.abort()
  const cancelled = await handler?.('mark-read', {
    sessionId: 'session-source',
    runId: 'run-not-admitted',
  }, controller.signal)
  assert.deepEqual(cancelled, {
    ok: false,
    error: { code: 'cancelled', message: 'The automation request was cancelled.', details: {} },
  })
  assert.equal(calls.length, 1)
  await remove()
  assert.equal(removed, true)
})

test('archive-run and delete-run RPCs propagate scoped service calls', async () => {
  let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
  let removed = false
  const ctx = {
    connection: {
      rpc: {
        handle: (
          channel: string,
          value: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>,
          options: unknown,
        ) => {
          assert.equal(channel, '/dsh-automation')
          assert.deepEqual(options, { authority: 'loopback' })
          handler = value
          return async () => { removed = true }
        },
      },
    },
  }
  const calls: Array<{ method: string; scope: unknown; runId: string }> = []
  const service = {
    archiveRun: async (scope: unknown, runId: string) => {
      calls.push({ method: 'archiveRun', scope, runId })
      return { id: runId, unread: false }
    },
    deleteRun: async (scope: unknown, runId: string) => {
      calls.push({ method: 'deleteRun', scope, runId })
      return { id: runId, deleted: true }
    },
  }
  const remove = registerAutomationRpc(ctx, service as never)
  const signal = new AbortController().signal

  const archived = await handler?.('archive-run', { sessionId: 'session-source', runId: 'run-archive' }, signal)
  assert.deepEqual(archived, { ok: true, value: { runId: 'run-archive', sessionArchived: true } })

  const deleted = await handler?.('delete-run', { sessionId: 'session-source', runId: 'run-delete' }, signal)
  assert.deepEqual(deleted, { ok: true, value: { id: 'run-delete', deleted: true } })

  assert.deepEqual(calls, [
    { method: 'archiveRun', scope: { sessionId: 'session-source', creatorKind: 'web' }, runId: 'run-archive' },
    { method: 'deleteRun', scope: { sessionId: 'session-source', creatorKind: 'web' }, runId: 'run-delete' },
  ])
  await remove()
  assert.equal(removed, true)
})

test('RPC schedule inputs are strict JSON contracts and do not coerce strings or booleans', async () => {
  let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
  let createCalls = 0
  const ctx = {
    connection: { rpc: { handle: (_channel: string, value: typeof handler) => { handler = value; return async () => {} } } },
  }
  const service = { create: async () => { createCalls += 1; return { id: 'created', revision: 1 } } }
  registerAutomationRpc(ctx as never, service as never)
  const signal = new AbortController().signal
  const base = { sessionId: 'session-source', input: { name: 'Strict input', prompt: 'Inspect one condition.', timeZone: 'UTC' } }

  const interval = await handler?.('create', {
    ...base,
    input: { ...base.input, schedule: { kind: 'interval', everyMinutes: '5' } },
  }, signal) as { readonly ok: boolean; readonly error?: { readonly code: string } }
  assert.equal(interval.ok, false)
  assert.equal(interval.error?.code, 'bad-request')

  const weekly = await handler?.('create', {
    ...base,
    input: { ...base.input, schedule: { kind: 'weekly', time: '09:00', weekdays: [true] } },
  }, signal) as { readonly ok: boolean; readonly error?: { readonly code: string } }
  assert.equal(weekly.ok, false)
  assert.equal(weekly.error?.code, 'bad-request')
  assert.equal(createCalls, 0)
})

test('create RPC preserves omitted, pinned, and explicit live-global model targets', async () => {
  let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
  const calls: unknown[] = []
  const ctx = {
    connection: { rpc: { handle: (_channel: string, value: typeof handler) => { handler = value; return async () => {} } } },
  }
  const service = {
    create: async (_scope: unknown, input: unknown) => {
      calls.push(input)
      return { id: 'created', revision: 1 }
    },
  }
  registerAutomationRpc(ctx as never, service as never)
  const signal = new AbortController().signal
  const base = {
    sessionId: 'session-source',
    input: {
      name: 'Model target', prompt: 'Inspect one condition.', timeZone: 'UTC',
      schedule: { kind: 'daily', time: '09:00' },
    },
  }

  await handler?.('create', base, signal)
  await handler?.('create', {
    ...base,
    input: {
      ...base.input,
      provider: 'provider-route', model: 'model-id', reasoningEffort: 'opaque-effort',
    },
  }, signal)
  await handler?.('create', {
    ...base,
    input: { ...base.input, provider: null, model: null },
  }, signal)
  assert.deepEqual(calls, [
    {
      name: 'Model target', prompt: 'Inspect one condition.',
      schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' }, permissionPreset: 'read-only',
    },
    {
      name: 'Model target', prompt: 'Inspect one condition.',
      schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
      provider: 'provider-route', model: 'model-id', reasoningEffort: 'opaque-effort',
      permissionPreset: 'read-only',
    },
    {
      name: 'Model target', prompt: 'Inspect one condition.',
      schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
      provider: null, model: null, permissionPreset: 'read-only',
    },
  ])

  const partial = await handler?.('create', {
    ...base,
    input: { ...base.input, provider: 'provider-only' },
  }, signal) as { readonly ok: boolean; readonly error?: { readonly code: string } }
  assert.equal(partial.ok, false)
  assert.equal(partial.error?.code, 'bad-request')
  assert.equal(calls.length, 3)
})

test('update RPC replaces editable fields behind an expected revision guard', async () => {
  let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
  const calls: Array<{ scope: unknown; id: string; input: unknown; signal: AbortSignal | undefined }> = []
  const ctx = {
    connection: { rpc: { handle: (_channel: string, value: typeof handler) => { handler = value; return async () => {} } } },
  }
  const service = {
    update: async (scope: unknown, id: string, input: unknown, signal?: AbortSignal) => {
      calls.push({ scope, id, input, signal })
      return { id, revision: 4 }
    },
  }
  registerAutomationRpc(ctx as never, service as never)
  const signal = new AbortController().signal
  const response = await handler?.('update', {
    sessionId: 'session-source',
    automationId: 'automation-edit',
    expectedRevision: 3,
    input: {
      name: 'Edited task',
      prompt: 'The complete edited prompt.',
      schedule: { kind: 'weekly', time: '09:15', weekdays: [1, 5] },
      timeZone: 'Asia/Shanghai',
      provider: 'provider-route',
      model: 'model-id',
      reasoningEffort: 'opaque-effort',
      permission: 'workspace-write',
    },
  }, signal)

  assert.deepEqual(response, { ok: true, value: { id: 'automation-edit', revision: 4 } })
  assert.deepEqual(calls, [{
    scope: { sessionId: 'session-source', creatorKind: 'web' },
    id: 'automation-edit',
    input: {
      expectedRevision: 3,
      name: 'Edited task',
      prompt: 'The complete edited prompt.',
      provider: 'provider-route',
      model: 'model-id',
      reasoningEffort: 'opaque-effort',
      schedule: { kind: 'weekly', time: '09:15', weekdays: ['MO', 'FR'], timeZone: 'Asia/Shanghai' },
      permissionPreset: 'workspace-write',
    },
    signal,
  }])
})

test('settings-update validates ranges and forwards scoped policy writes', async () => {
  let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
  const ctx = {
    connection: { rpc: { handle: (_channel: string, value: typeof handler) => { handler = value; return async () => {} } } },
  }
  const calls: Array<{ scope: unknown; next: unknown }> = []
  const service = {
    updateSettings: async (scope: unknown, next: unknown) => { calls.push({ scope, next }); return next },
  }
  registerAutomationRpc(ctx as never, service as never)
  const signal = new AbortController().signal

  const response = await handler?.('settings-update', {
    sessionId: 'session-source',
    settings: { catchUpMissedRuns: true, catchUpMissedRunsMax: 9, misfireGraceMinutes: 30 },
  }, signal)
  assert.deepEqual(response, {
    ok: true,
    value: { settings: { catchUpMissedRuns: true, catchUpMissedRunsMax: 9, misfireGraceMinutes: 30 } },
  })
  assert.deepEqual(calls, [{
    scope: { sessionId: 'session-source', creatorKind: 'web' },
    next: { catchUpMissedRuns: true, catchUpMissedRunsMax: 9, misfireGraceMinutes: 30 },
  }])

  const rejected = await handler?.('settings-update', {
    sessionId: 'session-source',
    settings: { catchUpMissedRuns: true, catchUpMissedRunsMax: 2_000, misfireGraceMinutes: 30 },
  }, signal) as { readonly ok: false; readonly error: { readonly code: string } }
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.code, 'bad-request')
  assert.equal(calls.length, 1)
})

test('run-now forwards the manual run mode and rejects unknown modes', async () => {
  let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
  const ctx = {
    connection: { rpc: { handle: (_channel: string, value: typeof handler) => { handler = value; return async () => {} } } },
  }
  const calls: Array<{ scope: unknown; id: string; options: unknown }> = []
  const service = {
    runNow: async (scope: unknown, id: string, options: unknown) => {
      calls.push({ scope, id, options })
      return { id: 'run-1' }
    },
  }
  registerAutomationRpc(ctx as never, service as never)
  const signal = new AbortController().signal

  const ahead = await handler?.('run-now', {
    sessionId: 'session-source',
    automationId: 'automation-ahead',
    mode: 'ahead',
  }, signal)
  assert.deepEqual(ahead, { ok: true, value: { runId: 'run-1' } })

  const plain = await handler?.('run-now', {
    sessionId: 'session-source',
    automationId: 'automation-plain',
  }, signal)
  assert.deepEqual(plain, { ok: true, value: { runId: 'run-1' } })
  assert.deepEqual(calls, [
    {
      scope: { sessionId: 'session-source', creatorKind: 'web' },
      id: 'automation-ahead',
      options: { replaceNext: true },
    },
    {
      scope: { sessionId: 'session-source', creatorKind: 'web' },
      id: 'automation-plain',
      options: { replaceNext: false },
    },
  ])

  const rejected = await handler?.('run-now', {
    sessionId: 'session-source',
    automationId: 'automation-bad',
    mode: 'sideways',
  }, signal) as { readonly ok: false; readonly error: { readonly code: string } }
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.code, 'bad-request')
  assert.equal(calls.length, 2)
})

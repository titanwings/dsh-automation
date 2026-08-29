import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AutomationFormError,
  buildCreateInput,
  buildMonthCalendarGrid,
  buildUpdateInput,
  buildWeekCalendarDays,
  countAutomationsOnDay,
  defaultFormState,
  deriveOverview,
  formStateFromAutomation,
  formatRelativeTime,
  formatSchedule,
  isSameLocalDay,
  modelRouteChoices,
  readSortDefault,
  reasoningEffortChoices,
  sortAutomations,
  startOfLocalWeek,
  writeSortDefault,
  WORKSPACE_SORT_DEFAULT_KEY,
} from '../src/client/helpers.js'
import { en, zh } from '../src/client/locales.js'
import { RecentRun } from '../src/client/AutomationView.js'
import { createAutomationRuntime, loadModelCatalog } from '../src/client/runtime.js'
import type { AutomationSnapshot, ModelCatalog } from '../src/client/protocol.js'

const t = (key: keyof typeof en, params?: Record<string, unknown>): string => {
  let value: string = en[key]
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replaceAll(`{${name}}`, String(replacement))
  }
  return value
}

test('English and Chinese dictionaries own exactly the same keys', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  assert.equal(en.tab, 'Automations')
  assert.equal(zh.tab, '自动化')
})

test('overview labels distinguish enabled definitions from running executions', () => {
  assert.equal(en['stats.active'], 'Active')
  assert.equal(zh['stats.active'], '已启用')
  assert.notEqual(zh['stats.active'], zh['status.running'])
})

test('buildCreateInput trims text and normalizes a weekly schedule', () => {
  const form = {
    ...defaultFormState(new Date('2026-08-13T00:00:00Z')),
    name: '  Regression triage  ',
    prompt: '  Inspect failed tests.  ',
    scheduleKind: 'weekly' as const,
    time: '08:30',
    weekdays: [5, 1, 3],
    timeZone: 'Asia/Shanghai',
    permission: 'workspace-write' as const,
  }
  assert.deepEqual(buildCreateInput(form, new Date('2026-08-13T00:00:00Z')), {
    name: 'Regression triage',
    prompt: 'Inspect failed tests.',
    schedule: { kind: 'weekly', time: '08:30', weekdays: [1, 3, 5], timeZone: 'Asia/Shanghai' },
    timeZone: 'Asia/Shanghai',
    provider: null,
    model: null,
    reasoningEffort: null,
    permission: 'workspace-write',
  })
})

test('buildCreateInput rejects empty weekly days and unsafe intervals', () => {
  const base = { ...defaultFormState(), name: 'Task', prompt: 'Do the task.' }
  assert.throws(
    () => buildCreateInput({ ...base, scheduleKind: 'weekly', weekdays: [] }),
    (error: unknown) => error instanceof AutomationFormError && error.key === 'form.error.weekdays',
  )
  assert.throws(
    () => buildCreateInput({ ...base, scheduleKind: 'interval', everyMinutes: '1' }),
    (error: unknown) => error instanceof AutomationFormError && error.key === 'form.error.interval',
  )
})

test('editing starts from the complete stored prompt and preserves interval cadence', () => {
  const automation: AutomationSnapshot['automations'][number] = {
    id: 'automation-edit',
    revision: 7,
    name: 'Repository health',
    prompt: 'Inspect every package.\n\nReturn the complete evidence, including exact file paths and commands.',
    status: 'active',
    schedule: {
      kind: 'interval',
      everyMinutes: 45,
      anchor: '2026-08-13T00:15:00.000Z',
      timeZone: 'Asia/Shanghai',
    },
    scheduleSummary: 'Every 45 minutes',
    timeZone: 'Asia/Shanghai',
    provider: 'provider-a',
    model: 'model-a',
    reasoningEffort: 'opaque-high',
    permission: 'workspace-write',
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
  }

  const form = formStateFromAutomation(automation)
  assert.equal(form.prompt, automation.prompt)
  assert.equal(form.intervalAnchor, '2026-08-13T00:15:00.000Z')
  assert.deepEqual(buildCreateInput(form), {
    name: 'Repository health',
    prompt: automation.prompt,
    schedule: {
      kind: 'interval',
      everyMinutes: 45,
      anchor: '2026-08-13T00:15:00.000Z',
      timeZone: 'Asia/Shanghai',
    },
    timeZone: 'Asia/Shanghai',
    provider: 'provider-a',
    model: 'model-a',
    reasoningEffort: 'opaque-high',
    permission: 'workspace-write',
  })
  assert.deepEqual(buildUpdateInput({ ...form, prompt: `${form.prompt}\nAdd a short risk summary.` }, automation), {
    prompt: `${automation.prompt}\nAdd a short risk summary.`,
  })
})

test('editing a completed one-shot can change its prompt without resubmitting a past schedule', () => {
  const automation: AutomationSnapshot['automations'][number] = {
    id: 'automation-once', revision: 2, name: 'Completed migration',
    prompt: 'Summarize the migration.', status: 'paused',
    schedule: { kind: 'once', at: '2026-08-12T08:00:00.000Z', timeZone: 'UTC' },
    scheduleSummary: 'Once', timeZone: 'UTC', provider: null, model: null,
    reasoningEffort: null, permission: 'read-only',
    createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-12T08:00:00.000Z',
  }
  const form = formStateFromAutomation(automation)
  assert.deepEqual(buildUpdateInput(
    { ...form, prompt: 'Summarize the migration and include evidence.' },
    automation,
    new Date('2026-08-17T00:00:00.000Z'),
  ), { prompt: 'Summarize the migration and include evidence.' })
})

test('model edits preserve omission, clear with null, and pin opaque effort values', () => {
  const automation: AutomationSnapshot['automations'][number] = {
    id: 'automation-model', revision: 4, name: 'Model target',
    prompt: 'Inspect one condition.', status: 'active',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
    scheduleSummary: 'Daily', timeZone: 'UTC', permission: 'read-only',
    provider: 'provider-a', model: 'model-a', reasoningEffort: 'adapter-high',
    createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-12T08:00:00.000Z',
  }
  const form = formStateFromAutomation(automation)

  assert.deepEqual(buildUpdateInput(form, automation), {})
  assert.deepEqual(buildUpdateInput({ ...form, reasoningEffort: null }, automation), {
    reasoningEffort: null,
  })
  assert.deepEqual(buildUpdateInput({
    ...form,
    provider: 'provider-b',
    model: 'model-b',
    reasoningEffort: 'provider-owned-effort',
  }, automation), {
    provider: 'provider-b',
    model: 'model-b',
    reasoningEffort: 'provider-owned-effort',
  })
  assert.deepEqual(buildUpdateInput({
    ...form,
    provider: null,
    model: null,
    reasoningEffort: null,
  }, automation), {
    provider: null,
    model: null,
    reasoningEffort: null,
  })
})

test('catalog choices keep successful providers and unavailable current pins', () => {
  const catalog: ModelCatalog = {
    groups: [{
      id: 'provider-live',
      name: 'Live Provider',
      models: [{
        id: 'model-live',
        name: 'Live Model',
        reasoning: {
          efforts: [
            { id: 'adapter-low', name: 'Low' },
            { id: 'adapter-high', name: 'High', description: 'More reasoning' },
          ],
          defaultEffort: 'adapter-low',
        },
      }],
    }],
    failures: [{ id: 'provider-offline', name: 'Offline Provider', message: 'catalog offline' }],
  }

  assert.deepEqual(modelRouteChoices(catalog, 'provider-removed', 'model-removed'), [
    {
      provider: 'provider-removed', providerName: 'provider-removed',
      model: 'model-removed', modelName: 'model-removed', unavailable: true,
    },
    {
      provider: 'provider-live', providerName: 'Live Provider',
      model: 'model-live', modelName: 'Live Model', unavailable: false,
    },
  ])
  assert.deepEqual(reasoningEffortChoices(
    catalog,
    'provider-live',
    'model-live',
    'adapter-retired',
  ), [
    { id: 'adapter-retired', name: 'adapter-retired', unavailable: true },
    { id: 'adapter-low', name: 'Low', unavailable: false },
    { id: 'adapter-high', name: 'High', description: 'More reasoning', unavailable: false },
  ])
})

test('Host-wide model catalog uses the official API envelope and preserves partial failures', async () => {
  const catalog: ModelCatalog = {
    groups: [{ id: 'provider', name: 'Provider', models: [{ id: 'model', name: 'Model' }] }],
    failures: [{ id: 'broken', name: 'Broken', message: 'offline' }],
  }
  const calls: unknown[] = []
  const value = await loadModelCatalog({
    models: async (payload) => {
      calls.push(payload)
      return { result: { ok: true, value: catalog } }
    },
  })
  assert.deepEqual(calls, [{}])
  assert.equal(value, catalog)

  await assert.rejects(() => loadModelCatalog({
    models: async () => ({
      result: { ok: false, error: { code: 'catalog-unavailable', message: 'host offline' } },
    }),
  }), /host offline/)
})

test('deriveOverview counts active definitions and unread failures', () => {
  const snapshot: AutomationSnapshot = {
    scope: { cwd: '/workspace' },
    serverNow: '2026-08-13T00:00:00.000Z',
    automations: [
      {
        id: 'a1', revision: 1, name: 'A', prompt: 'A', status: 'active',
        schedule: { kind: 'daily', time: '09:00' }, scheduleSummary: 'Daily at 09:00',
        timeZone: 'UTC', provider: null, model: null, reasoningEffort: null,
        permission: 'read-only', nextRunAt: '2026-08-13T09:00:00.000Z',
        createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z',
      },
      {
        id: 'a2', revision: 1, name: 'B', prompt: 'B', status: 'paused',
        schedule: { kind: 'interval', everyMinutes: 60 }, scheduleSummary: 'Every hour',
        timeZone: 'UTC', provider: 'provider-b', model: 'model-b', reasoningEffort: null,
        permission: 'workspace-write', createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
    ],
    runs: [
      { id: 'r1', automationId: 'a1', automationName: 'A', status: 'failed', trigger: 'schedule', scheduledFor: '2026-08-12T09:00:00.000Z', sessionArchived: false },
      { id: 'r2', automationId: 'a1', automationName: 'A', status: 'failed', trigger: 'schedule', scheduledFor: '2026-08-11T09:00:00.000Z', sessionArchived: false, unread: false },
      { id: 'r3', automationId: 'a2', automationName: 'B', status: 'succeeded', trigger: 'manual', scheduledFor: '2026-08-12T10:00:00.000Z', sessionArchived: false },
    ],
  }
  assert.deepEqual(deriveOverview(snapshot), {
    total: 2,
    active: 1,
    attention: 1,
    nextRunAt: '2026-08-13T09:00:00.000Z',
  })
})

test('calendar helpers build Monday-first week and month grids', () => {
  const cursor = new Date(2026, 7, 27)
  const week = buildWeekCalendarDays(cursor)
  assert.equal(week.length, 7)
  assert.equal(week[0]?.getDay(), 1)
  assert.equal(week[6]?.getDay(), 0)
  assert.equal(isSameLocalDay(startOfLocalWeek(cursor), new Date(2026, 7, 24)), true)

  const month = buildMonthCalendarGrid(cursor)
  assert.equal(month.length, 42)
  assert.equal(month[0]?.getDay(), 1)

  const item: AutomationSnapshot['automations'][number] = {
    id: 'calendar-a', revision: 1, name: 'Calendar A', prompt: 'P', status: 'active',
    schedule: { kind: 'once', at: '2026-08-27T00:00:00.000Z', timeZone: 'UTC' },
    scheduleSummary: 'Once', timeZone: 'UTC', provider: null, model: null,
    reasoningEffort: null, permission: 'read-only',
    nextRunAt: new Date(2026, 7, 27, 9).toISOString(),
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  }
  assert.equal(countAutomationsOnDay([item], new Date(2026, 7, 27)), 1)
  assert.equal(countAutomationsOnDay([item], new Date(2026, 7, 28)), 0)
})

test('formatRelativeTime handles past and future windows', () => {
  const now = new Date('2026-08-13T12:00:00.000Z')
  assert.equal(formatRelativeTime('2026-08-13T11:48:00.000Z', now, t), '12m ago')
  assert.equal(formatRelativeTime('2026-08-13T14:00:00.000Z', now, t), 'in 2h')
  assert.equal(formatRelativeTime('2026-08-16T12:00:00.000Z', now, t), 'in 3d')
})

test('formatSchedule localizes friendly cadence instead of exposing raw RRULE', () => {
  const translateZh = (key: keyof typeof zh, params?: Record<string, unknown>): string => {
    let value = zh[key]
    for (const [name, replacement] of Object.entries(params ?? {})) {
      value = value.replaceAll(`{${name}}`, String(replacement))
    }
    return value
  }
  assert.equal(formatSchedule({
    kind: 'weekly', weekdays: [1, 3, 5], time: '09:30', timeZone: 'Asia/Shanghai',
  }, translateZh), '周一 · 周三 · 周五 · 09:30')
  assert.equal(formatSchedule({
    kind: 'interval', everyMinutes: 30, anchor: '2026-08-13T00:00:00Z', timeZone: 'UTC',
  }, translateZh), '每 30 分钟')
})

test('opening a run Session marks it read only after navigation succeeds', async () => {
  const calls: Array<{ endpoint: string; payload: unknown }> = []
  const rpc = {
    call: async (_channel: string, endpoint: string, payload: unknown) => {
      calls.push({ endpoint, payload })
      if (endpoint === 'snapshot') {
        return {
          ok: true,
          value: { scope: { cwd: '/workspace' }, automations: [], runs: [], serverNow: new Date().toISOString() },
        }
      }
      return { ok: true, value: {} }
    },
  }
  const runtime = createAutomationRuntime(rpc, 'session-source')

  await runtime.openRunSession('run-1', async () => {})
  assert.deepEqual(calls.map(call => call.endpoint), ['mark-read', 'snapshot'])
  assert.deepEqual(calls[0]?.payload, { sessionId: 'session-source', runId: 'run-1' })

  calls.length = 0
  await assert.rejects(
    () => runtime.openRunSession('run-2', async () => { throw new Error('navigation failed') }),
    /navigation failed/,
  )
  assert.equal(calls.length, 0)

  await runtime.markRunRead('run-without-session')
  assert.deepEqual(calls.map(call => call.endpoint), ['mark-read', 'snapshot'])
  assert.deepEqual(calls[0]?.payload, { sessionId: 'session-source', runId: 'run-without-session' })
})

test('an archived run labels its Session without rendering a broken open button', () => {
  type RenderedChild = {
    readonly type?: unknown
    readonly props?: { readonly className?: string; readonly children?: unknown }
  }
  type RenderedRun = { readonly props: { readonly children: readonly RenderedChild[] } }
  const common = {
    id: 'run-archived', automationId: 'automation-1', automationName: 'Archived result',
    status: 'succeeded' as const, trigger: 'manual' as const,
    scheduledFor: '2026-08-17T00:00:00.000Z', sessionId: 'dsh-automation-session-archived',
  }
  const archived = RecentRun({
    run: { ...common, sessionArchived: true },
    now: new Date('2026-08-17T00:00:01.000Z'), t, busy: false,
    onOpen: () => { throw new Error('archived Session must not be opened') },
    onMarkRead: () => {},
  }) as unknown as RenderedRun
  const archivedAction = archived.props.children.find(child => child?.props?.className?.includes('--archived'))
  assert.equal(archivedAction?.type, 'span')
  assert.match(String(archivedAction?.props?.children), /Session archived/)
  assert.equal(archived.props.children.some(child => child?.type === 'button'
    && child?.props?.className === 'dsh-automation-session-id'), false)

  const visible = RecentRun({
    run: { ...common, sessionArchived: false },
    now: new Date('2026-08-17T00:00:01.000Z'), t, busy: false,
    onOpen: () => {}, onMarkRead: () => {},
  }) as unknown as RenderedRun
  assert.equal(visible.props.children.some(child => child?.type === 'button'
    && child?.props?.className === 'dsh-automation-session-id'), true)
})

test('editing sends a revision-guarded update and refreshes the snapshot', async () => {
  const calls: Array<{ endpoint: string; payload: unknown }> = []
  const rpc = {
    call: async (_channel: string, endpoint: string, payload: unknown) => {
      calls.push({ endpoint, payload })
      if (endpoint === 'snapshot') {
        return {
          ok: true,
          value: { scope: { cwd: '/workspace' }, automations: [], runs: [], serverNow: new Date().toISOString() },
        }
      }
      return { ok: true, value: { id: 'automation-edit', revision: 8 } }
    },
  }
  const runtime = createAutomationRuntime(rpc, 'session-source')
  const input = {
    name: 'Edited task',
    prompt: 'Keep the complete edited prompt.',
    schedule: { kind: 'daily' as const, time: '08:30', timeZone: 'UTC' },
    timeZone: 'UTC',
    permission: 'read-only' as const,
  }

  await runtime.updateAutomation('automation-edit', 7, input)

  assert.deepEqual(calls.map(call => call.endpoint), ['update', 'snapshot'])
  assert.deepEqual(calls[0]?.payload, {
    sessionId: 'session-source',
    automationId: 'automation-edit',
    expectedRevision: 7,
    input,
  })
})

const sortItem = (id: string, name: string, createdAt: string, nextRunAt?: string): AutomationSnapshot['automations'][number] => ({
  id,
  revision: 1,
  name,
  prompt: 'Task.',
  status: 'active',
  schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' },
  scheduleSummary: 'Daily · 09:00',
  timeZone: 'UTC',
  provider: null,
  model: null,
  reasoningEffort: null,
  permission: 'read-only',
  createdAt,
  updatedAt: createdAt,
  ...(nextRunAt === undefined ? {} : { nextRunAt }),
})

test('workspace automation sort supports created and planned time with a stable fallback', () => {
  const items = [
    sortItem('a', 'Alpha', '2026-08-10T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
    sortItem('b', 'Beta', '2026-08-11T00:00:00.000Z', '2026-08-15T00:00:00.000Z'),
    sortItem('c', 'Gamma', '2026-08-12T00:00:00.000Z'),
  ]

  assert.deepEqual(sortAutomations(items, 'created', 'desc').map(item => item.id), ['c', 'b', 'a'])
  assert.deepEqual(sortAutomations(items, 'created', 'asc').map(item => item.id), ['a', 'b', 'c'])
  // Planned ascending keeps the unpinned task last, regardless of direction.
  assert.deepEqual(sortAutomations(items, 'planned', 'asc').map(item => item.id), ['b', 'a', 'c'])
  assert.deepEqual(sortAutomations(items, 'planned', 'desc').map(item => item.id), ['a', 'b', 'c'])
})

test('sort default preferences survive storage roundtrips and reject corrupt values', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }

  assert.equal(readSortDefault(storage, WORKSPACE_SORT_DEFAULT_KEY), undefined)
  writeSortDefault(storage, WORKSPACE_SORT_DEFAULT_KEY, 'planned', 'asc')
  assert.deepEqual(readSortDefault(storage, WORKSPACE_SORT_DEFAULT_KEY), { key: 'planned', direction: 'asc' })

  values.set(WORKSPACE_SORT_DEFAULT_KEY, '{broken')
  assert.equal(readSortDefault(storage, WORKSPACE_SORT_DEFAULT_KEY), undefined)
  values.set(WORKSPACE_SORT_DEFAULT_KEY, JSON.stringify({ key: 'title', direction: 'asc' }))
  assert.equal(readSortDefault(storage, WORKSPACE_SORT_DEFAULT_KEY), undefined)
})

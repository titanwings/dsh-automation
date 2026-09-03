import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AutomationFormError,
  buildCreateInput,
  buildMonthCalendarGrid,
  buildUpdateInput,
  buildWeekCalendarDays,
  clearDraft,
  countAutomationsByStatusOnDay,
  countAutomationsOnDay,
  defaultFormState,
  deriveOverview,
  formStateFromAutomation,
  formatRelativeTime,
  formatSchedule,
  isSameLocalDay,
  modelRouteChoices,
  readDraft,
  readSortDefault,
  reasoningEffortChoices,
  resolveSortPreferenceStorage,
  sortAutomations,
  startOfLocalWeek,
  writeDraft,
  writeSortDefault,
  WORKSPACE_SORT_DEFAULT_KEY,
} from '../src/client/helpers.js'
import { en, zh } from '../src/client/locales.js'
import { clampAutomationFloatBox, initialAutomationFloatBox, RecentRun } from '../src/client/AutomationView.js'
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
  assert.equal(en['section.runs'], 'Run history')
  assert.equal(zh['section.runs'], '运行记录')
  assert.equal(en['run.readd'], 'Add as new')
  assert.equal(zh['run.readd'], '重新添加')
})

test('overview labels distinguish enabled definitions from running executions', () => {
  assert.equal(zh['stats.attention'], '需要处理')
  assert.equal(zh['stats.noAttention'], '一切正常')
  assert.equal(zh['stats.currentStatus'], '当前状态：')
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

test('the fresh create form defaults to a single future run', () => {
  const now = new Date('2026-08-13T00:00:00Z')
  const form = defaultFormState(now)
  assert.equal(form.scheduleKind, 'once')
  const once = new Date(form.onceAt)
  assert.equal(Number.isNaN(once.getTime()), false)
  assert.equal(once.getTime() > now.getTime(), true)
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

test('Host-wide model catalog loads through the Session API and rejects malformed values', async () => {
  const catalog: ModelCatalog = {
    groups: [{ id: 'provider', name: 'Provider', models: [{ id: 'model', name: 'Model' }] }],
    failures: [{ id: 'broken', name: 'Broken', message: 'offline' }],
  }
  const remote = {
    session: { modelCatalog: async () => ({ ok: true as const, value: catalog }) },
  }
  assert.equal(await loadModelCatalog(remote), catalog)
  assert.equal((await remote.session.modelCatalog()).ok, true)

  await assert.rejects(() => loadModelCatalog({
    session: {
      modelCatalog: async () => ({
        ok: false,
        error: { code: 'catalog-unavailable', message: 'host offline' },
      }),
    },
  }), /host offline/)
  await assert.rejects(() => loadModelCatalog({
    session: {
      modelCatalog: async () => ({
        ok: true,
        value: { groups: undefined, failures: [] } as unknown as ModelCatalog,
      }),
    },
  }), /invalid response/)
})

test('floating editor geometry remains fully visible in narrow and resized viewports', () => {
  assert.deepEqual(initialAutomationFloatBox(undefined, { width: 320, height: 240 }), {
    x: 8, y: 8, w: 304, h: 224,
  })
  assert.deepEqual(initialAutomationFloatBox(
    { left: 300, right: 320, top: 220, bottom: 240 },
    { width: 320, height: 240 },
  ), { x: 8, y: 8, w: 304, h: 224 })
  assert.deepEqual(clampAutomationFloatBox(
    { x: -20, y: -20, w: 100, h: 100 },
    { width: 640, height: 480 },
  ), { x: 8, y: 8, w: 320, h: 320 })
  assert.deepEqual(clampAutomationFloatBox(
    { x: 900, y: 700, w: 900, h: 900 },
    { width: 1024, height: 768 },
  ), { x: 116, y: 8, w: 900, h: 752 })
})

test('floating editor geometry honours the visual viewport origin', () => {
  const viewport = { width: 800, height: 600, offsetLeft: 40, offsetTop: 60 }
  const initial = initialAutomationFloatBox(undefined, viewport)
  assert.equal(initial.x >= 48, true)
  assert.equal(initial.y >= 68, true)
  assert.equal(initial.x + initial.w <= 40 + 800 - 8, true)
  assert.equal(initial.y + initial.h <= 60 + 600 - 8, true)

  const clamped = clampAutomationFloatBox(
    { x: -200, y: -200, w: 100, h: 100 },
    viewport,
  )
  assert.equal(clamped.x >= 48, true)
  assert.equal(clamped.y >= 68, true)
  assert.equal(clamped.w, 320)
  assert.equal(clamped.h, 320)

  const clampedLow = clampAutomationFloatBox(
    { x: 900, y: 900, w: 900, h: 900 },
    viewport,
  )
  assert.equal(clampedLow.x + clampedLow.w <= 40 + 800 - 8, true)
  assert.equal(clampedLow.y + clampedLow.h <= 60 + 600 - 8, true)
})

test('deriveOverview counts unread problem runs and ignores reviewed ones', () => {
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
      { id: 'r4', automationId: 'a1', automationName: 'A', status: 'skipped', trigger: 'schedule', scheduledFor: '2026-08-12T11:00:00.000Z', sessionArchived: false },
      { id: 'r5', automationId: 'a1', automationName: 'A', status: 'cancelled', trigger: 'manual', scheduledFor: '2026-08-12T12:00:00.000Z', sessionArchived: false, unread: false },
    ],
  }
  assert.deepEqual(deriveOverview(snapshot), {
    total: 2,
    active: 1,
    attention: 2,
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

test('calendar counts split active and paused tasks on the same day', () => {
  const active: AutomationSnapshot['automations'][number] = {
    id: 'day-active', revision: 1, name: 'A', prompt: 'P', status: 'active',
    schedule: { kind: 'daily', time: '09:00', timeZone: 'UTC' }, scheduleSummary: 'Daily',
    timeZone: 'UTC', provider: null, model: null, reasoningEffort: null, permission: 'read-only',
    nextRunAt: new Date(2026, 7, 27, 9).toISOString(),
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  }
  const paused: AutomationSnapshot['automations'][number] = {
    ...active, id: 'day-paused', status: 'paused',
    nextRunAt: new Date(2026, 7, 27, 10).toISOString(),
  }
  assert.deepEqual(countAutomationsByStatusOnDay([active, paused], new Date(2026, 7, 27)), { active: 1, paused: 1 })
  assert.deepEqual(countAutomationsByStatusOnDay([active, paused], new Date(2026, 7, 28)), { active: 0, paused: 0 })
})

test('storage discovery tolerates browsers that deny localStorage access', () => {
  assert.equal(resolveSortPreferenceStorage(undefined), undefined)
  assert.equal(resolveSortPreferenceStorage({
    get localStorage(): never { throw new Error('denied') },
  }), undefined)
})

test('create-form drafts roundtrip through storage and reject corrupt values', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
  const key = 'dsh-automation.draft.workspace.test'
  assert.equal(readDraft(storage, key), undefined)

  const form = { ...defaultFormState(new Date('2026-08-27T00:00:00Z')), name: 'Draft name', prompt: 'Draft prompt' }
  writeDraft(storage, key, form)
  assert.equal(readDraft(storage, key)?.name, 'Draft name')

  values.set(key, '{broken')
  assert.equal(readDraft(storage, key), undefined)

  values.set(key, JSON.stringify({ name: 'No prompt', scheduleKind: 'daily' }))
  assert.equal(readDraft(storage, key), undefined)

  clearDraft(storage, key)
  assert.equal(storage.getItem(key), null)

  const deniedStorage = {
    getItem: () => { throw new Error('denied') },
    setItem: () => { throw new Error('denied') },
    removeItem: () => { throw new Error('denied') },
  }
  assert.equal(readDraft(deniedStorage, key), undefined)
  assert.doesNotThrow(() => writeDraft(deniedStorage, key, form))
  assert.doesNotThrow(() => clearDraft(deniedStorage, key))
  assert.equal(readSortDefault(deniedStorage, WORKSPACE_SORT_DEFAULT_KEY), undefined)
  assert.doesNotThrow(() => writeSortDefault(deniedStorage, WORKSPACE_SORT_DEFAULT_KEY, 'created', 'desc'))
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
  type RenderedNode = {
    readonly type?: unknown
    readonly props?: { readonly className?: string; readonly children?: unknown; readonly 'aria-label'?: string }
  }
  const flatten = (node: unknown): RenderedNode[] => {
    if (node === null || node === undefined || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return []
    if (Array.isArray(node)) return node.flatMap(flatten)
    const element = node as RenderedNode
    if (typeof element !== 'object') return []
    return [element, ...flatten(element.props?.children)]
  }
  const render = (sessionArchived: boolean): RenderedNode[] => flatten(RecentRun({
    run: {
      id: 'run-archived', automationId: 'automation-1', automationName: 'Archived result',
      status: 'succeeded' as const, trigger: 'manual' as const,
      scheduledFor: '2026-08-17T00:00:00.000Z', sessionId: 'dsh-automation-session-archived',
      sessionArchived,
    },
    now: new Date('2026-08-17T00:00:01.000Z'), t, busy: false,
    automationMissing: false, confirmingDelete: false,
    onOpen: () => { throw new Error('archived Session must not be opened') },
    onMarkRead: () => {}, onReadd: () => {},
    onConfirmDelete: () => {}, onDelete: () => {},
  }) as unknown)

  const archived = render(true)
  const archivedLabel = archived.find(child => child.props?.className?.includes('--archived'))
  assert.equal(archivedLabel?.type, 'span')
  assert.match(String(archivedLabel?.props?.children), /Session archived/)
  assert.equal(archived.some(child => child.type === 'button'
    && child.props?.className === 'dsh-automation-session-id'), false)

  const visible = render(false)
  assert.equal(visible.some(child => child.type === 'button'
    && child.props?.className === 'dsh-automation-session-id'), true)
})

test('run cards expose re-add and record-delete actions with a confirm step', () => {
  type RenderedNode = {
    readonly type?: unknown
    readonly props?: { readonly className?: string; readonly children?: unknown; readonly 'aria-label'?: string; readonly disabled?: boolean }
  }
  const flatten = (node: unknown): RenderedNode[] => {
    if (node === null || node === undefined || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return []
    if (Array.isArray(node)) return node.flatMap(flatten)
    const element = node as RenderedNode
    if (typeof element !== 'object') return []
    return [element, ...flatten(element.props?.children)]
  }
  const render = (options: { confirmingDelete?: boolean; automationMissing?: boolean } = {}): RenderedNode[] => flatten(RecentRun({
    run: {
      id: 'run-actions', automationId: 'automation-1', automationName: 'Action result',
      status: 'succeeded' as const, trigger: 'schedule' as const,
      scheduledFor: '2026-08-17T00:00:00.000Z', sessionId: 'dsh-automation-session-actions',
      sessionArchived: false,
    },
    now: new Date('2026-08-17T00:00:01.000Z'), t, busy: false,
    automationMissing: options.automationMissing ?? false,
    confirmingDelete: options.confirmingDelete ?? false,
    onOpen: () => {}, onMarkRead: () => {}, onReadd: () => {},
    onConfirmDelete: () => {}, onDelete: () => {},
  }) as unknown)

  const actions = render()
  const buttonText = (className: string): string => actions
    .filter(node => node.type === 'button' && String(node.props?.className).includes(className))
    .map(node => String(node.props?.children))
    .join(' | ')
  assert.match(buttonText('dsh-automation-button'), /Add as new/)
  assert.equal(actions.some(node => node.type === 'button' && node.props?.['aria-label'] === 'Delete record'), true)
  assert.equal(actions.some(node => node.type === 'button' && String(node.props?.children).includes('Archive')), false)

  const missing = render({ automationMissing: true })
  assert.equal(missing.some(node => node.type === 'button'
    && String(node.props?.children).includes('Add as new')), true)
  assert.match(missing.filter(node => node.type === 'h3').map(node => String(node.props?.children)).join(''), /Automation deleted/)

  const confirming = render({ confirmingDelete: true })
  assert.match(confirming.filter(node => node.type === 'button').map(node => String(node.props?.children)).join(' | '), /Confirm delete/)
})

test('skipped and cancelled runs offer mark-reviewed exactly while unread', () => {
  type RenderedNode = {
    readonly type?: unknown
    readonly props?: { readonly className?: string; readonly children?: unknown }
  }
  const flatten = (node: unknown): RenderedNode[] => {
    if (node === null || node === undefined || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return []
    if (Array.isArray(node)) return node.flatMap(flatten)
    const element = node as RenderedNode
    if (typeof element !== 'object') return []
    return [element, ...flatten(element.props?.children)]
  }
  const render = (status: 'skipped' | 'cancelled', unread: boolean): RenderedNode[] => flatten(RecentRun({
    run: {
      id: 'run-problem', automationId: 'automation-1', automationName: 'Problem run',
      status, trigger: 'schedule' as const,
      scheduledFor: '2026-08-17T00:00:00.000Z', sessionArchived: false, unread,
    },
    now: new Date('2026-08-17T00:00:01.000Z'), t, busy: false,
    automationMissing: false, confirmingDelete: false,
    onOpen: () => {}, onMarkRead: () => {}, onReadd: () => {},
    onConfirmDelete: () => {}, onDelete: () => {},
  }) as unknown)
  const offersMarkReviewed = (status: 'skipped' | 'cancelled', unread: boolean): boolean => render(status, unread)
    .some(node => node.type === 'button' && String(node.props?.children).includes('Mark reviewed'))
  for (const status of ['skipped', 'cancelled'] as const) {
    assert.equal(offersMarkReviewed(status, true), true)
    assert.equal(offersMarkReviewed(status, false), false)
  }
})

test('refresh reports an unavailable phase while the source session has no live Agent', async () => {
  let fail = true
  const rpc = {
    call: async (_channel: string, endpoint: string) => {
      if (endpoint === 'snapshot' && fail) {
        throw new Error('The automation UI/tool requires a live source session.')
      }
      return {
        ok: true,
        value: { scope: { cwd: '/workspace' }, automations: [], runs: [], serverNow: new Date().toISOString() },
      }
    },
  }
  const runtime = createAutomationRuntime(rpc, 'session-fresh')

  await assert.rejects(() => runtime.refresh(), /requires a live source session/)
  assert.equal(runtime.source.getSnapshot().phase, 'unavailable')

  fail = false
  await runtime.refresh()
  assert.equal(runtime.source.getSnapshot().phase, 'ready')
})

test('archive and delete run RPCs carry the run id and refresh the snapshot', async () => {
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

  await runtime.archiveRun('run-archive')
  assert.deepEqual(calls.map(call => call.endpoint), ['archive-run', 'snapshot'])
  assert.deepEqual(calls[0]?.payload, { sessionId: 'session-source', runId: 'run-archive' })

  calls.length = 0
  await runtime.deleteRun('run-delete')
  assert.deepEqual(calls.map(call => call.endpoint), ['delete-run', 'snapshot'])
  assert.deepEqual(calls[0]?.payload, { sessionId: 'session-source', runId: 'run-delete' })
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

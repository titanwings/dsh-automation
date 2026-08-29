import type { Translate } from './contracts.js'
import type { AutomationLocaleKey } from './locales.js'
import type {
  AutomationSchedule,
  AutomationRunStatus,
  AutomationSnapshot,
  AutomationViewModel,
  CreateAutomationInput,
  ModelCatalog,
  ModelReasoningEffort,
  UpdateAutomationInput,
} from './protocol.js'

export type ScheduleKind = 'once' | 'interval' | 'daily' | 'weekly'

export interface AutomationFormState {
  readonly name: string
  readonly prompt: string
  readonly scheduleKind: ScheduleKind
  readonly onceAt: string
  readonly everyMinutes: string
  readonly intervalAnchor?: string
  readonly time: string
  readonly weekdays: readonly number[]
  readonly timeZone: string
  readonly provider: string | null
  readonly model: string | null
  readonly reasoningEffort: string | null
  readonly permission: CreateAutomationInput['permission']
}

export type FormErrorKey =
  | 'form.error.name'
  | 'form.error.prompt'
  | 'form.error.once'
  | 'form.error.interval'
  | 'form.error.weekdays'
  | 'form.error.model'

export class AutomationFormError extends Error {
  constructor(readonly key: FormErrorKey) {
    super(key)
  }
}

export function localDateTimeValue(date = new Date()): string {
  const future = new Date(date.getTime() + 60 * 60 * 1000)
  future.setMinutes(0, 0, 0)
  const offset = future.getTimezoneOffset() * 60_000
  return new Date(future.getTime() - offset).toISOString().slice(0, 16)
}

export function defaultFormState(now = new Date()): AutomationFormState {
  return {
    name: '',
    prompt: '',
    scheduleKind: 'daily',
    onceAt: localDateTimeValue(now),
    everyMinutes: '60',
    time: '09:00',
    weekdays: [1, 2, 3, 4, 5],
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    provider: null,
    model: null,
    reasoningEffort: null,
    permission: 'read-only',
  }
}

function exactLocalDateTimeValue(iso: string): string {
  const date = new Date(iso)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

/** Build an editable draft from the complete durable definition, not its card preview. */
export function formStateFromAutomation(automation: AutomationViewModel): AutomationFormState {
  const defaults = defaultFormState()
  const schedule = automation.schedule
  return {
    ...defaults,
    name: automation.name,
    prompt: automation.prompt,
    scheduleKind: schedule.kind,
    onceAt: schedule.kind === 'once' ? exactLocalDateTimeValue(schedule.at) : defaults.onceAt,
    everyMinutes: schedule.kind === 'interval' ? String(schedule.everyMinutes) : defaults.everyMinutes,
    ...(schedule.kind === 'interval' && schedule.anchor !== undefined
      ? { intervalAnchor: schedule.anchor }
      : {}),
    time: schedule.kind === 'daily' || schedule.kind === 'weekly' ? schedule.time : defaults.time,
    weekdays: schedule.kind === 'weekly' ? [...schedule.weekdays] : defaults.weekdays,
    timeZone: automation.timeZone,
    provider: automation.provider,
    model: automation.model,
    reasoningEffort: automation.reasoningEffort,
    permission: automation.permission,
  }
}

function validateModelTarget(form: AutomationFormState): void {
  if ((form.provider === null) !== (form.model === null)) {
    throw new AutomationFormError('form.error.model')
  }
  if (form.reasoningEffort !== null && form.provider === null) {
    throw new AutomationFormError('form.error.model')
  }
}

export function buildCreateInput(form: AutomationFormState, now = new Date()): CreateAutomationInput {
  const name = form.name.trim()
  const prompt = form.prompt.trim()
  if (name === '') throw new AutomationFormError('form.error.name')
  if (prompt === '') throw new AutomationFormError('form.error.prompt')
  validateModelTarget(form)

  let schedule: CreateAutomationInput['schedule']
  switch (form.scheduleKind) {
    case 'once': {
      const at = new Date(form.onceAt)
      if (!Number.isFinite(at.getTime()) || at.getTime() <= now.getTime()) {
        throw new AutomationFormError('form.error.once')
      }
      schedule = { kind: 'once', at: at.toISOString(), timeZone: form.timeZone }
      break
    }
    case 'interval': {
      const everyMinutes = Number(form.everyMinutes)
      if (!Number.isInteger(everyMinutes) || everyMinutes < 5 || everyMinutes > 43_200) {
        throw new AutomationFormError('form.error.interval')
      }
      schedule = {
        kind: 'interval',
        everyMinutes,
        anchor: form.intervalAnchor ?? now.toISOString(),
        timeZone: form.timeZone,
      }
      break
    }
    case 'daily':
      schedule = { kind: 'daily', time: form.time, timeZone: form.timeZone }
      break
    case 'weekly':
      if (form.weekdays.length === 0) throw new AutomationFormError('form.error.weekdays')
      schedule = { kind: 'weekly', time: form.time, weekdays: [...form.weekdays].sort((a, b) => a - b), timeZone: form.timeZone }
      break
  }
  return {
    name,
    prompt,
    schedule,
    timeZone: form.timeZone,
    provider: form.provider,
    model: form.model,
    reasoningEffort: form.reasoningEffort,
    permission: form.permission,
  }
}

function scheduleMatchesDraft(form: AutomationFormState, automation: AutomationViewModel): boolean {
  const schedule = automation.schedule
  if (form.scheduleKind !== schedule.kind || form.timeZone !== automation.timeZone) return false
  switch (schedule.kind) {
    case 'once':
      return form.onceAt === exactLocalDateTimeValue(schedule.at)
    case 'interval':
      return form.everyMinutes === String(schedule.everyMinutes)
        && form.intervalAnchor === schedule.anchor
    case 'daily':
      return form.time === schedule.time
    case 'weekly':
      return form.time === schedule.time
        && [...form.weekdays].sort((a, b) => a - b).join(',') === [...schedule.weekdays].sort((a, b) => a - b).join(',')
  }
}

/** Return only changed fields so editing a completed one-shot does not resubmit its past schedule. */
export function buildUpdateInput(
  form: AutomationFormState,
  automation: AutomationViewModel,
  now = new Date(),
): UpdateAutomationInput {
  const name = form.name.trim()
  const prompt = form.prompt.trim()
  if (name === '') throw new AutomationFormError('form.error.name')
  if (prompt === '') throw new AutomationFormError('form.error.prompt')
  validateModelTarget(form)

  const scheduleChanged = !scheduleMatchesDraft(form, automation)
  const routeChanged = form.provider !== automation.provider || form.model !== automation.model
  const replacement = scheduleChanged ? buildCreateInput(form, now) : undefined
  return {
    ...(name === automation.name ? {} : { name }),
    ...(prompt === automation.prompt ? {} : { prompt }),
    ...(replacement === undefined ? {} : {
      schedule: replacement.schedule,
      timeZone: replacement.timeZone,
    }),
    ...(routeChanged
      ? {
          provider: form.provider,
          model: form.model,
          reasoningEffort: form.reasoningEffort,
        }
      : form.reasoningEffort === automation.reasoningEffort
        ? {}
        : { reasoningEffort: form.reasoningEffort }),
    ...(form.permission === automation.permission ? {} : { permission: form.permission }),
  }
}

export interface ModelRouteChoice {
  readonly provider: string
  readonly providerName: string
  readonly model: string
  readonly modelName: string
  readonly description?: string
  readonly unavailable: boolean
}

/** Flatten successful groups and retain the current pinned route when it disappeared. */
export function modelRouteChoices(
  catalog: ModelCatalog,
  currentProvider: string | null,
  currentModel: string | null,
): readonly ModelRouteChoice[] {
  const choices = catalog.groups.flatMap(group => group.models.map(model => ({
    provider: group.id,
    providerName: group.name,
    model: model.id,
    modelName: model.name,
    ...(model.description === undefined ? {} : { description: model.description }),
    unavailable: false,
  })))
  if (currentProvider === null || currentModel === null
    || choices.some(choice => choice.provider === currentProvider && choice.model === currentModel)) {
    return choices
  }
  return [{
    provider: currentProvider,
    providerName: currentProvider,
    model: currentModel,
    modelName: currentModel,
    unavailable: true,
  }, ...choices]
}

export interface ReasoningEffortChoice extends ModelReasoningEffort {
  readonly unavailable: boolean
}

/** Use exact-model opaque effort ids and retain an unavailable current pin. */
export function reasoningEffortChoices(
  catalog: ModelCatalog,
  provider: string | null,
  model: string | null,
  currentEffort: string | null,
): readonly ReasoningEffortChoice[] {
  const catalogModel = provider === null || model === null
    ? undefined
    : catalog.groups
      .find(group => group.id === provider)
      ?.models.find(item => item.id === model)
  const choices = (catalogModel?.reasoning?.efforts ?? []).map(effort => ({
    ...effort,
    unavailable: false,
  }))
  if (currentEffort === null || choices.some(choice => choice.id === currentEffort)) return choices
  return [{ id: currentEffort, name: currentEffort, unavailable: true }, ...choices]
}

const ATTENTION_STATUSES = new Set<AutomationRunStatus>(['failed', 'interrupted'])

export interface OverviewStats {
  readonly total: number
  readonly active: number
  readonly attention: number
  readonly nextRunAt?: string
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** 周一作为一周的开始，与 dsh-personal-workbench 的周视图一致。 */
export function startOfLocalWeek(date: Date): Date {
  const start = startOfLocalDay(date)
  const offset = (start.getDay() + 6) % 7
  return addLocalDays(start, -offset)
}

export function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

/** 统计 nextRunAt 落在某个本地日期的自动化任务数量。 */
export function countAutomationsOnDay(
  automations: readonly AutomationViewModel[],
  day: Date,
): number {
  let count = 0
  for (const automation of automations) {
    if (automation.nextRunAt !== undefined && isSameLocalDay(new Date(automation.nextRunAt), day)) {
      count += 1
    }
  }
  return count
}

/** 生成周视图的 7 个本地日期（周一起始）。 */
export function buildWeekCalendarDays(cursor: Date): readonly Date[] {
  const start = startOfLocalWeek(cursor)
  return Array.from({ length: 7 }, (_, index) => addLocalDays(start, index))
}

/** 生成月视图的 6x7 日期网格，覆盖该月所在的所有周。 */
export function buildMonthCalendarGrid(cursor: Date): readonly Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const start = startOfLocalWeek(first)
  return Array.from({ length: 42 }, (_, index) => addLocalDays(start, index))
}

export function deriveOverview(snapshot: AutomationSnapshot): OverviewStats {
  const next = snapshot.automations
    .filter(item => item.status === 'active' && item.nextRunAt !== undefined)
    .map(item => item.nextRunAt as string)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0]
  return {
    total: snapshot.automations.length,
    active: snapshot.automations.filter(item => item.status === 'active').length,
    attention: snapshot.runs.filter(run => ATTENTION_STATUSES.has(run.status) && run.unread !== false).length,
    ...(next === undefined ? {} : { nextRunAt: next }),
  }
}

export function formatRelativeTime(iso: string, now: Date, t: Translate): string {
  const value = Date.parse(iso)
  if (!Number.isFinite(value)) return iso
  const deltaMinutes = Math.round((value - now.getTime()) / 60_000)
  const abs = Math.abs(deltaMinutes)
  if (abs < 1) return t('time.now')
  const future = deltaMinutes > 0
  if (abs < 60) return t(future ? 'time.inMinute' : 'time.minuteAgo', { count: abs })
  const hours = Math.round(abs / 60)
  if (hours < 24) return t(future ? 'time.inHour' : 'time.hourAgo', { count: hours })
  const days = Math.round(hours / 24)
  return t(future ? 'time.inDay' : 'time.dayAgo', { count: days })
}

export function shortSessionId(sessionId: string): string {
  return sessionId.length <= 12 ? sessionId : `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`
}

export function formatSchedule(schedule: AutomationSchedule, t: Translate): string {
  switch (schedule.kind) {
    case 'once':
      return t('schedule.onceAt', {
        time: new Date(schedule.at).toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        }),
      })
    case 'interval':
      return t('schedule.everyMinutes', { count: schedule.everyMinutes })
    case 'daily':
      return t('schedule.dailyAt', { time: schedule.time })
    case 'weekly':
      return t('schedule.weeklyAt', {
        days: schedule.weekdays.map(day => t(`day.${day}` as AutomationLocaleKey)).join(' · '),
        time: schedule.time,
      })
  }
}

export type AutomationSortKey = 'created' | 'planned'
export type AutomationSortDirection = 'asc' | 'desc'

function sortStamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** 工作区任务列表排序：计划时间 = nextRunAt，无计划的任务固定排最后。 */
export function sortAutomations(
  items: readonly AutomationViewModel[],
  key: AutomationSortKey,
  direction: AutomationSortDirection,
): AutomationViewModel[] {
  const factor = direction === 'asc' ? 1 : -1
  return items.slice().sort((left, right) => {
    if (key === 'planned') {
      const leftNext = left.nextRunAt
      const rightNext = right.nextRunAt
      if (leftNext === undefined || rightNext === undefined) {
        if (leftNext === undefined && rightNext === undefined) {
          return left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
        }
        return leftNext === undefined ? 1 : -1
      }
      const primary = sortStamp(leftNext) - sortStamp(rightNext)
      if (primary !== 0) return primary * factor
      return left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    }
    const primary = sortStamp(left.createdAt) - sortStamp(right.createdAt)
    if (primary !== 0) return primary * factor
    return left.id.localeCompare(right.id)
  })
}

export interface SortPreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const WORKSPACE_SORT_DEFAULT_KEY = 'dsh-automation.sort-default.workspace'

/** 读取已保存的默认排序；缺失、损坏或无存储时返回 undefined，由调用方用自身默认值。 */
export function readSortDefault(
  storage: SortPreferenceStorage | undefined,
  storageKey: string,
): { readonly key: AutomationSortKey; readonly direction: AutomationSortDirection } | undefined {
  if (storage === undefined) return undefined
  try {
    const raw = storage.getItem(storageKey)
    if (raw === null) return undefined
    const parsed = JSON.parse(raw) as { readonly key?: unknown; readonly direction?: unknown }
    if (parsed.key !== 'created' && parsed.key !== 'planned') return undefined
    if (parsed.direction !== 'asc' && parsed.direction !== 'desc') return undefined
    return { key: parsed.key, direction: parsed.direction }
  } catch {
    return undefined
  }
}

export function writeSortDefault(
  storage: SortPreferenceStorage,
  storageKey: string,
  key: AutomationSortKey,
  direction: AutomationSortDirection,
): void {
  storage.setItem(storageKey, JSON.stringify({ key, direction }))
}

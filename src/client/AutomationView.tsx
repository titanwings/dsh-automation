import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { AutomationViewProps, Translate } from './contracts.js'
import type { AutomationLocaleKey } from './locales.js'
import {
  AutomationFormError,
  buildCreateInput,
  buildMonthCalendarGrid,
  buildUpdateInput,
  buildWeekCalendarDays,
  countAutomationsOnDay,
  defaultFormState,
  deriveOverview,
  formatSchedule,
  formatRelativeTime,
  formStateFromAutomation,
  isSameLocalDay,
  modelRouteChoices,
  reasoningEffortChoices,
  readSortDefault,
  shortSessionId,
  sortAutomations,
  writeSortDefault,
  startOfLocalDay,
  startOfLocalWeek,
  WORKSPACE_SORT_DEFAULT_KEY,
  type AutomationFormState,
  type AutomationSortDirection,
  type AutomationSortKey,
  type ScheduleKind,
  type SortPreferenceStorage,
} from './helpers.js'
import {
  AlertIcon,
  AutomationIcon,
  CalendarIcon,
  CheckIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  ShieldIcon,
  TrashIcon,
} from './icons.js'
import type {
  AutomationRunStatus,
  AutomationRunViewModel,
  AutomationViewModel,
  CreateAutomationInput,
  ModelCatalog,
  UpdateAutomationInput,
} from './protocol.js'

const POLL_INTERVAL_MS = 15_000
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const
const SORT_STORAGE: SortPreferenceStorage | undefined = typeof window === 'undefined' ? undefined : window.localStorage

type BusyAction = 'create' | 'update' | 'pause' | 'resume' | 'run' | 'read' | 'delete'
type TaskView = 'today' | 'all'
type CalendarRangeView = 'list' | 'week' | 'month'

function actionKey(action: BusyAction, id = ''): string {
  return `${action}:${id}`
}

function statusLabel(t: Translate, status: AutomationRunStatus): string {
  return t(`status.${status}`)
}

function AutomationStatusBadge({ status, t }: { status: AutomationViewModel['status']; t: Translate }): JSX.Element {
  return (
    <span className={`dsh-automation-badge dsh-automation-badge--${status}`}>
      <span className="dsh-automation-status-dot" />
      {t(`status.${status}`)}
    </span>
  )
}

function RunStatusBadge({ status, t }: { status: AutomationRunStatus; t: Translate }): JSX.Element {
  const icon = status === 'succeeded'
    ? <CheckIcon />
    : status === 'failed' || status === 'interrupted'
      ? <AlertIcon />
      : status === 'running' || status === 'queued'
        ? <AutomationIcon />
        : undefined
  return (
    <span className={`dsh-automation-run-status dsh-automation-run-status--${status}`}>
      {icon}
      {statusLabel(t, status)}
    </span>
  )
}

interface FormCommonProps {
  readonly t: Translate
  readonly busy: boolean
  readonly loadModelCatalog: () => Promise<ModelCatalog>
  readonly onCancel: () => void
}

type AutomationFormProps = FormCommonProps & ({
  readonly mode: 'create'
  readonly onSubmit: (input: CreateAutomationInput) => Promise<void>
} | {
  readonly mode: 'edit'
  readonly automation: AutomationViewModel
  readonly onSubmit: (input: UpdateAutomationInput) => Promise<void>
})

function AutomationForm(props: AutomationFormProps): JSX.Element {
  const { t, busy, loadModelCatalog, onCancel } = props
  const [form, setForm] = useState<AutomationFormState>(() => props.mode === 'create'
    ? defaultFormState()
    : formStateFromAutomation(props.automation))
  const [validationError, setValidationError] = useState<string>()
  const [catalog, setCatalog] = useState<ModelCatalog>({ groups: [], failures: [] })
  const [catalogError, setCatalogError] = useState<string>()
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogGeneration, setCatalogGeneration] = useState(0)

  useEffect(() => {
    let live = true
    setCatalogLoading(true)
    setCatalogError(undefined)
    void loadModelCatalog().then((value) => {
      if (!live) return
      setCatalog(value)
      setCatalogLoading(false)
    }, (error: unknown) => {
      if (!live) return
      setCatalogError(error instanceof Error ? error.message : String(error))
      setCatalogLoading(false)
    })
    return () => { live = false }
  }, [catalogGeneration, loadModelCatalog])

  const update = <Key extends keyof AutomationFormState>(key: Key, value: AutomationFormState[Key]): void => {
    setForm(current => ({ ...current, [key]: value }))
    setValidationError(undefined)
  }
  const toggleWeekday = (day: number): void => {
    update('weekdays', form.weekdays.includes(day)
      ? form.weekdays.filter(value => value !== day)
      : [...form.weekdays, day])
  }
  const updateModel = (provider: string | null, model: string | null): void => {
    setForm(current => ({
      ...current,
      provider,
      model,
      reasoningEffort: current.provider === provider && current.model === model
        ? current.reasoningEffort
        : null,
    }))
    setValidationError(undefined)
  }
  const routeKey = (provider: string, model: string): string => JSON.stringify([provider, model])
  const modelChoices = modelRouteChoices(catalog, form.provider, form.model)
  const unavailableModel = modelChoices.find(choice => choice.unavailable)
  const effortChoices = reasoningEffortChoices(
    catalog,
    form.provider,
    form.model,
    form.reasoningEffort,
  )
  const selectedCatalogModel = form.provider === null || form.model === null
    ? undefined
    : catalog.groups
      .find(group => group.id === form.provider)
      ?.models.find(model => model.id === form.model)
  const defaultEffort = selectedCatalogModel?.reasoning?.defaultEffort
  const defaultEffortName = defaultEffort === undefined
    ? undefined
    : selectedCatalogModel?.reasoning?.efforts.find(effort => effort.id === defaultEffort)?.name
      ?? defaultEffort
  const selectedEffort = form.reasoningEffort === null
    ? undefined
    : effortChoices.find(choice => choice.id === form.reasoningEffort)
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    try {
      setValidationError(undefined)
      if (props.mode === 'create') {
        void props.onSubmit(buildCreateInput(form))
      } else {
        void props.onSubmit(buildUpdateInput(form, props.automation))
      }
    } catch (error) {
      if (error instanceof AutomationFormError) {
        setValidationError(t(error.key))
        return
      }
      throw error
    }
  }

  return (
    <form className="dsh-automation-create" onSubmit={submit}>
      <div className="dsh-automation-create-heading">
        <div>
          <span className="dsh-automation-kicker">{t('header.eyebrow')}</span>
          <h2>{t(props.mode === 'create' ? 'form.title' : 'form.editTitle')}</h2>
          <p>{t(props.mode === 'create' ? 'form.subtitle' : 'form.editSubtitle')}</p>
        </div>
        <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={onCancel} disabled={busy}>
          {t('form.cancel')}
        </button>
      </div>

      <div className="dsh-automation-form-grid">
        <label className="dsh-automation-field">
          <span>{t('form.name')}</span>
          <input value={form.name} maxLength={80} placeholder={t('form.namePlaceholder')} onChange={event => update('name', event.currentTarget.value)} />
        </label>
        <label className="dsh-automation-field dsh-automation-field--wide">
          <span>{t('form.prompt')}</span>
          <textarea value={form.prompt} maxLength={12_000} rows={props.mode === 'edit' ? 8 : 4} placeholder={t('form.promptPlaceholder')} onChange={event => update('prompt', event.currentTarget.value)} />
        </label>

        <label className="dsh-automation-field">
          <span>{t('form.model')}</span>
          <select
            value={form.provider === null || form.model === null ? '' : routeKey(form.provider, form.model)}
            onChange={(event) => {
              const value = event.currentTarget.value
              if (value === '') {
                updateModel(null, null)
                return
              }
              const choice = modelChoices.find(item => routeKey(item.provider, item.model) === value)
              if (choice !== undefined) updateModel(choice.provider, choice.model)
            }}
          >
            <option value="">{t('form.followGlobal')}</option>
            {unavailableModel !== undefined && (
              <option value={routeKey(unavailableModel.provider, unavailableModel.model)}>
                {t('form.currentUnavailable', {
                  provider: unavailableModel.provider,
                  model: unavailableModel.model,
                })}
              </option>
            )}
            {catalog.groups.map(group => (
              <optgroup key={group.id} label={group.name}>
                {group.models.map(model => (
                  <option key={model.id} value={routeKey(group.id, model.id)}>{model.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <small>{form.provider === null ? t('form.followGlobalHint') : t('form.pinnedModelHint')}</small>
        </label>

        <label className="dsh-automation-field">
          <span>{t('form.reasoningEffort')}</span>
          <select
            value={form.reasoningEffort ?? ''}
            disabled={form.provider === null}
            onChange={event => update('reasoningEffort', event.currentTarget.value === '' ? null : event.currentTarget.value)}
          >
            <option value="">
              {defaultEffortName === undefined
                ? t('form.modelDefault')
                : t('form.modelDefaultValue', { effort: defaultEffortName })}
            </option>
            {effortChoices.map(effort => (
              <option key={effort.id} value={effort.id}>
                {effort.unavailable
                  ? t('form.effortUnavailable', { effort: effort.name })
                  : effort.name}
              </option>
            ))}
          </select>
          <small>{form.provider === null
            ? t('form.reasoningFollowGlobal')
            : selectedEffort?.description ?? t('form.reasoningHint')}</small>
        </label>

        {(catalogLoading || catalogError !== undefined || catalog.failures.length > 0) && (
          <div className="dsh-automation-catalog-status dsh-automation-field--wide" role="status">
            {catalogLoading && <span>{t('form.catalogLoading')}</span>}
            {catalogError !== undefined && (
              <span className="is-error">{t('form.catalogError', { message: catalogError })}</span>
            )}
            {catalog.failures.map(failure => (
              <span className="is-warning" key={failure.id}>
                {t('form.catalogFailure', { provider: failure.name, message: failure.message })}
              </span>
            ))}
            {!catalogLoading && (catalogError !== undefined || catalog.failures.length > 0) && (
              <button type="button" onClick={() => setCatalogGeneration(value => value + 1)}>
                {t('form.catalogRetry')}
              </button>
            )}
          </div>
        )}

        <fieldset className="dsh-automation-fieldset dsh-automation-field--wide">
          <legend>{t('form.schedule')}</legend>
          <div className="dsh-automation-segmented">
            {(['once', 'interval', 'daily', 'weekly'] as const).map(kind => (
              <button
                key={kind}
                type="button"
                className={form.scheduleKind === kind ? 'is-selected' : ''}
                aria-pressed={form.scheduleKind === kind}
                onClick={() => update('scheduleKind', kind as ScheduleKind)}
              >
                {t(`form.${kind}`)}
              </button>
            ))}
          </div>
          <div className="dsh-automation-schedule-fields">
            {form.scheduleKind === 'once' && (
              <label className="dsh-automation-field">
                <span>{t('form.runAt')}</span>
                <input type="datetime-local" value={form.onceAt} onChange={event => update('onceAt', event.currentTarget.value)} />
              </label>
            )}
            {form.scheduleKind === 'interval' && (
              <label className="dsh-automation-field">
                <span>{t('form.every')}</span>
                <span className="dsh-automation-inline-input">
                  <input type="number" min={5} max={43_200} value={form.everyMinutes} onChange={event => update('everyMinutes', event.currentTarget.value)} />
                  <span>{t('form.minutes')}</span>
                </span>
              </label>
            )}
            {(form.scheduleKind === 'daily' || form.scheduleKind === 'weekly') && (
              <label className="dsh-automation-field">
                <span>{t('form.time')}</span>
                <input type="time" value={form.time} onChange={event => update('time', event.currentTarget.value)} />
              </label>
            )}
            {form.scheduleKind === 'weekly' && (
              <div className="dsh-automation-field dsh-automation-weekdays">
                <span>{t('form.days')}</span>
                <div>
                  {WEEKDAYS.map(day => (
                    <button key={day} type="button" aria-pressed={form.weekdays.includes(day)} className={form.weekdays.includes(day) ? 'is-selected' : ''} onClick={() => toggleWeekday(day)}>
                      {t(`day.${day}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className="dsh-automation-field">
              <span>{t('form.timeZone')}</span>
              <input value={form.timeZone} onChange={event => update('timeZone', event.currentTarget.value)} />
            </label>
          </div>
        </fieldset>

        <fieldset className="dsh-automation-fieldset dsh-automation-field--wide">
          <legend>{t('form.permission')}</legend>
          <div className="dsh-automation-permission-grid">
            {(['read-only', 'workspace-write'] as const).map(permission => (
              <label key={permission} className={form.permission === permission ? 'is-selected' : ''}>
                <input type="radio" name="permission" value={permission} checked={form.permission === permission} onChange={() => update('permission', permission)} />
                <ShieldIcon />
                <span>
                  <strong>{t(permission === 'read-only' ? 'form.readOnly' : 'form.workspaceWrite')}</strong>
                  <small>{t(permission === 'read-only' ? 'form.readOnlyHint' : 'form.workspaceWriteHint')}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="dsh-automation-form-footer">
        <span className="dsh-automation-form-error" role="alert">{validationError}</span>
        <button className="dsh-automation-button dsh-automation-button--primary" type="submit" disabled={busy}>
          {props.mode === 'create' ? <PlusIcon /> : <PencilIcon />}
          {busy
            ? t(props.mode === 'create' ? 'form.submitting' : 'form.saving')
            : t(props.mode === 'create' ? 'form.submit' : 'form.save')}
        </button>
      </div>
    </form>
  )
}

interface AutomationCardProps {
  readonly automation: AutomationViewModel
  readonly now: Date
  readonly t: Translate
  readonly busyKey: string | undefined
  readonly confirmingDelete: boolean
  readonly onConfirmDelete: (id?: string) => void
  readonly onEdit: (automation: AutomationViewModel) => void
  readonly onMutate: (id: string, mutation: 'pause' | 'resume' | 'delete') => void
  readonly onRun: (id: string) => void
}

function AutomationCard(props: AutomationCardProps): JSX.Element {
  const { automation, now, t, busyKey, confirmingDelete, onConfirmDelete, onEdit, onMutate, onRun } = props
  const isBusy = busyKey?.endsWith(`:${automation.id}`) === true
  return (
    <article className="dsh-automation-card">
      <div className="dsh-automation-card-top">
        <div className="dsh-automation-card-title">
          <span className="dsh-automation-card-icon"><AutomationIcon /></span>
          <div>
            <h3>{automation.name}</h3>
            <div className="dsh-automation-card-badges">
              <AutomationStatusBadge status={automation.status} t={t} />
              <span className="dsh-automation-permission-badge"><ShieldIcon />{t(`card.permission.${automation.permission}`)}</span>
              <span className="dsh-automation-model-badge">
                {automation.provider === null || automation.model === null
                  ? t('card.modelGlobal')
                  : t('card.modelPinned', {
                      provider: automation.provider,
                      model: automation.model,
                      effort: automation.reasoningEffort ?? t('form.modelDefault'),
                    })}
              </span>
            </div>
          </div>
        </div>
        <span className="dsh-automation-revision">v{automation.revision}</span>
      </div>

      <p className="dsh-automation-prompt">{automation.prompt}</p>
      <details className="dsh-automation-prompt-details">
        <summary>{t('card.viewPrompt')}</summary>
        <pre>{automation.prompt}</pre>
      </details>
      <div className="dsh-automation-schedule-line">
        <CalendarIcon />
        <strong>{formatSchedule(automation.schedule, t)}</strong>
        <span>{automation.timeZone}</span>
      </div>
      <dl className="dsh-automation-card-times">
        <div>
          <dt>{t('card.nextRun')}</dt>
          <dd>{automation.status === 'active' && automation.nextRunAt !== undefined
            ? formatRelativeTime(automation.nextRunAt, now, t)
            : '—'}</dd>
        </div>
        <div>
          <dt>{t('card.lastRun')}</dt>
          <dd>{automation.lastRunAt === undefined
            ? t('card.never')
            : <><span className={`dsh-automation-mini-dot dsh-automation-mini-dot--${automation.lastRunStatus ?? 'succeeded'}`} />{formatRelativeTime(automation.lastRunAt, now, t)}</>}</dd>
        </div>
      </dl>

      {confirmingDelete ? (
        <div className="dsh-automation-delete-confirm">
          <div><strong>{t('card.confirmDelete')}</strong><span>{t('card.confirmDeleteHint')}</span></div>
          <div>
            <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={() => onConfirmDelete()} disabled={isBusy}>{t('card.cancel')}</button>
            <button className="dsh-automation-button dsh-automation-button--danger" type="button" onClick={() => onMutate(automation.id, 'delete')} disabled={isBusy}><TrashIcon />{t('card.confirm')}</button>
          </div>
        </div>
      ) : (
        <div className="dsh-automation-card-actions">
          <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={() => onEdit(automation)} disabled={isBusy}>
            <PencilIcon />{t('card.edit')}
          </button>
          <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={() => onRun(automation.id)} disabled={isBusy}>
            <PlayIcon />{t('card.runNow')}
          </button>
          <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={() => onMutate(automation.id, automation.status === 'active' ? 'pause' : 'resume')} disabled={isBusy}>
            {automation.status === 'active' ? <PauseIcon /> : <PlayIcon />}
            {t(automation.status === 'active' ? 'card.pause' : 'card.resume')}
          </button>
          <button className="dsh-automation-icon-button" type="button" aria-label={t('card.delete')} title={t('card.delete')} onClick={() => onConfirmDelete(automation.id)} disabled={isBusy}>
            <TrashIcon />
          </button>
        </div>
      )}
    </article>
  )
}

export function RecentRun({ run, now, t, busy, onOpen, onMarkRead }: {
  run: AutomationRunViewModel
  now: Date
  t: Translate
  busy: boolean
  onOpen: (runId: string, sessionId: string) => void
  onMarkRead: (runId: string) => void
}): JSX.Element {
  const timestamp = run.finishedAt ?? run.startedAt ?? run.scheduledFor
  const canMarkRead = run.unread !== false
    && (run.status === 'failed' || run.status === 'interrupted'
      || run.status === 'skipped' || run.status === 'cancelled')
  return (
    <article className="dsh-automation-run">
      <div className="dsh-automation-run-head">
        <div>
          <span className="dsh-automation-run-name">{run.automationName}</span>
          <span className="dsh-automation-run-trigger">{t(`run.trigger.${run.trigger}`)}</span>
        </div>
        <time dateTime={timestamp}>{formatRelativeTime(timestamp, now, t)}</time>
      </div>
      <RunStatusBadge status={run.status} t={t} />
      {(run.summary !== undefined || run.error !== undefined) && (
        <p className={run.error === undefined ? '' : 'is-error'}>{run.error ?? run.summary}</p>
      )}
      {run.sessionId !== undefined && run.sessionArchived && (
        <span className="dsh-automation-session-id dsh-automation-session-id--archived" title={run.sessionId}>
          {t('run.sessionArchived', { id: shortSessionId(run.sessionId) })}
        </span>
      )}
      {run.sessionId !== undefined && !run.sessionArchived && (
        <button className="dsh-automation-session-id" type="button" onClick={() => onOpen(run.id, run.sessionId!)}>
          {t('run.openSession', { id: shortSessionId(run.sessionId) })}
        </button>
      )}
      {canMarkRead && (
        <button className="dsh-automation-run-review" type="button" onClick={() => onMarkRead(run.id)} disabled={busy}>
          <CheckIcon />{t('run.markRead')}
        </button>
      )}
    </article>
  )
}

/** Native conversation view: all data and effects arrive through the slot's four shares. */
export function AutomationView({
  t, useAutomationState, refresh, createAutomation, updateAutomation, mutateAutomation, runNow, markRunRead,
  loadModelCatalog, openSession,
}: AutomationViewProps): JSX.Element {
  const state = useAutomationState(value => value)
  const [showCreate, setShowCreate] = useState(false)
  const [editingAutomation, setEditingAutomation] = useState<AutomationViewModel>()
  const [busyKey, setBusyKey] = useState<string>()
  const [actionError, setActionError] = useState<string>()
  const [confirmDeleteId, setConfirmDeleteId] = useState<string>()
  const [sortKey, setSortKey] = useState<AutomationSortKey>(() => readSortDefault(SORT_STORAGE, WORKSPACE_SORT_DEFAULT_KEY)?.key ?? 'created')
  const [sortDirection, setSortDirection] = useState<AutomationSortDirection>(() => readSortDefault(SORT_STORAGE, WORKSPACE_SORT_DEFAULT_KEY)?.direction ?? 'desc')
  const [taskView, setTaskView] = useState<TaskView>('today')
  const [rangeView, setRangeView] = useState<CalendarRangeView>('list')
  const [calendarCursor, setCalendarCursor] = useState<Date>()
  const [selectedDate, setSelectedDate] = useState<Date>()
  useEffect(() => {
    void refresh().catch(() => undefined)
    const timer = window.setInterval(() => { void refresh().catch(() => undefined) }, POLL_INTERVAL_MS)
    return () => { window.clearInterval(timer) }
  }, [refresh])

  const snapshot = state.snapshot
  const stats = useMemo(() => snapshot === undefined ? undefined : deriveOverview(snapshot), [snapshot])
  const now = useMemo(() => new Date(snapshot?.serverNow ?? Date.now()), [snapshot?.serverNow])
  const automations = useMemo(() => (
    snapshot === undefined ? [] : sortAutomations(snapshot.automations, sortKey, sortDirection)
  ), [snapshot, sortDirection, sortKey])
  const todayStart = useMemo(() => startOfLocalDay(now), [now])
  const todayAutomations = useMemo(() => (
    automations.filter(automation => automation.nextRunAt !== undefined
      && isSameLocalDay(new Date(automation.nextRunAt), todayStart))
  ), [automations, todayStart])
  const calendarAnchor = calendarCursor ?? startOfLocalWeek(todayStart)
  const pickedDate = selectedDate ?? todayStart
  const weekDays = useMemo(() => buildWeekCalendarDays(calendarAnchor), [calendarAnchor])
  const monthDays = useMemo(() => buildMonthCalendarGrid(calendarAnchor), [calendarAnchor])
  const calendarTitleDate = rangeView === 'week' ? weekDays[3] ?? calendarAnchor : calendarAnchor
  const calendarTitleYear = calendarTitleDate.getFullYear()
  const calendarTitleMonth = calendarTitleDate.getMonth() + 1
  const visibleAutomations = useMemo(() => {
    if (taskView === 'today') return todayAutomations
    if (rangeView === 'list') return automations
    return automations.filter(automation => automation.nextRunAt !== undefined
      && isSameLocalDay(new Date(automation.nextRunAt), pickedDate))
  }, [automations, pickedDate, rangeView, taskView, todayAutomations])

  const selectRange = (range: CalendarRangeView): void => {
    setRangeView(range)
    if (range === 'week') setCalendarCursor(startOfLocalWeek(pickedDate))
    if (range === 'month') setCalendarCursor(new Date(pickedDate.getFullYear(), pickedDate.getMonth(), 1))
  }
  const moveCalendar = (delta: number): void => {
    if (rangeView === 'week') {
      setCalendarCursor(startOfLocalWeek(new Date(
        calendarAnchor.getFullYear(), calendarAnchor.getMonth(), calendarAnchor.getDate() + delta * 7,
      )))
    } else {
      setCalendarCursor(new Date(calendarAnchor.getFullYear(), calendarAnchor.getMonth() + delta, 1))
    }
  }
  const goCalendarToday = (): void => {
    setSelectedDate(todayStart)
    setCalendarCursor(rangeView === 'week' ? startOfLocalWeek(todayStart) : new Date(todayStart.getFullYear(), todayStart.getMonth(), 1))
  }
  const selectDay = (day: Date): void => {
    setSelectedDate(startOfLocalDay(day))
  }
  const changeCalendarYear = (year: number): void => {
    const base = new Date(year, calendarTitleMonth - 1, 1)
    setCalendarCursor(rangeView === 'week' ? startOfLocalWeek(base) : base)
    setSelectedDate(startOfLocalDay(base))
  }
  const changeCalendarMonth = (month: number): void => {
    const base = new Date(calendarTitleYear, month - 1, 1)
    setCalendarCursor(rangeView === 'week' ? startOfLocalWeek(base) : base)
    setSelectedDate(startOfLocalDay(base))
  }
  const toggleCreate = (): void => {
    setEditingAutomation(undefined)
    setShowCreate(value => !value)
  }
  const selectSort = (key: AutomationSortKey, direction: AutomationSortDirection): void => {
    setSortKey(key)
    setSortDirection(direction)
    if (SORT_STORAGE !== undefined) writeSortDefault(SORT_STORAGE, WORKSPACE_SORT_DEFAULT_KEY, key, direction)
  }

  const perform = async (key: string, action: () => Promise<void>): Promise<void> => {
    setBusyKey(key)
    setActionError(undefined)
    try {
      await action()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('error.action'))
    } finally {
      setBusyKey(undefined)
    }
  }
  const onMutate = (id: string, mutation: 'pause' | 'resume' | 'delete'): void => {
    void perform(actionKey(mutation, id), async () => {
      await mutateAutomation(id, mutation)
      if (mutation === 'delete') {
        setConfirmDeleteId(undefined)
        if (editingAutomation?.id === id) setEditingAutomation(undefined)
      }
    })
  }
  const onRun = (id: string): void => {
    void perform(actionKey('run', id), () => runNow(id))
  }
  const onOpenSession = (runId: string, sessionId: string): void => {
    void perform(actionKey('run', runId), () => openSession(runId, sessionId))
  }
  const onMarkRead = (runId: string): void => {
    void perform(actionKey('read', runId), () => markRunRead(runId))
  }
  const onCreate = async (input: ReturnType<typeof buildCreateInput>): Promise<void> => {
    await perform(actionKey('create'), async () => {
      await createAutomation(input)
      setShowCreate(false)
    })
  }
  const onUpdate = async (input: UpdateAutomationInput): Promise<void> => {
    const automation = editingAutomation
    if (automation === undefined) return
    await perform(actionKey('update', automation.id), async () => {
      await updateAutomation(automation.id, automation.revision, input)
      setEditingAutomation(undefined)
    })
  }
  const onEdit = (automation: AutomationViewModel): void => {
    setShowCreate(false)
    setConfirmDeleteId(undefined)
    setEditingAutomation(automation)
  }

  if (snapshot === undefined && (state.phase === 'idle' || state.phase === 'loading')) {
    return (
      <div className="dsh-automation-shell dsh-automation-centered" data-conversation-composer-overlay="" role="status">
        <span className="dsh-automation-loader"><AutomationIcon /></span>
        <span>{t('loading')}</span>
      </div>
    )
  }

  if (snapshot === undefined) {
    return (
      <div className="dsh-automation-shell dsh-automation-centered" data-conversation-composer-overlay="">
        <span className="dsh-automation-error-icon"><AlertIcon /></span>
        <h2>{t('error.title')}</h2>
        <p>{state.error}</p>
        <button className="dsh-automation-button dsh-automation-button--primary" type="button" onClick={() => { void refresh().catch(() => undefined) }}>
          <RefreshIcon />{t('error.retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="dsh-automation-shell" data-conversation-composer-overlay="">
      <header className="dsh-automation-header">
        <div className="dsh-automation-header-row">
          <div className="dsh-automation-header-box">
            <div className="dsh-automation-header-title">
              <span className="dsh-automation-logo"><AutomationIcon /></span>
              <h1>{t('header.title')}</h1>
              <span className="dsh-automation-header-divider" aria-hidden="true" />
              <p>{t('header.subtitle')}</p>
            </div>
            <span className="dsh-automation-header-meta-divider" aria-hidden="true" />
            <div className="dsh-automation-header-meta">
              <span>
                <strong>{t('scope.workspace')}</strong>
                {snapshot.scope.workspaceName ?? snapshot.scope.workspaceId ?? '—'}
              </span>
              <span>
                <strong>{t('scope.folder')}</strong>
                <code title={snapshot.scope.cwd}>{snapshot.scope.cwd}</code>
              </span>
            </div>
          </div>
        </div>
      </header>

      {showCreate && (
        <AutomationForm
          mode="create"
          t={t}
          busy={busyKey === actionKey('create')}
          loadModelCatalog={loadModelCatalog}
          onCancel={() => setShowCreate(false)}
          onSubmit={onCreate}
        />
      )}

      {editingAutomation !== undefined && (
        <AutomationForm
          key={`${editingAutomation.id}:${editingAutomation.revision}`}
          mode="edit"
          automation={editingAutomation}
          t={t}
          busy={busyKey === actionKey('update', editingAutomation.id)}
          loadModelCatalog={loadModelCatalog}
          onCancel={() => setEditingAutomation(undefined)}
          onSubmit={onUpdate}
        />
      )}

      {(actionError !== undefined || state.error !== undefined) && (
        <div className="dsh-automation-inline-error" role="alert"><AlertIcon />{actionError ?? state.error}</div>
      )}

      <div className="dsh-automation-content">
        <section className="dsh-automation-main-column">
          <div className="dsh-automation-status-toolbar">
            <div className="dsh-automation-toolbar-row">
              <div className="dsh-automation-view-switch" role="group">
                <button type="button" className={taskView === 'today' ? 'is-selected' : ''} aria-pressed={taskView === 'today'} onClick={() => setTaskView('today')}>
                  <span>{t('view.todayTasks')}</span><b>{todayAutomations.length}</b>
                </button>
                <button type="button" className={taskView === 'all' ? 'is-selected' : ''} aria-pressed={taskView === 'all'} onClick={() => setTaskView('all')}>
                  <span>{t('view.allTasks')}</span><b>{automations.length}</b>
                </button>
              </div>
              <div className="dsh-automation-status-summary">
                <span><b>{t('stats.active')}</b>{stats?.active ?? 0}</span>
                <span><b>{t('stats.next')}</b>{stats?.nextRunAt === undefined ? t('stats.noneScheduled') : formatRelativeTime(stats.nextRunAt, now, t)}</span>
              </div>
              <div className="dsh-automation-toolbar-actions">
                <button className="dsh-automation-button dsh-automation-button--primary" type="button" onClick={toggleCreate}>
                  {showCreate ? <><PauseIcon />{t('header.closeCreate')}</> : <><PlusIcon />{t('header.create')}</>}
                </button>
                <button className="dsh-automation-refresh-button" type="button" aria-label={t('section.refresh')} title={t('section.refresh')} onClick={() => { void refresh().catch(() => undefined) }} disabled={state.phase === 'loading'}><RefreshIcon /></button>
              </div>
            </div>
            <div className="dsh-automation-toolbar-bottom">
              <div className="dsh-automation-toolbar-controls">
              {taskView === 'all' && (
                <div className="dsh-automation-range-switch" role="group" aria-label={t('view.allTasks')}>
                  {(['list', 'week', 'month'] as const).map(range => (
                    <button key={range} type="button" className={rangeView === range ? 'is-selected' : ''} aria-pressed={rangeView === range} onClick={() => selectRange(range)}>
                      {t(`view.${range}`)}
                    </button>
                  ))}
                </div>
              )}
              {taskView === 'all' && rangeView !== 'list' && (
                <div className="dsh-automation-cal-nav">
                  <button className="dsh-automation-cal-nav-btn" type="button" onClick={goCalendarToday}>{t('view.today')}</button>
                  <button className="dsh-automation-cal-nav-btn" type="button" aria-label="prev" onClick={() => moveCalendar(-1)}>◀</button>
                  <div className="dsh-automation-cal-title-box">
                    <select className="dsh-automation-cal-title-select" value={calendarTitleYear} aria-label={t('calendar.year')} onChange={event => changeCalendarYear(Number(event.currentTarget.value))}>
                      {Array.from({ length: 7 }, (_, index) => todayStart.getFullYear() - 3 + index).map(year => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </select>
                    <select className="dsh-automation-cal-title-select" value={calendarTitleMonth} aria-label={t('calendar.month')} onChange={event => changeCalendarMonth(Number(event.currentTarget.value))}>
                      {Array.from({ length: 12 }, (_, index) => index + 1).map(month => (
                        <option key={month} value={month}>{month}月</option>
                      ))}
                    </select>
                  </div>
                  <button className="dsh-automation-cal-nav-btn" type="button" aria-label="next" onClick={() => moveCalendar(1)}>▶</button>
                </div>
              )}
              <div className="dsh-automation-sort-group">
                <div className="dsh-automation-sort-switch" role="group" aria-label={t('sort.by')}>
                  <button type="button" className={sortKey === 'planned' ? 'is-selected' : ''} aria-pressed={sortKey === 'planned'} onClick={() => selectSort('planned', sortDirection)}>{t('sort.planned')}</button>
                  <button type="button" className={sortKey === 'created' ? 'is-selected' : ''} aria-pressed={sortKey === 'created'} onClick={() => selectSort('created', sortDirection)}>{t('sort.created')}</button>
                  <span className="dsh-automation-sort-sep" aria-hidden="true" />
                  <button type="button" className={sortDirection === 'asc' ? 'is-selected' : ''} aria-pressed={sortDirection === 'asc'} onClick={() => selectSort(sortKey, 'asc')}>{t('sort.asc')}</button>
                  <button type="button" className={sortDirection === 'desc' ? 'is-selected' : ''} aria-pressed={sortDirection === 'desc'} onClick={() => selectSort(sortKey, 'desc')}>{t('sort.desc')}</button>
                </div>
              </div>
              </div>
            </div>
            {taskView === 'all' && rangeView !== 'list' && (
              <div className="dsh-automation-toolbar-calendar">
                <div className="dsh-automation-calendar">
                  {rangeView === 'week' ? (
                    <div className="dsh-automation-cal-week">
                      {weekDays.map(day => {
                        const count = countAutomationsOnDay(automations, day)
                        const weekday = day.getDay() === 0 ? 7 : day.getDay()
                        return (
                          <button key={day.toISOString()} type="button" className={`dsh-automation-cal-day${isSameLocalDay(day, todayStart) ? ' is-today' : ''}${isSameLocalDay(day, pickedDate) ? ' is-selected' : ''}`} onClick={() => selectDay(day)}>
                            <span className="dsh-automation-cal-weekday">{t(`day.${weekday}` as AutomationLocaleKey)}</span>
                            <span className="dsh-automation-cal-date">{day.getMonth() + 1}/{day.getDate()}</span>
                            {count > 0 && <span className="dsh-automation-cal-count">{t('calendar.taskCount', { count })}</span>}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="dsh-automation-cal-month">
                      <div className="dsh-automation-cal-month-weekdays">
                        {WEEKDAYS.map(day => (
                          <span key={day}>{t(`calendar.dow.${day}` as AutomationLocaleKey)}</span>
                        ))}
                      </div>
                      <div className="dsh-automation-cal-month-grid">
                        {monthDays.map(day => {
                          const count = countAutomationsOnDay(automations, day)
                          const otherMonth = day.getMonth() !== calendarAnchor.getMonth()
                          return (
                            <button key={day.toISOString()} type="button" className={`dsh-automation-cal-month-day${otherMonth ? ' is-other' : ''}${isSameLocalDay(day, todayStart) ? ' is-today' : ''}${isSameLocalDay(day, pickedDate) ? ' is-selected' : ''}`} onClick={() => selectDay(day)}>
                              <span className="dsh-automation-cal-month-date">{day.getDate()}</span>
                              {count > 0 && <span className="dsh-automation-cal-count">{t('calendar.taskCount', { count })}</span>}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {automations.length === 0 ? (
            <div className="dsh-automation-empty">
              <span><AutomationIcon /></span>
              <h3>{t('empty.title')}</h3>
              <p>{t('empty.body')}</p>
              <button className="dsh-automation-button dsh-automation-button--primary" type="button" onClick={() => setShowCreate(true)}><PlusIcon />{t('empty.action')}</button>
            </div>
          ) : visibleAutomations.length === 0 ? (
            <div className="dsh-automation-empty">
              <span><CalendarIcon /></span>
              <h3>{taskView === 'today' ? t('empty.todayNone') : t('empty.dayNone')}</h3>
              <button className="dsh-automation-button dsh-automation-button--primary" type="button" onClick={() => setShowCreate(true)}><PlusIcon />{t('header.create')}</button>
            </div>
          ) : (
            <div className="dsh-automation-card-list">
              {visibleAutomations.map(automation => (
                <AutomationCard
                  key={automation.id}
                  automation={automation}
                  now={now}
                  t={t}
                  busyKey={busyKey}
                  confirmingDelete={confirmDeleteId === automation.id}
                  onConfirmDelete={setConfirmDeleteId}
                  onEdit={onEdit}
                  onMutate={onMutate}
                  onRun={onRun}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="dsh-automation-runs-column">
          <div className="dsh-automation-runs-panel">
            <div className="dsh-automation-runs-head">
              <h2>{t('section.runs')}</h2>
              <span className="dsh-automation-runs-attention">
                <AlertIcon />
                {t('stats.attention')}
                <b>{stats?.attention ?? 0}</b>
              </span>
            </div>
            {snapshot.runs.length === 0
              ? <div className="dsh-automation-runs-empty">{t('runs.empty')}</div>
              : <div className="dsh-automation-run-list">{snapshot.runs.slice(0, 12).map(run => (
                  <RecentRun
                    key={run.id}
                    run={run}
                    now={now}
                    t={t}
                    busy={busyKey?.endsWith(`:${run.id}`) === true}
                    onOpen={onOpenSession}
                    onMarkRead={onMarkRead}
                  />
                ))}</div>}
          </div>
        </aside>
      </div>
    </div>
  )
}

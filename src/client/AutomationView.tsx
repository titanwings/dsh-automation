import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AutomationViewProps, Translate } from './contracts.js'
import type { AutomationLocaleKey } from './locales.js'
import {
  AutomationFormError,
  buildCreateInput,
  buildMonthCalendarGrid,
  buildUpdateInput,
  buildWeekCalendarDays,
  clearDraft,
  countAutomationsByStatusOnDay,
  countAutomationsOnDay,
  countExecutedOnDay,
  defaultFormState,
  deriveOverview,
  formatSchedule,
  formatRelativeTime,
  formStateFromAutomation,
  isFulfilledAutomation,
  isSameLocalDay,
  modelRouteChoices,
  plannedNextRun,
  readDraft,
  reasoningEffortChoices,
  readSortDefault,
  resolveSortPreferenceStorage,
  shortSessionId,
  sortAutomations,
  writeDraft,
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
  ChevronIcon,
  GearIcon,
  GlobeIcon,
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
  AutomationSettingsView,
  AutomationViewModel,
  CreateAutomationInput,
  ModelCatalog,
  RunNowMode,
  SettingsUpdateInput,
  UpdateAutomationInput,
} from './protocol.js'

const POLL_INTERVAL_MS = 15_000
const RETRY_FAST_MS = 3_000
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const
const FALLBACK_CITY_ZONES = [
  'UTC', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Singapore',
  'Asia/Seoul', 'Asia/Dubai', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Moscow', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Sao_Paulo', 'Australia/Sydney',
] as const

function cityZoneList(): readonly string[] {
  try {
    if (typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl) {
      return Intl.supportedValuesOf('timeZone').filter(zone => (
        zone === 'UTC'
        || (zone.includes('/') && !zone.startsWith('Etc/') && !zone.startsWith('SystemV/'))
      ))
    }
  } catch {
    // Older embedded browsers may expose supportedValuesOf without timeZone support.
  }
  return FALLBACK_CITY_ZONES
}

function zoneUtcOffset(zone: string): { readonly minutes: number; readonly label: string } {
  const minutesOf = (offset: number): { readonly minutes: number; readonly label: string } => {
    const label = offset === 0
      ? 'UTC+00:00'
      : `UTC${offset > 0 ? '+' : '-'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`
    return { minutes: offset, label }
  }
  try {
    const winter = new Date('2026-01-15T00:00:00Z')
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(winter)
    const get = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? NaN)
    const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
    if (!Number.isFinite(local)) return minutesOf(0)
    return minutesOf(Math.round((local - winter.getTime()) / 60_000))
  } catch {
    return minutesOf(0)
  }
}

function timeZoneChoices(current: string): readonly { readonly value: string; readonly label: string }[] {
  const items = cityZoneList().map(zone => {
    const offset = zoneUtcOffset(zone)
    const city = zone === 'UTC' ? 'UTC' : (zone.split('/').pop() ?? zone).replace(/_/g, ' ')
    return {
      value: zone,
      label: `${city} (${offset.label})`,
      minutes: offset.minutes,
    }
  }).sort((left, right) => left.minutes - right.minutes || left.label.localeCompare(right.label))
  if (!items.some(item => item.value === current)) {
    const offset = zoneUtcOffset(current)
    items.push({ value: current, label: `${current} (${offset.label})`, minutes: offset.minutes })
  }
  return items.map(({ value, label }) => ({ value, label }))
}
const SORT_STORAGE: SortPreferenceStorage | undefined = resolveSortPreferenceStorage(
  typeof window === 'undefined' ? undefined : window,
)
const WORKSPACE_RANGE_DEFAULT_KEY = 'dsh-automation.range-default.workspace'

type BusyAction = 'create' | 'update' | 'pause' | 'resume' | 'run' | 'read' | 'delete' | 'delete-run' | 'settings'
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

export interface AutomationFloatBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface AutomationFloatViewport {
  readonly width: number
  readonly height: number
  readonly offsetLeft?: number
  readonly offsetTop?: number
}

export interface AutomationFloatAnchor {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

const FLOAT_DEFAULT_WIDTH = 480
const FLOAT_DEFAULT_HEIGHT = 645
const FLOAT_MIN_WIDTH = 320
const FLOAT_MIN_HEIGHT = 320
const FLOAT_MARGIN = 8

function currentAutomationFloatViewport(): AutomationFloatViewport {
  if (typeof window === 'undefined') return { width: FLOAT_DEFAULT_WIDTH + 32, height: FLOAT_DEFAULT_HEIGHT + 48 }
  const viewport = window.visualViewport
  if (viewport === null) return {
    width: Math.max(0, Math.floor(window.innerWidth)),
    height: Math.max(0, Math.floor(window.innerHeight)),
  }
  return {
    width: Math.max(0, Math.floor(viewport.width)),
    height: Math.max(0, Math.floor(viewport.height)),
    offsetLeft: Math.max(0, viewport.offsetLeft),
    offsetTop: Math.max(0, viewport.offsetTop),
  }
}

function withAutomationFloatOrigin(
  box: AutomationFloatBox,
  viewport: AutomationFloatViewport,
): AutomationFloatBox {
  const originLeft = viewport.offsetLeft ?? 0
  const originTop = viewport.offsetTop ?? 0
  if (originLeft === 0 && originTop === 0) return box
  return { ...box, x: box.x + originLeft, y: box.y + originTop }
}

function withoutAutomationFloatOrigin(
  box: AutomationFloatBox,
  viewport: AutomationFloatViewport,
): AutomationFloatBox {
  const originLeft = viewport.offsetLeft ?? 0
  const originTop = viewport.offsetTop ?? 0
  if (originLeft === 0 && originTop === 0) return box
  return { ...box, x: box.x - originLeft, y: box.y - originTop }
}

/** Keep the complete floating editor inside even a narrow visual viewport. */
export function clampAutomationFloatBox(
  value: AutomationFloatBox,
  viewport: AutomationFloatViewport,
): AutomationFloatBox {
  const box = withoutAutomationFloatOrigin(value, viewport)
  const marginX = Math.min(FLOAT_MARGIN, Math.max(0, viewport.width / 2))
  const marginY = Math.min(FLOAT_MARGIN, Math.max(0, viewport.height / 2))
  const availableWidth = Math.max(0, viewport.width - marginX * 2)
  const availableHeight = Math.max(0, viewport.height - marginY * 2)
  const minWidth = Math.min(FLOAT_MIN_WIDTH, availableWidth)
  const minHeight = Math.min(FLOAT_MIN_HEIGHT, availableHeight)
  const w = Math.max(minWidth, Math.min(box.w, availableWidth))
  const h = Math.max(minHeight, Math.min(box.h, availableHeight))
  const x = Math.max(marginX, Math.min(box.x, viewport.width - marginX - w))
  const y = Math.max(marginY, Math.min(box.y, viewport.height - marginY - h))
  return withAutomationFloatOrigin({ x, y, w, h }, viewport)
}

export function initialAutomationFloatBox(
  anchor?: AutomationFloatAnchor,
  viewport = currentAutomationFloatViewport(),
  initialHeight = FLOAT_DEFAULT_HEIGHT,
): AutomationFloatBox {
  const originLeft = viewport.offsetLeft ?? 0
  const originTop = viewport.offsetTop ?? 0
  const originViewport: AutomationFloatViewport = {
    width: viewport.width,
    height: viewport.height,
    offsetLeft: originLeft,
    offsetTop: originTop,
  }
  let box = clampAutomationFloatBox({
    x: Math.round((viewport.width - FLOAT_DEFAULT_WIDTH) / 2),
    y: Math.round((viewport.height - initialHeight) / 2),
    w: FLOAT_DEFAULT_WIDTH,
    h: initialHeight,
  }, originViewport)
  if (anchor === undefined) return box

  let x = Math.round(anchor.right + FLOAT_MARGIN)
  let y = Math.round(anchor.bottom + FLOAT_MARGIN)
  const rightLimit = originLeft + viewport.width - FLOAT_MARGIN
  const bottomLimit = originTop + viewport.height - FLOAT_MARGIN
  if (x + box.w > rightLimit) x = Math.round(anchor.left - box.w - FLOAT_MARGIN)
  if (y + box.h > bottomLimit) y = Math.round(anchor.top - box.h - FLOAT_MARGIN)
  box = clampAutomationFloatBox({ ...box, x, y }, originViewport)
  return box
}

function AutomationFloat({ label, busy, onClose, anchor, height, children }: {
  readonly label: string
  readonly busy: boolean
  readonly onClose: () => void
  readonly anchor: DOMRect | undefined
  readonly height?: number
  readonly children: ReactNode
}): JSX.Element {
  const [box, setBox] = useState(() => initialAutomationFloatBox(anchor, undefined, height))
  const dragRef = useRef<{
    readonly mode: 'move' | 'resize'
    readonly startX: number
    readonly startY: number
    readonly x: number
    readonly y: number
    readonly w: number
    readonly h: number
  }>()
  const dragCleanupRef = useRef<(() => void) | undefined>(undefined)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [busy, onClose])

  useEffect(() => {
    const reclamp = (): void => {
      setBox(current => clampAutomationFloatBox(current, currentAutomationFloatViewport()))
    }
    const viewport = window.visualViewport
    window.addEventListener('resize', reclamp)
    viewport?.addEventListener('resize', reclamp)
    viewport?.addEventListener('scroll', reclamp)
    return () => {
      window.removeEventListener('resize', reclamp)
      viewport?.removeEventListener('resize', reclamp)
      viewport?.removeEventListener('scroll', reclamp)
      dragCleanupRef.current?.()
    }
  }, [])

  const clampBox = (value: AutomationFloatBox): void => {
    setBox(clampAutomationFloatBox(value, currentAutomationFloatViewport()))
  }

  /** Stop an in-flight drag when the window loses capture or the pointer is released elsewhere. */
  const stopDrag = (): void => {
    dragRef.current = undefined
    const cleanup = dragCleanupRef.current
    if (cleanup === undefined) return
    dragCleanupRef.current = undefined
    cleanup()
  }

  const onMoveStart = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (busy || dragRef.current !== undefined) return
    const target = event.target as HTMLElement
    if (target.closest('button, input, textarea, select, details, summary') !== null) return
    event.preventDefault()
    dragRef.current = { mode: 'move', startX: event.clientX, startY: event.clientY, x: box.x, y: box.y, w: box.w, h: box.h }
    const onMove = (move: globalThis.MouseEvent): void => {
      const drag = dragRef.current
      if (drag === undefined) return
      clampBox({
        x: drag.x + move.clientX - drag.startX,
        y: drag.y + move.clientY - drag.startY,
        w: drag.w,
        h: drag.h,
      })
    }
    const cleanup = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', stopDrag)
      window.removeEventListener('blur', stopDrag)
    }
    dragCleanupRef.current = cleanup
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', stopDrag)
    window.addEventListener('blur', stopDrag)
  }

  const onResizeStart = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (busy || dragRef.current !== undefined) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { mode: 'resize', startX: event.clientX, startY: event.clientY, x: box.x, y: box.y, w: box.w, h: box.h }
    const onMove = (move: globalThis.MouseEvent): void => {
      const drag = dragRef.current
      if (drag === undefined) return
      clampBox({
        x: drag.x,
        y: drag.y,
        w: drag.w + move.clientX - drag.startX,
        h: drag.h + move.clientY - drag.startY,
      })
    }
    const cleanup = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', stopDrag)
      window.removeEventListener('blur', stopDrag)
    }
    dragCleanupRef.current = cleanup
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', stopDrag)
    window.addEventListener('blur', stopDrag)
  }

  const dialog = (
    <div
      className="dsh-automation-float"
      role="dialog"
      aria-modal="false"
      aria-label={label}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onMouseDown={onMoveStart}
    >
      {children}
      <div className="dsh-automation-float-resize" aria-hidden="true" onMouseDown={onResizeStart} />
    </div>
  )
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}

type AutomationFormProps = FormCommonProps & ({
  readonly mode: 'create'
  readonly initial: AutomationFormState | undefined
  readonly onSaveDraft?: (form: AutomationFormState) => void
  readonly onSubmit: (input: CreateAutomationInput) => Promise<void>
} | {
  readonly mode: 'edit'
  readonly automation: AutomationViewModel
  readonly onSubmit: (input: UpdateAutomationInput) => Promise<void>
})

function AutomationForm(props: AutomationFormProps): JSX.Element {
  const { t, busy, loadModelCatalog, onCancel } = props
  const [form, setForm] = useState<AutomationFormState>(() => props.mode === 'create'
    ? props.initial ?? defaultFormState()
    : formStateFromAutomation(props.automation))
  const [draftSaved, setDraftSaved] = useState(false)
  const [validationError, setValidationError] = useState<string>()
  const [catalog, setCatalog] = useState<ModelCatalog>({ groups: [], failures: [] })
  const [catalogError, setCatalogError] = useState<string>()
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogGeneration, setCatalogGeneration] = useState(0)
  const zoneSelect = useRef<HTMLSelectElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameInput.current?.focus({ preventScroll: true })
  }, [])

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
    setDraftSaved(false)
    setValidationError(undefined)
  }
  const onSaveDraftProp = props.mode === 'create' ? props.onSaveDraft : undefined
  useEffect(() => {
    if (onSaveDraftProp === undefined) return
    onSaveDraftProp(form)
    setDraftSaved(true)
  }, [form, onSaveDraftProp])
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
    setDraftSaved(false)
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
        <h2>{t(props.mode === 'create' ? 'form.title' : 'form.editTitle')}</h2>
        {props.mode === 'edit' && <p>{t('form.editSubtitle')}</p>}
        <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={onCancel} disabled={busy}>
          {t('form.cancel')}
        </button>
      </div>

      <div className="dsh-automation-form-grid">
        <label className="dsh-automation-field">
          <span>{t('form.name')}</span>
          <input ref={nameInput} value={form.name} maxLength={80} placeholder={t('form.namePlaceholder')} onChange={event => update('name', event.currentTarget.value)} />
        </label>
        <label className="dsh-automation-field dsh-automation-field--wide">
          <span>{t('form.prompt')}<small className="dsh-automation-field-note">{t('form.subtitle')}</small></span>
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
              <span className="dsh-automation-timezone">
                <select
                  ref={zoneSelect}
                  value={form.timeZone}
                  onChange={event => update('timeZone', event.currentTarget.value)}
                >
                  {timeZoneChoices(form.timeZone).map(zone => (
                    <option key={zone.value} value={zone.value}>{zone.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="dsh-automation-timezone-globe"
                  aria-label={t('form.timeZone')}
                  title={t('form.timeZone')}
                  onClick={() => {
                    const select = zoneSelect.current
                    if (select === null) return
                    try {
                      select.showPicker()
                    } catch {
                      select.focus()
                    }
                  }}
                >
                  <GlobeIcon />
                </button>
              </span>
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
        {props.mode === 'create' && (
          <button
            className="dsh-automation-button dsh-automation-button--ghost"
            type="button"
            disabled={busy || draftSaved}
            onClick={() => {
              props.onSaveDraft?.(form)
              setDraftSaved(true)
            }}
          >
            {draftSaved ? <CheckIcon /> : null}
            {t(draftSaved ? 'form.draftSaved' : 'form.saveDraft')}
          </button>
        )}
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

interface AutomationSettingsPanelProps {
  readonly t: Translate
  readonly settings: AutomationSettingsView
  readonly busy: boolean
  readonly saveError?: string | undefined
  readonly onCancel: () => void
  readonly onSubmit: (next: SettingsUpdateInput) => Promise<void>
}

/** Host-wide preferences; the entry point for future custom automation options. */
const WAIT_PRESET_VALUES: readonly number[] = [30, 60, 300, 720, 1_440, 525_600]
const CUSTOM_WAIT = -1

function waitOptionKey(minutes: number): AutomationLocaleKey {
  switch (minutes) {
    case 30: return 'settings.missedRuns.waitOpt.m30'
    case 60: return 'settings.missedRuns.waitOpt.h1'
    case 300: return 'settings.missedRuns.waitOpt.h5'
    case 720: return 'settings.missedRuns.waitOpt.h12'
    case 1_440: return 'settings.missedRuns.waitOpt.h24'
    default: return 'settings.missedRuns.waitOpt.forever'
  }
}

/** Whether the stored wait (minutes) is one of the offered presets. */
function waitPresetValue(value: number): number | undefined {
  return WAIT_PRESET_VALUES.find(candidate => candidate === value)
}

function AutomationSettingsPanel(props: AutomationSettingsPanelProps): JSX.Element {
  const { t, settings, busy, saveError, onCancel, onSubmit } = props
  const [open, setOpen] = useState(true)
  const [catchUpMissedRuns, setCatchUpMissedRuns] = useState(settings.catchUpMissedRuns)
  const [waitChoice, setWaitChoice] = useState<number>(() => (
    waitPresetValue(settings.misfireGraceMinutes) ?? CUSTOM_WAIT
  ))
  const [customWait, setCustomWait] = useState(() => String(Math.max(1, settings.misfireGraceMinutes)))
  const [catchUpMax, setCatchUpMax] = useState(String(settings.catchUpMissedRunsMax))
  const [validationError, setValidationError] = useState<string>()

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    setValidationError(undefined)
    const max = Number.parseInt(catchUpMax, 10)
    if (!Number.isInteger(max) || max < 1 || max > 1_000) {
      setValidationError(t('settings.missedRuns.errorMax'))
      return
    }
    const wait = waitChoice === CUSTOM_WAIT ? Number.parseInt(customWait, 10) : waitChoice
    if (waitChoice === CUSTOM_WAIT && (!Number.isInteger(wait) || wait < 1 || wait > 525_600)) {
      setValidationError(t('settings.missedRuns.errorCustomWait'))
      return
    }
    void onSubmit({
      catchUpMissedRuns,
      catchUpMissedRunsMax: max,
      // "Mark only" never replays: it stores a near-zero grace so any late
      // occurrence is immediately marked as missed.
      misfireGraceMinutes: catchUpMissedRuns ? wait : 1,
    })
  }

  return (
    <form className="dsh-automation-create" onSubmit={submit}>
      <div className="dsh-automation-create-heading">
        <h2>{t('settings.title')}</h2>
        <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={onCancel} disabled={busy}>
          {t('form.cancel')}
        </button>
      </div>

      <div className="dsh-automation-form-grid">
        <section className="dsh-automation-settings-section dsh-automation-field--wide">
          <button
            type="button"
            className="dsh-automation-settings-section-head"
            aria-expanded={open}
            onClick={() => setOpen(current => !current)}
          >
            <ChevronIcon className="dsh-automation-chevron" />
            <h3>{t('settings.missedRuns.title')}</h3>
          </button>
          {open && (
            <div className="dsh-automation-settings-section-body">
              <p className="dsh-automation-settings-lead">{t('settings.missedRuns.lead')}</p>
              <label className="dsh-automation-field">
                <span>{t('settings.missedRuns.strategy')}</span>
                <select
                  value={catchUpMissedRuns ? 'catch-up' : 'skip'}
                  onChange={event => setCatchUpMissedRuns(event.currentTarget.value === 'catch-up')}
                >
                  <option value="catch-up">{t('settings.missedRuns.strategyCatchUp')}</option>
                  <option value="skip">{t('settings.missedRuns.strategySkip')}</option>
                </select>
              </label>
              {catchUpMissedRuns ? (
                <>
                  <label className="dsh-automation-field">
                    <span>{t('settings.missedRuns.waitLabel')}</span>
                    <select
                      value={waitChoice}
                      onChange={event => setWaitChoice(Number(event.currentTarget.value))}
                    >
                      {WAIT_PRESET_VALUES.map(minutes => (
                        <option key={minutes} value={minutes}>{t(waitOptionKey(minutes))}</option>
                      ))}
                      <option value={CUSTOM_WAIT}>{t('settings.missedRuns.waitOpt.custom')}</option>
                    </select>
                    {waitChoice === CUSTOM_WAIT && (
                      <span className="dsh-automation-inline-input">
                        <input
                          type="number"
                          min={1}
                          max={525_600}
                          step={1}
                          value={customWait}
                          onChange={event => setCustomWait(event.currentTarget.value)}
                        />
                        <span>{t('settings.missedRuns.waitUnitMin')}</span>
                      </span>
                    )}
                    <small>{t('settings.missedRuns.waitHint')}</small>
                  </label>
                  <label className="dsh-automation-field">
                    <span>{t('settings.missedRuns.maxLabel')}</span>
                    <span className="dsh-automation-inline-input">
                      <input
                        type="number"
                        min={1}
                        max={1_000}
                        step={1}
                        value={catchUpMax}
                        onChange={event => setCatchUpMax(event.currentTarget.value)}
                      />
                      <span>{t('settings.missedRuns.times')}</span>
                    </span>
                    <small>{t('settings.missedRuns.maxHint')}</small>
                  </label>
                </>
              ) : (
                <p className="dsh-automation-settings-lead">{t('settings.missedRuns.skipBody')}</p>
              )}
            </div>
          )}
        </section>
      </div>

      <div className="dsh-automation-form-footer">
        <span className="dsh-automation-form-error" role="alert">{validationError ?? saveError}</span>
        <button className="dsh-automation-button dsh-automation-button--primary" type="submit" disabled={busy}>
          <CheckIcon />
          {busy ? t('settings.saving') : t('settings.save')}
        </button>
      </div>
    </form>
  )
}

interface AutomationRunDialogProps {
  readonly t: Translate
  readonly automation: AutomationViewModel
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onRun: (automationId: string, mode: RunNowMode) => Promise<void>
}

/** Ask how a manual run should treat the pending schedule: replace it or leave it. */
function AutomationRunDialog(props: AutomationRunDialogProps): JSX.Element {
  const { t, automation, busy, onCancel, onRun } = props
  const canAhead = automation.nextRunAt !== undefined
  const [mode, setMode] = useState<RunNowMode>('ahead')
  const chosen = canAhead ? mode : 'plain'
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    void onRun(automation.id, chosen)
  }
  return (
    <form className="dsh-automation-create dsh-automation-run-dialog" onSubmit={submit}>
      <div className="dsh-automation-create-heading">
        <h2>{t('run.title')}</h2>
        <p>{automation.name}</p>
        <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={onCancel} disabled={busy}>
          {t('form.cancel')}
        </button>
      </div>

      <div className="dsh-automation-form-grid">
        <div className="dsh-automation-permission-grid dsh-automation-field--wide">
          <label className={chosen === 'ahead' ? 'is-selected' : ''}>
            <input
              type="radio"
              name="run-mode"
              value="ahead"
              checked={chosen === 'ahead'}
              disabled={!canAhead}
              onChange={() => setMode('ahead')}
            />
            <span>
              <strong>{t('run.ahead')}</strong>
              <small>{t('run.aheadHint')}</small>
            </span>
          </label>
          <label className={chosen === 'plain' ? 'is-selected' : ''}>
            <input
              type="radio"
              name="run-mode"
              value="plain"
              checked={chosen === 'plain'}
              onChange={() => setMode('plain')}
            />
            <span>
              <strong>{t('run.plain')}</strong>
              <small>{t('run.plainHint')}</small>
            </span>
          </label>
        </div>
        {!canAhead && <p className="dsh-automation-settings-lead dsh-automation-field--wide">{t('run.noPlan')}</p>}
      </div>

      <div className="dsh-automation-form-footer">
        <span />
        <button className="dsh-automation-button dsh-automation-button--primary" type="submit" disabled={busy}>
          <PlayIcon />
          {busy ? t('settings.saving') : t('run.confirm')}
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
  readonly onEdit: (automation: AutomationViewModel, anchor?: DOMRect) => void
  readonly onMutate: (id: string, mutation: 'pause' | 'resume' | 'delete') => void
  readonly onRun: (automation: AutomationViewModel, anchor?: DOMRect) => void
}

function AutomationCard(props: AutomationCardProps): JSX.Element {
  const { automation, now, t, busyKey, confirmingDelete, onConfirmDelete, onEdit, onMutate, onRun } = props
  const isBusy = busyKey?.endsWith(`:${automation.id}`) === true
  const fulfilled = isFulfilledAutomation(automation)
  return (
    <article className="dsh-automation-card">
      <div className="dsh-automation-card-top">
        <div className="dsh-automation-card-title">
          <span className="dsh-automation-card-icon"><AutomationIcon /></span>
          <div>
            <h3>{automation.name}</h3>
            <div className="dsh-automation-card-badges">
              {fulfilled ? (
                <span className="dsh-automation-badge dsh-automation-badge--executed">
                  <span className="dsh-automation-status-dot" />
                  {t('card.executed')}
                </span>
              ) : (
                <AutomationStatusBadge status={automation.status} t={t} />
              )}
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
          <dd>{automation.status === 'paused'
            ? t('card.nextRunPaused')
            : automation.nextRunAt !== undefined
              ? formatRelativeTime(automation.nextRunAt, now, t)
              : fulfilled
                ? <><span className="dsh-automation-mini-dot" />{t('card.executed')}</>
                : '—'}</dd>
        </div>
        <div>
          <dt>{t('card.lastRun')}</dt>
          <dd>{automation.lastRunAt === undefined
            ? t('card.never')
            : <><span className={`dsh-automation-mini-dot${fulfilled ? '' : ` dsh-automation-mini-dot--${automation.lastRunStatus ?? 'succeeded'}`}`} />{formatRelativeTime(automation.lastRunAt, now, t)}</>}</dd>
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
          <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={(event) => onEdit(automation, event.currentTarget.getBoundingClientRect())} disabled={isBusy}>
            <PencilIcon />{t('card.edit')}
          </button>
          <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={(event) => onRun(automation, event.currentTarget.getBoundingClientRect())} disabled={isBusy}>
            <PlayIcon />{t(automation.lastRunAt === undefined ? 'card.runNow' : 'card.runAgain')}
          </button>
          {!fulfilled && (
            <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={() => onMutate(automation.id, automation.status === 'active' ? 'pause' : 'resume')} disabled={isBusy}>
              {automation.status === 'active' ? <PauseIcon /> : <PlayIcon />}
              {t(automation.status === 'active' ? 'card.pause' : 'card.resume')}
            </button>
          )}
          <button className="dsh-automation-icon-button" type="button" aria-label={t('card.delete')} title={t('card.delete')} onClick={() => onConfirmDelete(automation.id)} disabled={isBusy}>
            <TrashIcon />
          </button>
        </div>
      )}
    </article>
  )
}

export function RecentRun({ run, now, t, busy, automationMissing, confirmingDelete, onOpen, onMarkRead, onReadd, onConfirmDelete, onDelete }: {
  run: AutomationRunViewModel
  now: Date
  t: Translate
  busy: boolean
  automationMissing: boolean
  confirmingDelete: boolean
  onOpen: (runId: string, sessionId: string) => void
  onMarkRead: (runId: string) => void
  onReadd: (run: AutomationRunViewModel, anchor?: DOMRect) => void
  onConfirmDelete: (runId?: string) => void
  onDelete: (runId: string) => void
}): JSX.Element {
  const timestamp = run.finishedAt ?? run.startedAt ?? run.scheduledFor
  const canMarkRead = run.unread !== false
    && (run.status === 'failed' || run.status === 'interrupted'
      || run.status === 'skipped' || run.status === 'cancelled')
  const canDelete = run.status !== 'queued' && run.status !== 'running'
  return (
    <article className="dsh-automation-run">
      <div className="dsh-automation-run-top">
        <div className="dsh-automation-run-title">
          <span className="dsh-automation-run-icon"><AutomationIcon /></span>
          <div>
            <h3>{automationMissing ? t('run.automationDeleted') : run.automationName}</h3>
            <div className="dsh-automation-run-meta">
              <span className="dsh-automation-run-trigger">{t(`run.trigger.${run.trigger}`)}</span>
              <RunStatusBadge status={run.status} t={t} />
            </div>
          </div>
        </div>
        <time dateTime={timestamp}>{formatRelativeTime(timestamp, now, t)}</time>
      </div>
      {(run.summary !== undefined || run.error !== undefined) && (
        <p className={run.error === undefined ? '' : 'is-error'}>{run.error ?? run.summary}</p>
      )}
      {run.sessionId !== undefined && run.sessionArchived && (
        <div className="dsh-automation-run-session-row">
          <span className="dsh-automation-session-id dsh-automation-session-id--archived" title={run.sessionId}>
            {t('run.sessionArchived', { id: shortSessionId(run.sessionId) })}
          </span>
        </div>
      )}
      {run.sessionId !== undefined && !run.sessionArchived && (
        <div className="dsh-automation-run-session-row">
          <button className="dsh-automation-session-id" type="button" onClick={() => onOpen(run.id, run.sessionId!)}>
            {t('run.openSession', { id: shortSessionId(run.sessionId) })}
          </button>
        </div>
      )}
      {confirmingDelete ? (
        <div className="dsh-automation-delete-confirm dsh-automation-run-confirm">
          <div><strong>{t('run.confirmDelete')}</strong><span>{t('run.confirmDeleteHint')}</span></div>
          <div>
            <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={() => onConfirmDelete()} disabled={busy}>{t('card.cancel')}</button>
            <button className="dsh-automation-button dsh-automation-button--danger" type="button" onClick={() => onDelete(run.id)} disabled={busy}><TrashIcon />{t('card.confirm')}</button>
          </div>
        </div>
      ) : (
        <div className="dsh-automation-run-actions">
          {canMarkRead && (
            <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={() => onMarkRead(run.id)} disabled={busy}>
              <CheckIcon />{t('run.markRead')}
            </button>
          )}
          <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={(event) => onReadd(run, event.currentTarget.getBoundingClientRect())} disabled={busy}>
            <PlusIcon />{t('run.readd')}
          </button>
          {canDelete && (
            <button className="dsh-automation-icon-button" type="button" aria-label={t('run.delete')} title={t('run.delete')} onClick={() => onConfirmDelete(run.id)} disabled={busy}>
              <TrashIcon />
            </button>
          )}
        </div>
      )}
    </article>
  )
}

/** Native conversation view: all data and effects arrive through the slot's four shares. */
export function AutomationView({
  t, useAutomationState, refresh, createAutomation, updateAutomation, mutateAutomation, runNow, markRunRead,
  deleteRun, updateSettings, loadModelCatalog, openSession, refreshSessions,
}: AutomationViewProps): JSX.Element {
  const state = useAutomationState(value => value)
  const [showCreate, setShowCreate] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [runNowTarget, setRunNowTarget] = useState<AutomationViewModel>()
  const [editingAutomation, setEditingAutomation] = useState<AutomationViewModel>()
  const [busyKey, setBusyKey] = useState<string>()
  const [actionError, setActionError] = useState<string>()
  const [confirmDeleteId, setConfirmDeleteId] = useState<string>()
  const [confirmDeleteRunId, setConfirmDeleteRunId] = useState<string>()
  const [sortKey, setSortKey] = useState<AutomationSortKey>(() => readSortDefault(SORT_STORAGE, WORKSPACE_SORT_DEFAULT_KEY)?.key ?? 'created')
  const [sortDirection, setSortDirection] = useState<AutomationSortDirection>(() => readSortDefault(SORT_STORAGE, WORKSPACE_SORT_DEFAULT_KEY)?.direction ?? 'desc')
  const [taskView, setTaskView] = useState<TaskView>('today')
  const [rangeView, setRangeView] = useState<CalendarRangeView>(() => {
    if (SORT_STORAGE === undefined) return 'week'
    const raw = SORT_STORAGE.getItem(WORKSPACE_RANGE_DEFAULT_KEY)
    return raw === 'week' || raw === 'month' || raw === 'list' ? raw : 'week'
  })
  const [calendarCursor, setCalendarCursor] = useState<Date>()
  const [selectedDate, setSelectedDate] = useState<Date>()
  const [draft, setDraft] = useState<AutomationFormState | undefined>(undefined)
  const [draftClosePrompt, setDraftClosePrompt] = useState(false)
  const [formSeed, setFormSeed] = useState(0)
  const draftRef = useRef<{ form: AutomationFormState | undefined }>({ form: undefined })
  const createAnchorRef = useRef<DOMRect | undefined>(undefined)
  const editAnchorRef = useRef<DOMRect | undefined>(undefined)
  const runNowAnchorRef = useRef<DOMRect | undefined>(undefined)
  const settingsAnchorRef = useRef<DOMRect | undefined>(undefined)
  const runsSignatureRef = useRef('')
  const phaseRef = useRef(state.phase)
  phaseRef.current = state.phase
  useEffect(() => {
    // Refresh the global session list whenever a run starts or settles, so
    // the automation's conversation appears in the workspace list without
    // having to open it from the run record first.
    const syncSessions = (): void => {
      const runs = latestSnapshotRef.current?.runs ?? []
      const signature = runs.map(run => `${run.id}:${run.status}`).join('|')
      if (signature !== runsSignatureRef.current) {
        runsSignatureRef.current = signature
        void refreshSessions().catch(() => undefined)
      }
    }
    const poll = (): void => { void refresh().then(syncSessions, syncSessions) }
    poll()
    let timer: number | undefined
    // Recover quickly from a not-yet-live source session and transient errors;
    // settle back to the regular cadence once the snapshot is ready.
    const schedule = (): void => {
      const phase = phaseRef.current
      timer = window.setTimeout(() => {
        poll()
        schedule()
      }, phase === 'unavailable' || phase === 'error' ? RETRY_FAST_MS : POLL_INTERVAL_MS)
    }
    schedule()
    return () => { if (timer !== undefined) window.clearTimeout(timer) }
  }, [refresh, refreshSessions])

  const snapshot = state.snapshot
  const latestSnapshotRef = useRef(snapshot)
  latestSnapshotRef.current = snapshot
  const draftKey = snapshot === undefined
    ? undefined
    : `dsh-automation.draft.workspace.${snapshot.scope.workspaceId ?? 'local'}`
  useEffect(() => {
    setDraft(draftKey === undefined ? undefined : readDraft(SORT_STORAGE, draftKey))
  }, [draftKey])
  const saveDraft = useCallback((form: AutomationFormState): void => {
    if (draftKey === undefined) return
    writeDraft(SORT_STORAGE, draftKey, form)
    draftRef.current.form = form
  }, [draftKey])
  const hasDraftContent = (): boolean => {
    const form = draftRef.current.form
    return form !== undefined && (form.name.trim() !== '' || form.prompt.trim() !== '')
  }
  const closeCreate = (): void => {
    if (hasDraftContent()) setDraftClosePrompt(true)
    else setShowCreate(false)
  }
  const closeCreateKeep = (): void => {
    setDraftClosePrompt(false)
    setShowCreate(false)
  }
  const closeCreateDiscard = (): void => {
    if (draftKey !== undefined) clearDraft(SORT_STORAGE, draftKey)
    draftRef.current.form = undefined
    setDraft(undefined)
    setDraftClosePrompt(false)
    setShowCreate(false)
  }
  const stats = useMemo(() => snapshot === undefined ? undefined : deriveOverview(snapshot), [snapshot])
  const now = useMemo(() => new Date(snapshot?.serverNow ?? Date.now()), [snapshot?.serverNow])
  const automations = useMemo(() => {
    if (snapshot === undefined) return []
    const normalized = snapshot.automations.map(automation => {
      const next = automation.nextRunAt
        ?? (automation.status === 'paused' ? plannedNextRun(automation.schedule, automation.createdAt, now) : undefined)
      return next === undefined ? automation : { ...automation, nextRunAt: next }
    })
    // All tasks stay in the list; fulfilled one-shots sort to the bottom
    // (no next run) and are marked as executed, not removed.
    return sortAutomations(normalized, sortKey, sortDirection)
  }, [snapshot, now, sortDirection, sortKey])
  // Fulfilled one-shots: succeeded and no pending schedule left. They stay
  // visible but are excluded from the pending counts.
  const doneCount = useMemo(() => (
    snapshot === undefined ? 0 : snapshot.automations.filter(isFulfilledAutomation).length
  ), [snapshot])
  // 启用只统计仍待执行的任务：已执行的一次性任务不再计入启用。
  const activeCount = useMemo(() => (
    automations.filter(item => item.status === 'active' && !isFulfilledAutomation(item)).length
  ), [automations])
  const pausedCount = useMemo(() => (
    automations.filter(item => item.status === 'paused').length
  ), [automations])
  const todayStart = useMemo(() => startOfLocalDay(now), [now])
  // One day's task list: runs pending that day, then tasks finished that day
  // (marked executed). Mirrors the Today view for any picked calendar day.
  const buildDayList = (day: Date): AutomationViewModel[] => {
    const onDay = (iso: string | undefined): boolean => (
      iso !== undefined && isSameLocalDay(new Date(iso), day)
    )
    const pending = automations.filter(automation => onDay(automation.nextRunAt))
    const finished = automations
      .filter(automation => isFulfilledAutomation(automation) && onDay(automation.lastRunAt))
      .sort((left, right) => String(right.lastRunAt ?? '').localeCompare(String(left.lastRunAt ?? '')))
    return [...sortAutomations(pending, sortKey, sortDirection), ...finished]
  }
  const todayAutomations = useMemo(
    () => buildDayList(todayStart),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [automations, sortDirection, sortKey, todayStart],
  )
  const todayPendingCount = useMemo(() => {
    const isOnToday = (iso: string | undefined): boolean => (
      iso !== undefined && isSameLocalDay(new Date(iso), todayStart)
    )
    return automations.filter(automation => isOnToday(automation.nextRunAt)).length
  }, [automations, todayStart])
  const calendarAnchor = calendarCursor ?? startOfLocalWeek(todayStart)
  const pickedDate = selectedDate ?? todayStart
  const weekDays = useMemo(() => buildWeekCalendarDays(calendarAnchor), [calendarAnchor])
  const monthDays = useMemo(() => buildMonthCalendarGrid(calendarAnchor), [calendarAnchor])
  const calendarTitleDate = rangeView === 'week' ? weekDays[3] ?? calendarAnchor : calendarAnchor
  const calendarTitleYear = calendarTitleDate.getFullYear()
  const calendarTitleMonth = calendarTitleDate.getMonth() + 1
  const dayAutomations = useMemo(
    () => buildDayList(pickedDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [automations, pickedDate, sortDirection, sortKey],
  )
  const visibleAutomations = useMemo(() => {
    if (taskView === 'today') return todayAutomations
    if (rangeView === 'list') return automations
    return dayAutomations
  }, [dayAutomations, rangeView, taskView, todayAutomations])
  // Executed cards stay in the view but render below the create button.
  const visiblePending = useMemo(() => (
    visibleAutomations.filter(automation => !isFulfilledAutomation(automation))
  ), [visibleAutomations])
  const visibleExecuted = useMemo(() => (
    visibleAutomations.filter(isFulfilledAutomation)
  ), [visibleAutomations])
  const automationIdSet = useMemo(() => (
    new Set((snapshot?.automations ?? []).map(item => item.id))
  ), [snapshot])

  const selectRange = (range: CalendarRangeView): void => {
    setRangeView(range)
    if (SORT_STORAGE !== undefined) {
      try { SORT_STORAGE.setItem(WORKSPACE_RANGE_DEFAULT_KEY, range) } catch { /* best effort */ }
    }
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
  const openCreate = (event: ReactMouseEvent<HTMLElement>): void => {
    setEditingAutomation(undefined)
    if (showCreate) {
      closeCreate()
      return
    }
    createAnchorRef.current = event.currentTarget.getBoundingClientRect()
    if (draftKey !== undefined) setDraft(readDraft(SORT_STORAGE, draftKey))
    setShowCreate(true)
  }
  const toggleCreate = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    setEditingAutomation(undefined)
    if (showCreate) {
      closeCreate()
      return
    }
    createAnchorRef.current = event.currentTarget.getBoundingClientRect()
    if (draftKey !== undefined) setDraft(readDraft(SORT_STORAGE, draftKey))
    setShowCreate(true)
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
  const onRun = (automation: AutomationViewModel, anchor?: DOMRect): void => {
    setRunNowTarget(automation)
    runNowAnchorRef.current = anchor
  }
  const onRunNow = async (automationId: string, mode: RunNowMode): Promise<void> => {
    let started = false
    await perform(actionKey('run', automationId), async () => {
      await runNow(automationId, mode)
      started = true
    })
    if (started) setRunNowTarget(undefined)
  }
  const onOpenSession = (runId: string, sessionId: string): void => {
    void perform(actionKey('run', runId), () => openSession(runId, sessionId))
  }
  const onMarkRead = (runId: string): void => {
    void perform(actionKey('read', runId), () => markRunRead(runId))
  }
  const onReaddRun = (run: AutomationRunViewModel, anchor?: DOMRect): void => {
    // Seed the create form from the run's source automation when it still
    // exists, or from the durable run snapshot when it was deleted.
    const automation = snapshot?.automations.find(item => item.id === run.automationId)
    const form = automation !== undefined
      ? formStateFromAutomation(automation)
      : {
          ...defaultFormState(),
          prompt: run.promptSnapshot ?? '',
          provider: run.provider ?? null,
          model: run.model ?? null,
          reasoningEffort: run.reasoningEffort ?? null,
          permission: run.permission ?? 'read-only',
        }
    createAnchorRef.current = anchor
    if (draftKey !== undefined) writeDraft(SORT_STORAGE, draftKey, form)
    draftRef.current.form = form
    setDraft(form)
    setDraftClosePrompt(false)
    setEditingAutomation(undefined)
    setFormSeed(value => value + 1)
    setShowCreate(true)
  }
  const onDeleteRun = (runId: string): void => {
    void perform(actionKey('delete-run', runId), async () => {
      await deleteRun(runId)
      setConfirmDeleteRunId(undefined)
    })
  }
  const onCreate = async (input: ReturnType<typeof buildCreateInput>): Promise<void> => {
    await perform(actionKey('create'), async () => {
      await createAutomation(input)
      if (draftKey !== undefined) clearDraft(SORT_STORAGE, draftKey)
      draftRef.current.form = undefined
      setDraft(undefined)
      setDraftClosePrompt(false)
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
  const onEdit = (automation: AutomationViewModel, anchor?: DOMRect): void => {
    setShowCreate(false)
    setConfirmDeleteId(undefined)
    editAnchorRef.current = anchor
    setEditingAutomation(automation)
  }
  const openSettings = (event: ReactMouseEvent<HTMLElement>): void => {
    if (settingsOpen) {
      setSettingsOpen(false)
      return
    }
    setEditingAutomation(undefined)
    settingsAnchorRef.current = event.currentTarget.getBoundingClientRect()
    setSettingsOpen(true)
  }
  const onSaveSettings = async (next: SettingsUpdateInput): Promise<void> => {
    let saved = false
    await perform(actionKey('settings'), async () => {
      await updateSettings(next)
      saved = true
    })
    // Only close on success so a rejected save keeps the panel and its error
    // visible instead of silently reverting to the previous values.
    if (saved) setSettingsOpen(false)
  }

  if (snapshot === undefined && (state.phase === 'idle' || state.phase === 'loading')) {
    return (
      <div className="dsh-automation-shell dsh-automation-centered" data-conversation-composer-overlay="" role="status">
        <span className="dsh-automation-loader"><AutomationIcon /></span>
        <span>{t('loading')}</span>
      </div>
    )
  }

  if (snapshot === undefined && state.phase === 'unavailable') {
    return (
      <div className="dsh-automation-shell dsh-automation-centered" data-conversation-composer-overlay="">
        <span className="dsh-automation-error-icon"><AutomationIcon /></span>
        <h2>{t('unavailable.title')}</h2>
        <p>{t('unavailable.body')}</p>
        <button className="dsh-automation-button dsh-automation-button--primary" type="button" onClick={() => { void refresh().catch(() => undefined) }}>
          <RefreshIcon />{t('error.retry')}
        </button>
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
        <AutomationFloat label={t('form.title')} busy={busyKey === actionKey('create')} onClose={closeCreate} anchor={createAnchorRef.current}>
          {draftClosePrompt && (
            <div className="dsh-automation-draft-prompt">
              <span>{t('form.draftPrompt')}</span>
              <div>
                <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={closeCreateKeep}>{t('form.draftKeep')}</button>
                <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={closeCreateDiscard}>{t('form.draftDiscard')}</button>
                <button className="dsh-automation-button dsh-automation-button--primary" type="button" onClick={() => setDraftClosePrompt(false)}>{t('form.draftEdit')}</button>
              </div>
            </div>
          )}
          <AutomationForm
            key={`create:${formSeed}`}
            mode="create"
            initial={draft}
            onSaveDraft={saveDraft}
            t={t}
            busy={busyKey === actionKey('create')}
            loadModelCatalog={loadModelCatalog}
            onCancel={closeCreate}
            onSubmit={onCreate}
          />
        </AutomationFloat>
      )}

      {editingAutomation !== undefined && (
        <AutomationFloat label={t('form.editTitle')} busy={busyKey === actionKey('update', editingAutomation.id)} onClose={() => setEditingAutomation(undefined)} anchor={editAnchorRef.current}>
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
        </AutomationFloat>
      )}

      {settingsOpen && (
        <AutomationFloat label={t('settings.title')} busy={busyKey === actionKey('settings')} onClose={() => setSettingsOpen(false)} anchor={settingsAnchorRef.current}>
          {snapshot.settings === undefined ? (
            <div className="dsh-automation-create">
              <div className="dsh-automation-create-heading">
                <h2>{t('settings.title')}</h2>
                <button className="dsh-automation-button dsh-automation-button--ghost" type="button" onClick={() => setSettingsOpen(false)}>
                  {t('form.cancel')}
                </button>
              </div>
              <p className="dsh-automation-settings-lead">{t('settings.unavailable')}</p>
            </div>
          ) : (
            <AutomationSettingsPanel
              t={t}
              settings={snapshot.settings}
              busy={busyKey === actionKey('settings')}
              saveError={actionError}
              onCancel={() => setSettingsOpen(false)}
              onSubmit={onSaveSettings}
            />
          )}
        </AutomationFloat>
      )}

      {runNowTarget !== undefined && (
        <AutomationFloat
          label={t('run.title')}
          busy={busyKey === actionKey('run', runNowTarget.id)}
          onClose={() => setRunNowTarget(undefined)}
          anchor={runNowAnchorRef.current}
          height={FLOAT_MIN_HEIGHT}
        >
          <AutomationRunDialog
            t={t}
            automation={runNowTarget}
            busy={busyKey === actionKey('run', runNowTarget.id)}
            onCancel={() => setRunNowTarget(undefined)}
            onRun={onRunNow}
          />
        </AutomationFloat>
      )}

      {(actionError !== undefined || (state.error !== undefined && state.phase !== 'unavailable')) && (
        <div className="dsh-automation-inline-error" role="alert"><AlertIcon />{actionError ?? state.error}</div>
      )}

      <div className="dsh-automation-content">
        <section className="dsh-automation-main-column">
          <div className="dsh-automation-status-toolbar">
            <div className="dsh-automation-toolbar-row">
              <div className="dsh-automation-view-switch" role="group">
                <button type="button" className={taskView === 'today' ? 'is-selected' : ''} aria-pressed={taskView === 'today'} onClick={() => setTaskView('today')}>
                  <span>{t('view.todayTasks')}</span><b>{todayPendingCount}</b>
                </button>
                <button type="button" className={taskView === 'all' ? 'is-selected' : ''} aria-pressed={taskView === 'all'} onClick={() => setTaskView('all')}>
                  <span>{t('view.allTasks')}</span><b>{Math.max(0, automations.length - doneCount)}</b>
                </button>
              </div>
              <div className="dsh-automation-status-summary">
                <div className="dsh-automation-status-column">
                  <span className="dsh-automation-status-item"><b>{t('stats.active')}</b><em>{activeCount}</em></span>
                  <span className="dsh-automation-status-item"><b>{t('stats.paused')}</b><em>{pausedCount}</em></span>
                </div>
                <div className="dsh-automation-status-column">
                  <span className="dsh-automation-status-item"><b>{t('stats.executed')}</b><em>{doneCount}</em></span>
                  <span className="dsh-automation-status-item"><b>{t('stats.next')}</b><em>{stats?.nextRunAt === undefined ? t('stats.noneScheduled') : formatRelativeTime(stats.nextRunAt, now, t)}</em></span>
                </div>
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
                  {(['week', 'month', 'list'] as const).map(range => (
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
                        const counts = countAutomationsByStatusOnDay(automations, day)
                        const executed = countExecutedOnDay(automations, day)
                        const weekday = day.getDay() === 0 ? 7 : day.getDay()
                        return (
                          <button key={day.toISOString()} type="button" className={`dsh-automation-cal-day${isSameLocalDay(day, todayStart) ? ' is-today' : ''}${isSameLocalDay(day, pickedDate) ? ' is-selected' : ''}`} onClick={() => selectDay(day)}>
                            <span className="dsh-automation-cal-weekday">{t(`day.${weekday}` as AutomationLocaleKey)}</span>
                            <span className="dsh-automation-cal-date">{day.getMonth() + 1}/{day.getDate()}</span>
                            {counts.active > 0 && <span className="dsh-automation-cal-count">{t('calendar.taskCount', { count: counts.active })}</span>}
                            {counts.paused > 0 && <span className="dsh-automation-cal-count dsh-automation-cal-count--paused">{t('calendar.pausedCount', { count: counts.paused })}</span>}
                            {executed > 0 && <span className="dsh-automation-cal-count dsh-automation-cal-count--executed">{t('calendar.executedCount', { count: executed })}</span>}
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
                          const counts = countAutomationsByStatusOnDay(automations, day)
                          const executed = countExecutedOnDay(automations, day)
                          const otherMonth = day.getMonth() !== calendarAnchor.getMonth()
                          return (
                            <button key={day.toISOString()} type="button" className={`dsh-automation-cal-month-day${otherMonth ? ' is-other' : ''}${isSameLocalDay(day, todayStart) ? ' is-today' : ''}${isSameLocalDay(day, pickedDate) ? ' is-selected' : ''}`} onClick={() => selectDay(day)}>
                              <span className="dsh-automation-cal-month-date">{day.getDate()}</span>
                              {counts.active > 0 && <span className="dsh-automation-cal-count">{t('calendar.taskCount', { count: counts.active })}</span>}
                              {counts.paused > 0 && <span className="dsh-automation-cal-count dsh-automation-cal-count--paused">{t('calendar.pausedCount', { count: counts.paused })}</span>}
                              {executed > 0 && <span className="dsh-automation-cal-count dsh-automation-cal-count--executed">{t('calendar.executedCount', { count: executed })}</span>}
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
              <button className="dsh-automation-button dsh-automation-button--primary" type="button" onClick={openCreate}>{showCreate ? <><PauseIcon />{t('header.closeCreate')}</> : <><PlusIcon />{t('empty.action')}</>}</button>
            </div>
          ) : visibleAutomations.length === 0 ? (
            <div className="dsh-automation-empty">
              <span><CalendarIcon /></span>
              <h3>{taskView === 'today' ? t('empty.todayNone') : t('empty.dayNone')}</h3>
              <button className="dsh-automation-button dsh-automation-button--primary" type="button" onClick={openCreate}>{showCreate ? <><PauseIcon />{t('header.closeCreate')}</> : <><PlusIcon />{t('header.create')}</>}</button>
            </div>
          ) : (
            visiblePending.length > 0 && (
              <div className="dsh-automation-card-list">
                {visiblePending.map(automation => (
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
            )
          )}

          {visibleAutomations.length > 0 && (
            <div className="dsh-automation-empty dsh-automation-empty--footer">
              <button className="dsh-automation-button dsh-automation-button--primary" type="button" onClick={openCreate}>{showCreate ? <><PauseIcon />{t('header.closeCreate')}</> : <><PlusIcon />{t('header.create')}</>}</button>
            </div>
          )}

          {visibleExecuted.length > 0 && (
            <div className="dsh-automation-card-list">
              {visibleExecuted.map(automation => (
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
              <span className={`dsh-automation-runs-status${(stats?.attention ?? 0) > 0 ? ' is-error' : ''}`}>
                <span className="dsh-automation-runs-status-label">{t('stats.currentStatus')}</span>
                <span className="dsh-automation-runs-status-value">
                  <i className="dsh-automation-runs-status-icon" aria-hidden="true">{(stats?.attention ?? 0) > 0 ? <AlertIcon /> : <CheckIcon />}</i>
                  {(stats?.attention ?? 0) > 0 ? t('stats.attention') : t('stats.noAttention')}
                  {(stats?.attention ?? 0) > 0 && <b>{stats?.attention ?? 0}</b>}
                </span>
              </span>
              <button
                className="dsh-automation-runs-settings"
                type="button"
                onClick={openSettings}
              >
                <GearIcon />
                <span>{t('settings.open')}</span>
              </button>
            </div>
            {snapshot.runs.length === 0
              ? <div className="dsh-automation-runs-empty">{t('runs.empty')}</div>
              : <div className="dsh-automation-run-list">{snapshot.runs.map(run => {
                  const automationMissing = !automationIdSet.has(run.automationId)
                  return (
                    <RecentRun
                      key={run.id}
                      run={run}
                      now={now}
                      t={t}
                      busy={busyKey === actionKey('run', run.id)
                        || busyKey === actionKey('delete-run', run.id)
                        || busyKey === actionKey('read', run.id)}
                      automationMissing={automationMissing}
                      confirmingDelete={confirmDeleteRunId === run.id}
                      onOpen={onOpenSession}
                      onMarkRead={onMarkRead}
                      onReadd={onReaddRun}
                      onConfirmDelete={setConfirmDeleteRunId}
                      onDelete={onDeleteRun}
                    />
                  )
                })}</div>}
          </div>
        </aside>
      </div>
    </div>
  )
}

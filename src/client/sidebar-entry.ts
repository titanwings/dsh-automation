/** Homepage sidebar entry: a DOM-managed native control rendered below the
 * new-chat button. DSH exposes no official slot for that position, so the
 * installer follows the same placement strategy as dsh-personal-workbench and
 * keeps the existing behavior: activate the localized Automations tab when a
 * conversation tab ring exists, otherwise surface an explicit hint. */
import type { Translate } from './contracts.js'
import { activateAutomationTab } from './navigation.js'

export const ENTRY_ATTR = 'data-dsh-automation-entry'
const NOTICE_ID = 'dsh-automation-sidebar-unavailable'
const SIBLING_ENTRY_SELECTOR = '[data-dsh-taskboard-entry], [data-dsh-ssh-entry]'

const ENTRY_SVG = '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.25"/><path d="M12 7.7v4.7l3.15 1.85"/><path d="M5.6 4.9 4.2 6.3M18.4 4.9l1.4 1.4"/></svg>'

function sidebarRoot(): HTMLElement | undefined {
  // Anchor on the native new-chat button first: DSH Desktop extended/advanced
  // modes render the upstream sidebar inside dshDesktopUpstreamSidebar instead of
  // the official sidebarCol, so the button is the stable landmark across modes.
  const button = document.querySelector<HTMLButtonElement>('button[class*="newSession"]')
  if (button !== null) {
    const row = button.closest<HTMLElement>('[class*="logoRow"]')
    return row?.parentElement ?? button.parentElement ?? undefined
  }
  const column = document.querySelector<HTMLElement>(
    '[data-pane="sidebar"], [class*="sidebarCol"], [class*="dshDesktopUpstreamSidebar"], [class*="dshDesktopSidebarSurface"]',
  )
  if (column === null) return undefined
  return column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement
    ?? (column.firstElementChild as HTMLElement | undefined)
}

function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  const nested = root.querySelector<HTMLButtonElement>('button[class*="newSession"]')
  if (nested !== null) return nested
  return Array.from(root.children).find((child): child is HTMLButtonElement => child.tagName === 'BUTTON')
}

function automationTabs(): Iterable<{ readonly textContent: string | null; click(): void }> {
  return document.querySelectorAll<HTMLElement>('[role="tab"]')
}

/** Install the entry and return its disposer. DOM state is disposable; the
 * Automations conversation view remains the authority for management UI. */
export function installAutomationSidebarEntry(t: Translate): () => void {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.setAttribute(ENTRY_ATTR, '')
  entry.className = 'dsh-automation-sidebar-entry'
  entry.setAttribute('aria-label', t('sidebar.tooltip'))
  entry.innerHTML = ENTRY_SVG
  const label = document.createElement('span')
  label.className = 'dsh-automation-sidebar-entry-label'
  label.textContent = t('tab')
  entry.append(label)

  const TOOLTIP_DELAY_MS = 500
  let tooltip: HTMLDivElement | undefined
  let tooltipTimer: ReturnType<typeof setTimeout> | undefined
  const hideTooltip = (): void => {
    if (tooltipTimer !== undefined) clearTimeout(tooltipTimer)
    tooltipTimer = undefined
    tooltip?.remove()
    tooltip = undefined
  }
  const showTooltip = (): void => {
    if (tooltip !== undefined || !document.querySelector('[data-sidebar-collapsed]')) return
    const rect = entry.getBoundingClientRect()
    tooltip = document.createElement('div')
    tooltip.className = 'dsh-automation-sidebar-tooltip'
    tooltip.textContent = t('sidebar.tooltip')
    document.body.append(tooltip)
    tooltip.style.left = `${rect.right + 8}px`
    tooltip.style.top = `${rect.top + rect.height / 2}px`
  }
  const onTooltipEnter = (): void => {
    hideTooltip()
    tooltipTimer = setTimeout(showTooltip, TOOLTIP_DELAY_MS)
  }
  const onTooltipLeave = (): void => hideTooltip()
  entry.addEventListener('mouseenter', onTooltipEnter)
  entry.addEventListener('mouseleave', onTooltipLeave)
  entry.addEventListener('focus', onTooltipEnter)
  entry.addEventListener('blur', onTooltipLeave)

  let notice: HTMLSpanElement | undefined
  const positionNotice = (): void => {
    if (notice === undefined) return
    const rect = entry.getBoundingClientRect()
    notice.style.top = `${Math.max(8, rect.bottom + 6)}px`
    notice.style.left = `${Math.max(8, rect.left)}px`
  }
  const hideNotice = (): void => {
    notice?.remove()
    notice = undefined
  }
  const showNotice = (): void => {
    if (notice !== undefined) return
    notice = document.createElement('span')
    notice.id = NOTICE_ID
    notice.className = 'dsh-automation-sidebar-feedback'
    notice.setAttribute('role', 'status')
    notice.textContent = t('sidebar.unavailable')
    document.body.append(notice)
    positionNotice()
  }

  const open = (): void => {
    const result = activateAutomationTab(automationTabs(), t('tab'), showNotice)
    if (result === 'opened') hideNotice()
  }
  entry.addEventListener('click', open)

  let rootEl: HTMLElement | undefined
  const placeEntry = (): void => {
    if (rootEl !== undefined && !rootEl.isConnected) rootEl = undefined
    rootEl ??= sidebarRoot()
    if (rootEl === undefined) return
    const button = newSessionButton(rootEl)
    if (button === undefined) return
    if (entry.parentElement !== rootEl) {
      const row = button.closest('[class*="logoRow"]')
      const base = row !== null && row.parentElement === rootEl ? row : button
      // Keep a stable order next to sibling plugins that inject the same way.
      const sibling = Array.from(rootEl.children).find((child): child is HTMLElement => (
        child instanceof HTMLElement && child.matches(SIBLING_ENTRY_SELECTOR)
      ))
      rootEl.insertBefore(entry, sibling ?? base.nextElementSibling)
    }
  }
  placeEntry()
  const observer = new MutationObserver(placeEntry)
  observer.observe(document.body, { childList: true, subtree: true })
  window.addEventListener('resize', positionNotice)

  return () => {
    observer.disconnect()
    window.removeEventListener('resize', positionNotice)
    hideTooltip()
    entry.remove()
    hideNotice()
  }
}

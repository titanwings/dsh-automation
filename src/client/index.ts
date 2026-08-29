import { AutomationView } from './AutomationView.js'
import type { ClientContext } from './contracts.js'
import { en, NS, zh } from './locales.js'
import { createAutomationRuntime, loadModelCatalog } from './runtime.js'
import { installAutomationSidebarEntry } from './sidebar-entry.js'
import { installStyles } from './styles.js'

export const name = 'dsh-automation-client'
export const inject = ['slots', 'locale', 'connection', 'sessions']

/** Register one native Automations tab into DSH's session-scoped view ring. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => installStyles(), 'dsh-automation: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-automation: locale')
  const t = ctx.locale.bind(NS)
  const readModelCatalog = () => loadModelCatalog(ctx.connection.api.llm)
  // Inject factories can run more than once while React reconciles. Keep one
  // observable identity per session for the lifetime of this plugin fiber.
  const runtimes = new Map<string, ReturnType<typeof createAutomationRuntime>>()
  ctx.effect(() => () => { runtimes.clear() }, 'dsh-automation: session runtimes')
  // The homepage entry lives below the new-chat button (no official slot
  // exists there); it is a DOM-managed projection of the conversation view.
  ctx.effect(() => installAutomationSidebarEntry(t), 'dsh-automation: sidebar entry')
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'automation',
    order: 40,
    locale: NS,
    label: () => t('tab'),
    inject: (sessionId) => {
      let runtime = runtimes.get(sessionId)
      if (runtime === undefined) {
        runtime = createAutomationRuntime(ctx.connection.rpc, sessionId)
        runtimes.set(sessionId, runtime)
      }
      return {
        hooks: { automationState: runtime.source },
        refresh: runtime.refresh,
        createAutomation: runtime.createAutomation,
        updateAutomation: runtime.updateAutomation,
        mutateAutomation: runtime.mutateAutomation,
        runNow: runtime.runNow,
        markRunRead: runtime.markRunRead,
        loadModelCatalog: readModelCatalog,
        openSession: (runId, runSessionId) => runtime!.openRunSession(runId, async () => {
          await ctx.sessions.refresh()
          ctx.sessions.open(runSessionId)
        }),
      }
    },
  }, AutomationView))
}

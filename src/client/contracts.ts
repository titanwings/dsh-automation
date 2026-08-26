import type { ComponentType } from 'react'
import type { AutomationLocaleKey } from './locales.js'
import type { ModelCatalog, RpcResult } from './protocol.js'
import type { AutomationClientState, AutomationRuntime } from './runtime.js'

export type Translate = (key: AutomationLocaleKey, params?: Record<string, unknown>) => string

export interface SelectorHook<T> {
  <Selected>(selector: (value: T) => Selected): Selected
}

export interface AutomationViewProps {
  readonly sessionId: string
  readonly t: Translate
  readonly useAutomationState: SelectorHook<AutomationClientState>
  readonly refresh: AutomationRuntime['refresh']
  readonly createAutomation: AutomationRuntime['createAutomation']
  readonly updateAutomation: AutomationRuntime['updateAutomation']
  readonly mutateAutomation: AutomationRuntime['mutateAutomation']
  readonly runNow: AutomationRuntime['runNow']
  readonly markRunRead: AutomationRuntime['markRunRead']
  readonly loadModelCatalog: () => Promise<ModelCatalog>
  readonly openSession: (runId: string, sessionId: string) => Promise<void>
}

export interface ClientRpc {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}

export interface ClientLlmApi {
  models(payload: Record<string, never>): Promise<{ readonly result: RpcResult<ModelCatalog> }>
}

export interface ClientContext {
  effect(factory: () => void | (() => void), label?: string): void
  connection: {
    readonly rpc: ClientRpc
    readonly api: { readonly llm: ClientLlmApi }
  }
  sessions: {
    refresh(): Promise<void>
    open(sessionId: string): void
  }
  locale: {
    register(
      namespace: string,
      dictionaries: { readonly zh: Record<string, string>; readonly en: Record<string, string> },
    ): () => void
    bind(namespace: string): Translate
  }
  slots: {
    inject(
      name: 'conversation.view',
      register: () => void | (() => void),
    ): void
    register(
      options: {
        readonly name: 'conversation.view'
        readonly id: string
        readonly order: number
        readonly locale: string
        readonly label: () => string
        readonly inject: (sessionId: string) => {
          readonly hooks: { readonly automationState: AutomationRuntime['source'] }
          readonly refresh: AutomationRuntime['refresh']
          readonly createAutomation: AutomationRuntime['createAutomation']
          readonly updateAutomation: AutomationRuntime['updateAutomation']
          readonly mutateAutomation: AutomationRuntime['mutateAutomation']
          readonly runNow: AutomationRuntime['runNow']
          readonly markRunRead: AutomationRuntime['markRunRead']
          readonly loadModelCatalog: () => Promise<ModelCatalog>
          readonly openSession: (runId: string, sessionId: string) => Promise<void>
        }
      },
      component: ComponentType<AutomationViewProps>,
    ): () => void
  }
}

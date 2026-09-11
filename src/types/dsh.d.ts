/** Minimal compile-time declarations for DSH packages supplied by the Host at runtime. */

declare module '@deepseek-ai/cordis' {
  export interface Context {
    readonly agent?: any
    readonly agents: any
    readonly agentDefaultModel: any
    readonly agentPresets: any
    readonly sessions: any
    readonly workspaceRegistry: any
    readonly storageDomain: any
    readonly connection: any
    readonly tools: any
    readonly logger: { warn(message: string): void }
    effect<T>(factory: () => T | Promise<T>, label?: string): T
    on(name: string, listener: (...args: any[]) => any): () => void
    get(name: string): unknown
  }
}

declare module '@deepseek-ai/schemastery' {
  const z: any
  export default z
}

declare module '@deepseek-ai/dsh-agent' {
  /** Unpublished Agent being composed, passed as the setup callback's 2nd argument. */
  export interface Agent {
    readonly session: any
  }
  export interface ModelSelection {
    provider: string
    model: string
    reasoningEffort?: string
  }
  export function installModelSelection(agentCtx: unknown, selection: {
    current: ModelSelection | undefined
    assembled: ModelSelection | undefined
  }): () => void
}

declare module '@deepseek-ai/dsh-agent-default-model' {}
declare module '@deepseek-ai/dsh-agent-presets' {}
declare module '@deepseek-ai/dsh-client-connection' {}

declare module '@deepseek-ai/dsh-llm' {
  export function createUserMessage(value: {
    content: readonly { type: 'text'; text: string }[]
    source: unknown
  }): unknown
}

declare module '@deepseek-ai/dsh-sandbox-policy' {
  export function setSandboxMode(session: unknown, mode: 'read-only' | 'workspace-write'): void
}

declare module '@deepseek-ai/dsh-session' {
  export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
  export type SessionId = string & { readonly __sessionId: unique symbol }
  export function SessionId(value: string): SessionId
}

declare module '@deepseek-ai/dsh-user-approval' {
  export function setApprovalPolicy(session: unknown, policy: 'ask' | 'never'): void
}

declare module '@deepseek-ai/dsh-workspace' {
  export type WorkspaceId = string & { readonly __workspaceId: unique symbol }
  export function WorkspaceId(value: string): WorkspaceId
}

declare module '@deepseek-ai/dsh-storage-domain' {
  import type { ZodType } from 'zod'
  export interface DomainSpec {
    readonly name: string
    readonly version: number
    readonly tables: Record<string, { readonly valueSchema: ZodType }>
  }
  export function defineDomain<S extends DomainSpec>(spec: S): S
  export function domainTable<K extends string, V>(schema: ZodType<V>): {
    readonly valueSchema: ZodType<V>
    readonly __key?: K
  }
  export interface KvTable<K extends string, V> {
    get(key: K): V | undefined
    entries(): IterableIterator<[K, V]>
    keys(): IterableIterator<K>
    readonly size: number
    put(key: K, value: V): Promise<void>
    delete(key: K): Promise<boolean>
    update(key: K, transform: (current: V) => V): Promise<V>
  }
  export interface Domain<S> {
    readonly name: string
    table(name: string): KvTable<string, any>
    close(): Promise<void>
  }
}

declare module '@deepseek-ai/dsh-tools' {
  import type { JsonValue } from '@deepseek-ai/dsh-session'
  export type { JsonValue } from '@deepseek-ai/dsh-session'
  export interface ToolRunContext {
    readonly signal: AbortSignal
    readonly agent?: { readonly id: string }
  }
  export interface ToolExecution {
    readonly name: string
    readonly arguments: unknown
  }
  export function defineTool(definition: any): any
}

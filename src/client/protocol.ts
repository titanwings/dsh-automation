/** JSON contract shared conceptually with the dsh-automation Host RPC adapter. */

export type AutomationStatus = 'active' | 'paused'

export type AutomationRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'interrupted'

export type AutomationPermission = 'read-only' | 'workspace-write'

export interface ModelReasoningEffort {
  readonly id: string
  readonly name: string
  readonly description?: string
}

export interface ModelReasoning {
  readonly efforts: readonly ModelReasoningEffort[]
  readonly defaultEffort?: string
}

export interface ModelCatalogModel {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly reasoning?: ModelReasoning
}

export interface ModelProviderGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly ModelCatalogModel[]
}

export interface ModelCatalogFailure {
  readonly id: string
  readonly name: string
  readonly message: string
}

export interface ModelCatalog {
  readonly groups: readonly ModelProviderGroup[]
  readonly failures: readonly ModelCatalogFailure[]
}

export type AutomationSchedule =
  | { readonly kind: 'once'; readonly at: string; readonly timeZone?: string }
  | { readonly kind: 'interval'; readonly everyMinutes: number; readonly anchor?: string; readonly timeZone?: string }
  | { readonly kind: 'daily'; readonly time: string; readonly timeZone?: string }
  | { readonly kind: 'weekly'; readonly time: string; readonly weekdays: readonly number[]; readonly timeZone?: string }

export interface AutomationViewModel {
  readonly id: string
  readonly revision: number
  readonly name: string
  readonly prompt: string
  readonly status: AutomationStatus
  readonly schedule: AutomationSchedule
  readonly scheduleSummary: string
  readonly timeZone: string
  readonly provider: string | null
  readonly model: string | null
  readonly reasoningEffort: string | null
  readonly permission: AutomationPermission
  readonly nextRunAt?: string
  readonly lastRunAt?: string
  readonly lastRunStatus?: AutomationRunStatus
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AutomationRunViewModel {
  readonly id: string
  readonly automationId: string
  readonly automationName: string
  readonly status: AutomationRunStatus
  readonly trigger: 'schedule' | 'manual' | 'catch-up'
  readonly scheduledFor: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly sessionId?: string
  readonly sessionArchived: boolean
  readonly summary?: string
  readonly error?: string
  readonly unread?: boolean
  readonly promptSnapshot?: string
  readonly provider?: string | null
  readonly model?: string | null
  readonly reasoningEffort?: string | null
  readonly permission?: AutomationPermission
}

export interface AutomationSettingsView {
  readonly catchUpMissedRuns: boolean
  readonly catchUpMissedRunsMax: number
  readonly misfireGraceMinutes: number
}

export interface AutomationSnapshot {
  readonly scope: {
    readonly workspaceId?: string
    readonly workspaceName?: string
    readonly cwd: string
  }
  readonly automations: readonly AutomationViewModel[]
  readonly runs: readonly AutomationRunViewModel[]
  readonly settings?: AutomationSettingsView
  readonly serverNow: string
}

export interface CreateAutomationInput {
  readonly name: string
  readonly prompt: string
  readonly schedule: AutomationSchedule
  readonly timeZone: string
  readonly provider: string | null
  readonly model: string | null
  readonly reasoningEffort: string | null
  readonly permission: AutomationPermission
}

export interface UpdateAutomationInput {
  readonly name?: string
  readonly prompt?: string
  readonly schedule?: AutomationSchedule
  readonly timeZone?: string
  readonly provider?: string | null
  readonly model?: string | null
  readonly reasoningEffort?: string | null
  readonly permission?: AutomationPermission
}

export interface SnapshotRequest {
  readonly sessionId: string
}

export interface CreateRequest {
  readonly sessionId: string
  readonly input: CreateAutomationInput
}

export interface UpdateRequest {
  readonly sessionId: string
  readonly automationId: string
  readonly expectedRevision: number
  readonly input: UpdateAutomationInput
}

export interface MutateRequest {
  readonly sessionId: string
  readonly automationId: string
  readonly mutation: 'pause' | 'resume' | 'delete'
}

export type RunNowMode = 'plain' | 'ahead'

export interface RunNowRequest {
  readonly sessionId: string
  readonly automationId: string
  readonly mode?: RunNowMode
}

export interface MarkReadRequest {
  readonly sessionId: string
  readonly runId: string
}

export interface ArchiveRunRequest {
  readonly sessionId: string
  readonly runId: string
}

export interface DeleteRunRequest {
  readonly sessionId: string
  readonly runId: string
}

export interface SettingsUpdateInput {
  readonly catchUpMissedRuns: boolean
  readonly catchUpMissedRunsMax: number
  readonly misfireGraceMinutes: number
}

export interface UpdateSettingsRequest {
  readonly sessionId: string
  readonly settings: SettingsUpdateInput
}

export interface RpcErrorValue {
  readonly code: string
  readonly message: string
  readonly details?: unknown
}

export type RpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RpcErrorValue }

/** Fail closed when the host rejects a request or returns a malformed envelope. */
export function unwrapRpcResult<T>(value: unknown): T {
  if (typeof value !== 'object' || value === null || !('ok' in value)) {
    throw new Error('The automation host returned an invalid response.')
  }
  const result = value as Partial<RpcResult<T>>
  if (result.ok === true && 'value' in result) return result.value as T
  if (result.ok === false && 'error' in result) {
    const error = result.error as RpcErrorValue | undefined
    throw new Error(error?.message ?? 'The automation request failed.')
  }
  throw new Error('The automation host returned an invalid response.')
}

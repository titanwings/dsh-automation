export type AutomationStatus = 'active' | 'paused';
export type AutomationRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
export interface OnceSchedule {
    readonly kind: 'once';
    readonly at: string;
    readonly timeZone: string;
}
export interface IntervalSchedule {
    readonly kind: 'interval';
    readonly everyMinutes: number;
    readonly anchor: string;
    readonly timeZone: string;
}
export interface DailySchedule {
    readonly kind: 'daily';
    readonly time: string;
    readonly timeZone: string;
}
export interface WeeklySchedule {
    readonly kind: 'weekly';
    readonly weekdays: readonly Weekday[];
    readonly time: string;
    readonly timeZone: string;
}
export type AutomationSchedule = OnceSchedule | IntervalSchedule | DailySchedule | WeeklySchedule;
export type PermissionPreset = 'read-only' | 'workspace-write';
export interface AutomationCreator {
    readonly kind: 'agent' | 'web';
    readonly sessionId: string;
}
/** Durable provenance for the first message of one autonomous run. */
export interface AutomationMessageSource {
    readonly kind: 'automation';
    readonly automationId: string;
    readonly runId: string;
    readonly scheduledFor: string;
}
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        automation: AutomationMessageSource;
    }
}
export interface AutomationDefinition {
    readonly version: 1;
    readonly id: string;
    readonly revision: number;
    readonly name: string;
    readonly prompt: string;
    readonly status: AutomationStatus;
    readonly schedule: AutomationSchedule;
    readonly rrule: string;
    readonly timeZone: string;
    readonly workspaceId: string;
    readonly cwd: string;
    readonly agentPreset: string;
    readonly provider: string | null;
    readonly model: string | null;
    readonly reasoningEffort: string | null;
    readonly permissionPreset: PermissionPreset;
    readonly createdBy: AutomationCreator;
    readonly createdAt: string;
    readonly updatedAt: string;
}
export interface AutomationTargetSnapshot {
    readonly workspaceId: string;
    readonly cwd: string;
    readonly agentPreset: string;
    readonly provider: string | null;
    readonly model: string | null;
    readonly reasoningEffort: string | null;
    readonly permissionPreset: PermissionPreset;
}
export interface AutomationRunError {
    readonly code: string;
    readonly message: string;
}
export interface AutomationRun {
    readonly version: 1;
    readonly id: string;
    readonly automationId: string;
    readonly definitionRevision: number;
    readonly occurrenceKey: string;
    readonly trigger: 'schedule' | 'manual';
    readonly scheduledFor: string;
    readonly status: AutomationRunStatus;
    readonly promptSnapshot: string;
    readonly targetSnapshot: AutomationTargetSnapshot;
    readonly sessionId: string | null;
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
    readonly summary: string | null;
    readonly error: AutomationRunError | null;
    readonly unread: boolean;
    /** Set when the user marked a problem run as reviewed; absent before that. */
    readonly reviewedAt?: string | null | undefined;
    /** Scheduled occurrence this manual "run ahead" run replaces once it succeeds. */
    readonly replacesScheduledFor?: string | null | undefined;
}
export interface CreateAutomationInput {
    readonly id: string;
    readonly name: string;
    readonly prompt: string;
    readonly schedule: AutomationSchedule;
    readonly workspaceId: string;
    readonly cwd: string;
    readonly agentPreset: string;
    readonly provider?: string | null;
    readonly model?: string | null;
    readonly reasoningEffort?: string | null;
    readonly permissionPreset?: PermissionPreset;
    readonly createdBy: AutomationCreator;
    readonly now: string;
}
export interface UpdateAutomationInput {
    readonly name?: string;
    readonly prompt?: string;
    readonly status?: AutomationStatus;
    readonly schedule?: AutomationSchedule;
    readonly agentPreset?: string;
    readonly provider?: string | null;
    readonly model?: string | null;
    readonly reasoningEffort?: string | null;
    readonly permissionPreset?: PermissionPreset;
    readonly now: string;
}
export interface DeleteAutomationPlan {
    readonly id: string;
    readonly preserveRunHistory: true;
}

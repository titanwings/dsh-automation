/** Durable automation authority: definitions, occurrence claims, clock, and run execution. */
import type { Context } from '@deepseek-ai/cordis';
import type { AutomationDefinition, AutomationRun, AutomationSchedule, PermissionPreset, UpdateAutomationInput } from './types.ts';
export declare const AUTOMATION_SESSION_PREFIX = "dsh-automation-session-";
export interface AutomationConfig {
    readonly maxConcurrentRuns: number;
    readonly runTimeoutMs: number;
    readonly misfireGraceMs: number;
    readonly historyLimit: number;
    readonly archiveRunSessions: boolean;
    /** Replay missed occurrences after a host resume instead of skipping stale ones. */
    readonly catchUpMissedRuns: boolean;
    /** Backlog cap per automation when catchUpMissedRuns is enabled (most recent occurrences win). */
    readonly catchUpMissedRunsMax: number;
}
/** Durable host-wide policy, layered over the cordis config defaults. */
export interface AutomationSettings {
    readonly catchUpMissedRuns: boolean;
    readonly catchUpMissedRunsMax: number;
    readonly misfireGraceMinutes: number;
}
/** Minimal shape of the `ctx.settings` namespace owner the service consumes. */
export interface AutomationSettingsOwner {
    get(): Readonly<AutomationSettings>;
    update(next: AutomationSettings): Promise<unknown>;
}
export interface CreateRequest {
    readonly name: string;
    readonly prompt: string;
    readonly schedule: AutomationSchedule;
    readonly provider?: string | null;
    readonly model?: string | null;
    readonly reasoningEffort?: string | null;
    readonly permissionPreset?: PermissionPreset;
}
export interface AutomationScope {
    readonly sessionId: string;
    readonly creatorKind: 'agent' | 'web';
}
export interface AutomationSnapshot {
    readonly generatedAt: string;
    readonly workspace: {
        readonly id: string;
        readonly title: string;
        readonly path: string;
    };
    readonly definitions: readonly AutomationDefinitionView[];
    readonly runs: readonly AutomationRunView[];
}
export interface AutomationDefinitionView extends AutomationDefinition {
    readonly nextRunAt: string | null;
    readonly lastRun: AutomationRun | null;
}
export interface AutomationRunView extends AutomationRun {
    readonly sessionArchived: boolean;
}
interface SessionEventLike {
    readonly type: string;
    readonly data: unknown;
}
/** One host-lifetime service. Timer state is disposable; domain records are authority. */
export declare class AutomationService {
    private readonly ctx;
    private readonly domain;
    private readonly config;
    private definitions;
    private runs;
    private timer;
    private operationTail;
    private pumpScheduled;
    private requested;
    private started;
    private stopping;
    private readonly active;
    private constructor();
    private settingsOwner;
    /**
     * Bind the durable `ctx.settings` namespace owner (registered by the plugin
     * entry) so runtime policy changes survive restarts. Without an owner the
     * cordis config values remain the effective policy, which keeps the service
     * usable in isolation (tests, missing settings provider).
     */
    attachSettings(owner: AutomationSettingsOwner): void;
    /** Effective host-wide policy: the settings namespace when attached, else config defaults. */
    settings(): Readonly<AutomationSettings>;
    /** Persist a new host-wide policy through the settings namespace. */
    updateSettings(scope: AutomationScope, next: AutomationSettings, signal?: AbortSignal): Promise<AutomationSettings>;
    static open(ctx: Context, config: AutomationConfig): Promise<AutomationService>;
    /** Start the disposable clock only after the surrounding Loader has settled. */
    start(): void;
    /**
     * Automation-created sessions must never receive management tools. The run
     * table covers live/new sessions; durable message provenance covers an old
     * session even after its bounded run record has been pruned.
     */
    ownsSession(sessionId: string, events?: readonly SessionEventLike[]): boolean;
    dispose(): Promise<void>;
    snapshot(scope: AutomationScope, signal?: AbortSignal): Promise<AutomationSnapshot>;
    create(scope: AutomationScope, request: CreateRequest, signal?: AbortSignal): Promise<AutomationDefinition>;
    update(scope: AutomationScope, id: string, input: Omit<UpdateAutomationInput, 'now'> & {
        readonly status?: 'active' | 'paused';
        readonly expectedRevision?: number;
    }, signal?: AbortSignal): Promise<AutomationDefinition>;
    delete(scope: AutomationScope, id: string, signal?: AbortSignal): Promise<{
        readonly id: string;
        readonly deleted: boolean;
    }>;
    runNow(scope: AutomationScope, id: string, options?: {
        readonly replaceNext?: boolean;
    }, signal?: AbortSignal): Promise<AutomationRun>;
    markRead(scope: AutomationScope, runId: string, signal?: AbortSignal): Promise<AutomationRun>;
    /** Archive the Session of one run so it leaves every conversation-list grouping surface. */
    archiveRun(scope: AutomationScope, runId: string, signal?: AbortSignal): Promise<AutomationRun>;
    /** Delete one durable run record while retaining its Session and any definition. */
    deleteRun(scope: AutomationScope, runId: string, signal?: AbortSignal): Promise<{
        readonly id: string;
        readonly deleted: boolean;
    }>;
    private resolveScope;
    private ownedDefinition;
    private requestPump;
    private pumpOnce;
    private claimLatestDue;
    /**
     * Catch-up admission: after a host resume, claim every scheduled occurrence
     * in (handledThrough, now] that has no run record yet, so nothing the host
     * missed while it was offline is skipped. Interval schedules stay on the
     * grace/skip path (backlog replay makes no sense for fixed-rate reminders).
     * The replay wait ("misfireGraceMinutes") also bounds how far back the
     * backlog reaches: only occurrences inside the wait window are replayed,
     * and the most recent `catchUpMissedRunsMax` of those win. Editing a
     * definition does not cancel its unhandled past occurrences.
     */
    private claimMissedRuns;
    /** A succeeded "run ahead" manual run counts as having handled its target occurrence. */
    private isReplacedByManualRun;
    private startQueuedRuns;
    private startRun;
    private executeRun;
    private armNextTimer;
    private armRetryTimer;
    private clearTimer;
    /** Serialize service-level mutations and scheduler admission around domain writes. */
    private serialize;
    private recoverInterruptedRuns;
    /**
     * Skipped/cancelled runs recorded before unread tracking never asked for
     * attention. Surface them once: records the user explicitly marked as
     * reviewed carry `reviewedAt`, so they stay dismissed across restarts.
     */
    private flagLegacyProblemRuns;
    /** Archive terminal run Sessions without changing their durable run result. */
    private archiveRunSession;
    /** Retry terminal Session archival on startup before bounded run pruning. */
    private archiveTerminalRunSessions;
    /** Keep every active record plus the configured newest terminal records per automation. */
    private pruneWorkspaceHistory;
    private pruneAllHistory;
}
export {};

/** Cordis Host plugin for durable standalone DSH automations. */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-automation";
export declare const inject: string[];
export interface Config {
    readonly maxConcurrentRuns?: number;
    readonly runTimeoutMinutes?: number;
    readonly misfireGraceMinutes?: number;
    readonly historyLimit?: number;
    readonly archiveRunSessions?: boolean;
    /** Replay every missed occurrence after a host resume instead of skipping stale ones. */
    readonly catchUpMissedRuns?: boolean;
    /** Backlog cap per automation when catchUpMissedRuns is enabled (most recent occurrences win). */
    readonly catchUpMissedRunsMax?: number;
}
export declare const Config: any;
export declare function needsHumanApproval(exec: {
    readonly name: string;
    readonly arguments?: unknown;
    readonly signal: AbortSignal;
}, isMountedAgent: boolean): boolean;
export declare function humanApprovalReason(toolName: string): string;
/** Mount one host-wide authority and agent-scoped management tools. */
export declare function apply(ctx: Context, rawConfig: Config): Promise<void>;
export type * from './types.ts';
export { automationDomainSpec } from './domain.ts';

import type { Translate } from './contracts.js';
import type { AutomationSchedule, AutomationSnapshot, AutomationViewModel, CreateAutomationInput, ModelCatalog, ModelReasoningEffort, UpdateAutomationInput } from './protocol.js';
export type ScheduleKind = 'once' | 'interval' | 'daily' | 'weekly';
export interface AutomationFormState {
    readonly name: string;
    readonly prompt: string;
    readonly scheduleKind: ScheduleKind;
    readonly onceAt: string;
    readonly everyMinutes: string;
    readonly intervalAnchor?: string;
    readonly time: string;
    readonly weekdays: readonly number[];
    readonly timeZone: string;
    readonly provider: string | null;
    readonly model: string | null;
    readonly reasoningEffort: string | null;
    readonly permission: CreateAutomationInput['permission'];
}
export type FormErrorKey = 'form.error.name' | 'form.error.prompt' | 'form.error.once' | 'form.error.interval' | 'form.error.weekdays' | 'form.error.model';
export declare class AutomationFormError extends Error {
    readonly key: FormErrorKey;
    constructor(key: FormErrorKey);
}
export declare function localDateTimeValue(date?: Date): string;
export declare function defaultFormState(now?: Date): AutomationFormState;
/** Build an editable draft from the complete durable definition, not its card preview. */
export declare function formStateFromAutomation(automation: AutomationViewModel): AutomationFormState;
export declare function buildCreateInput(form: AutomationFormState, now?: Date): CreateAutomationInput;
/** Return only changed fields so editing a completed one-shot does not resubmit its past schedule. */
export declare function buildUpdateInput(form: AutomationFormState, automation: AutomationViewModel, now?: Date): UpdateAutomationInput;
export interface ModelRouteChoice {
    readonly provider: string;
    readonly providerName: string;
    readonly model: string;
    readonly modelName: string;
    readonly description?: string;
    readonly unavailable: boolean;
}
/** Flatten successful groups and retain the current pinned route when it disappeared. */
export declare function modelRouteChoices(catalog: ModelCatalog, currentProvider: string | null, currentModel: string | null): readonly ModelRouteChoice[];
export interface ReasoningEffortChoice extends ModelReasoningEffort {
    readonly unavailable: boolean;
}
/** Use exact-model opaque effort ids and retain an unavailable current pin. */
export declare function reasoningEffortChoices(catalog: ModelCatalog, provider: string | null, model: string | null, currentEffort: string | null): readonly ReasoningEffortChoice[];
export interface OverviewStats {
    readonly total: number;
    readonly active: number;
    readonly attention: number;
    readonly nextRunAt?: string;
}
export declare function deriveOverview(snapshot: AutomationSnapshot): OverviewStats;
export declare function formatRelativeTime(iso: string, now: Date, t: Translate): string;
export declare function shortSessionId(sessionId: string): string;
export declare function formatSchedule(schedule: AutomationSchedule, t: Translate): string;
export type AutomationSortKey = 'created' | 'planned';
export type AutomationSortDirection = 'asc' | 'desc';
/** 工作区任务列表排序：计划时间 = nextRunAt，无计划的任务固定排最后。 */
export declare function sortAutomations(items: readonly AutomationViewModel[], key: AutomationSortKey, direction: AutomationSortDirection): AutomationViewModel[];
export interface SortPreferenceStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
export declare const WORKSPACE_SORT_DEFAULT_KEY = "dsh-automation.sort-default.workspace";
/** 读取已保存的默认排序；缺失、损坏或无存储时返回 undefined，由调用方用自身默认值。 */
export declare function readSortDefault(storage: SortPreferenceStorage | undefined, storageKey: string): {
    readonly key: AutomationSortKey;
    readonly direction: AutomationSortDirection;
} | undefined;
export declare function writeSortDefault(storage: SortPreferenceStorage, storageKey: string, key: AutomationSortKey, direction: AutomationSortDirection): void;

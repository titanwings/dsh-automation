import type { Translate } from './contracts.js';
import type { AutomationSchedule, AutomationSnapshot, AutomationViewModel, CreateAutomationInput, ModelCatalog, ModelReasoningEffort, UpdateAutomationInput } from './protocol.js';
export type ScheduleKind = 'once' | 'interval' | 'daily' | 'weekly';
export interface DayAutomationCounts {
    readonly active: number;
    readonly paused: number;
}
/** 读取本地草稿；缺失、损坏或非表单结构时返回 undefined。 */
export declare function readDraft(storage: SortPreferenceStorage | undefined, key: string): AutomationFormState | undefined;
export declare function writeDraft(storage: SortPreferenceStorage | undefined, key: string, form: AutomationFormState): void;
export declare function clearDraft(storage: SortPreferenceStorage | undefined, key: string): void;
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
/** Create a fresh form state; the schedule defaults to a single future run. */
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
export declare function startOfLocalDay(date: Date): Date;
/** 周一作为一周的开始，与 dsh-personal-workbench 的周视图一致。 */
export declare function startOfLocalWeek(date: Date): Date;
export declare function addLocalDays(date: Date, days: number): Date;
export declare function isSameLocalDay(left: Date, right: Date): boolean;
/** 统计 nextRunAt 落在某个本地日期的自动化任务数量。 */
export declare function countAutomationsOnDay(automations: readonly AutomationViewModel[], day: Date): number;
/** 统计 nextRunAt 落在某个本地日期的任务数，按启用/暂停状态分开。 */
export declare function countAutomationsByStatusOnDay(automations: readonly AutomationViewModel[], day: Date): DayAutomationCounts;
/** 客户端近似计算计划的下次运行时间：主机快照缺失 nextRunAt 时（旧主机或
 * 刚暂停的任务）用它兜底，保证暂停任务在排序和日历中的位置与启用任务一致。 */
export declare function plannedNextRun(schedule: AutomationSchedule, createdAt: string, now: Date): string | undefined;
/** 生成周视图的 7 个本地日期（周一起始）。 */
export declare function buildWeekCalendarDays(cursor: Date): readonly Date[];
/** 生成月视图的 6x7 日期网格，覆盖该月所在的所有周。 */
export declare function buildMonthCalendarGrid(cursor: Date): readonly Date[];
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
export declare function resolveSortPreferenceStorage(owner: {
    readonly localStorage: SortPreferenceStorage;
} | undefined): SortPreferenceStorage | undefined;
export declare const WORKSPACE_SORT_DEFAULT_KEY = "dsh-automation.sort-default.workspace";
/** 读取已保存的默认排序；缺失、损坏或无存储时返回 undefined，由调用方用自身默认值。 */
export declare function readSortDefault(storage: SortPreferenceStorage | undefined, storageKey: string): {
    readonly key: AutomationSortKey;
    readonly direction: AutomationSortDirection;
} | undefined;
export declare function writeSortDefault(storage: SortPreferenceStorage, storageKey: string, key: AutomationSortKey, direction: AutomationSortDirection): void;

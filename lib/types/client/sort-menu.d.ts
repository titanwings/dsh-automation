import type { Translate } from './contracts.js';
import { type AutomationSortDirection, type AutomationSortKey, type SortPreferenceStorage } from './helpers.js';
/** 工作区自动化列表的排序菜单；当前选中行可一键保存为默认排序。 */
export declare function SortMenu({ t, storage, storageKey, sortKey, sortDirection, onSelect, }: {
    readonly t: Translate;
    readonly storage?: SortPreferenceStorage;
    readonly storageKey: string;
    readonly sortKey: AutomationSortKey;
    readonly sortDirection: AutomationSortDirection;
    readonly onSelect: (key: AutomationSortKey, direction: AutomationSortDirection) => void;
}): JSX.Element;

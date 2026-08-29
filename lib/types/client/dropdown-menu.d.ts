export interface DropdownMenuOption {
    readonly key: string;
    readonly label: string;
    readonly selected: boolean;
    readonly onSelect: () => void;
    readonly keepOpen?: boolean;
    readonly trailing?: {
        readonly label: string;
        readonly active: boolean;
        readonly onSelect: () => void;
    };
}
/** 工作区自动化视图的紧凑下拉菜单：显示当前选中项，支持点击外部与 Escape 关闭。 */
export declare function DropdownMenu({ ariaLabel, className, menuClassName, options, }: {
    readonly ariaLabel: string;
    readonly className?: string;
    readonly menuClassName?: string;
    readonly options: readonly DropdownMenuOption[];
}): JSX.Element;

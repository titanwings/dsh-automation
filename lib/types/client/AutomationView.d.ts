import type { AutomationViewProps, Translate } from './contracts.js';
import type { AutomationRunViewModel } from './protocol.js';
export interface AutomationFloatBox {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}
export interface AutomationFloatViewport {
    readonly width: number;
    readonly height: number;
    readonly offsetLeft?: number;
    readonly offsetTop?: number;
}
export interface AutomationFloatAnchor {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
}
/** Keep the complete floating editor inside even a narrow visual viewport. */
export declare function clampAutomationFloatBox(value: AutomationFloatBox, viewport: AutomationFloatViewport): AutomationFloatBox;
export declare function initialAutomationFloatBox(anchor?: AutomationFloatAnchor, viewport?: AutomationFloatViewport, initialHeight?: number): AutomationFloatBox;
export declare function RecentRun({ run, now, t, busy, automationMissing, confirmingDelete, onOpen, onMarkRead, onReadd, onConfirmDelete, onDelete }: {
    run: AutomationRunViewModel;
    now: Date;
    t: Translate;
    busy: boolean;
    automationMissing: boolean;
    confirmingDelete: boolean;
    onOpen: (runId: string, sessionId: string) => void;
    onMarkRead: (runId: string) => void;
    onReadd: (run: AutomationRunViewModel, anchor?: DOMRect) => void;
    onConfirmDelete: (runId?: string) => void;
    onDelete: (runId: string) => void;
}): JSX.Element;
/** Native conversation view: all data and effects arrive through the slot's four shares. */
export declare function AutomationView({ t, useAutomationState, refresh, createAutomation, updateAutomation, mutateAutomation, runNow, markRunRead, deleteRun, updateSettings, loadModelCatalog, openSession, refreshSessions, }: AutomationViewProps): JSX.Element;

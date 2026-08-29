/** Homepage sidebar entry: a DOM-managed native control rendered below the
 * new-chat button. DSH exposes no official slot for that position, so the
 * installer follows the same placement strategy as dsh-personal-workbench and
 * keeps the existing behavior: activate the localized Automations tab when a
 * conversation tab ring exists, otherwise surface an explicit hint. */
import type { Translate } from './contracts.js';
export declare const ENTRY_ATTR = "data-dsh-automation-entry";
/** Install the entry and return its disposer. DOM state is disposable; the
 * Automations conversation view remains the authority for management UI. */
export declare function installAutomationSidebarEntry(t: Translate): () => void;

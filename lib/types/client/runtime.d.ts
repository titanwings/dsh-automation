import type { ClientRemote, ClientRpc } from './contracts.js';
import type { AutomationSnapshot, CreateAutomationInput, MutateRequest, RunNowMode, SettingsUpdateInput, UpdateAutomationInput, ModelCatalog } from './protocol.js';
export interface AutomationClientState {
    readonly phase: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
    readonly snapshot?: AutomationSnapshot;
    readonly error?: string;
    readonly refreshedAt?: number;
}
export interface AutomationStateSource {
    getSnapshot(): AutomationClientState;
    subscribe(listener: () => void): () => void;
}
export interface AutomationRuntime {
    readonly source: AutomationStateSource;
    refresh(): Promise<void>;
    createAutomation(input: CreateAutomationInput): Promise<void>;
    updateAutomation(automationId: string, expectedRevision: number, input: UpdateAutomationInput): Promise<void>;
    mutateAutomation(automationId: string, mutation: MutateRequest['mutation']): Promise<void>;
    runNow(automationId: string, mode: RunNowMode): Promise<void>;
    markRunRead(runId: string): Promise<void>;
    archiveRun(runId: string): Promise<void>;
    deleteRun(runId: string): Promise<void>;
    updateSettings(settings: SettingsUpdateInput): Promise<void>;
    openRunSession(runId: string, open: () => Promise<void>): Promise<void>;
}
/** Load the Host catalog through the Session remote service DSH 2.0.x ships. */
export declare function loadModelCatalog(remote: ClientRemote): Promise<ModelCatalog>;
/** One session-scoped observable; the framework binds it into useAutomationState. */
export declare function createAutomationRuntime(rpc: ClientRpc, sessionId: string): AutomationRuntime;

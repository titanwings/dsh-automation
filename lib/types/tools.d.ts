/** Agent-scoped management tools over the host-wide AutomationService. */
import type { AutomationService } from './service.ts';
interface ToolAgent {
    readonly id: string;
    readonly ctx: {
        readonly tools: {
            register(definition: unknown): () => void;
        };
    };
}
/**
 * Install the management tools for one root Agent.
 *
 * The Host may resolve `agent.ctx.tools.register` into one shared layer for
 * every Agent (observed with dsh-tools: a second registration of the same
 * name fails the whole session creation with "already registered"). The
 * registration is therefore duplicate-tolerant, and each execution derives
 * its ownership scope from the executing Agent instead of the Agent that
 * happened to register first, so every live Agent keeps working tools.
 */
export declare function registerAutomationTools(service: AutomationService, agent: ToolAgent): () => void;
export {};

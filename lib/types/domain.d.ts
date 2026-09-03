import { z } from 'zod';
import type { AutomationDefinition, AutomationRun, AutomationSchedule, CreateAutomationInput, DeleteAutomationPlan, UpdateAutomationInput } from './types.ts';
export declare const automationScheduleSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"once">;
    at: z.ZodString;
    timeZone: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"interval">;
    everyMinutes: z.ZodNumber;
    anchor: z.ZodString;
    timeZone: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"daily">;
    time: z.ZodString;
    timeZone: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"weekly">;
    weekdays: z.ZodArray<z.ZodEnum<{
        MO: "MO";
        TU: "TU";
        WE: "WE";
        TH: "TH";
        FR: "FR";
        SA: "SA";
        SU: "SU";
    }>>;
    time: z.ZodString;
    timeZone: z.ZodString;
}, z.core.$strip>], "kind">;
export declare const automationDefinitionSchema: z.ZodType<AutomationDefinition>;
export declare const automationRunSchema: z.ZodType<AutomationRun>;
export declare const automationDomainSpec: {
    readonly name: "dsh_automation";
    readonly version: 1;
    readonly tables: {
        readonly definitions: {
            readonly valueSchema: z.ZodType<AutomationDefinition, unknown, z.core.$ZodTypeInternals<AutomationDefinition, unknown>>;
        };
        readonly runs: {
            readonly valueSchema: z.ZodType<AutomationRun, unknown, z.core.$ZodTypeInternals<AutomationRun, unknown>>;
        };
    };
};
export declare function createDefinition(input: CreateAutomationInput): AutomationDefinition;
export declare function updateDefinition(current: AutomationDefinition, input: UpdateAutomationInput): AutomationDefinition;
export declare function pauseDefinition(current: AutomationDefinition, now: string): AutomationDefinition;
export declare function resumeDefinition(current: AutomationDefinition, now: string): AutomationDefinition;
export declare function deleteDefinition(current: AutomationDefinition): DeleteAutomationPlan;
export declare function occurrenceKey(automationId: string, definitionRevision: number, scheduledFor: string): string;
export declare function runIdForOccurrence(key: string): string;
export declare function createScheduledRun(definition: AutomationDefinition, scheduledFor: string): AutomationRun;
export declare function createManualRun(definition: AutomationDefinition, scheduledFor: string, nonce?: string, replacesScheduledFor?: string | null): AutomationRun;
export type { AutomationSchedule };

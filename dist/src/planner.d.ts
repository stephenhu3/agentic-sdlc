import type { AgentSessionRunner, PlanDocument, WorkflowState } from "./contracts.js";
import { SdlcStore } from "./persistence.js";
export interface PlannerResult {
    artifactId: string;
    status: "awaiting_approval";
    plan: PlanDocument;
    state: WorkflowState;
}
export declare class Planner {
    private readonly runner;
    private readonly store;
    private readonly now;
    constructor(runner: AgentSessionRunner, store: SdlcStore, now?: () => Date);
    createPlan(requirement: string): Promise<PlannerResult>;
    approvePlan(): Promise<WorkflowState>;
}

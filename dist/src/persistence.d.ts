import type { ArtifactMetadata, PlanDocument, WorkflowState } from "./contracts.js";
export declare class SdlcStore {
    private readonly rootDirectory;
    constructor(rootDirectory: string);
    writePlan(plan: PlanDocument): Promise<ArtifactMetadata>;
    writeWorkflowState(state: WorkflowState): Promise<void>;
    readWorkflowState(): Promise<WorkflowState | undefined>;
}
export declare function serializePlan(plan: PlanDocument): string;
export declare function parsePlan(content: string): PlanDocument;

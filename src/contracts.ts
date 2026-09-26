/**
 * Shared domain contracts for the SDLC workflow.
 * These interfaces describe the plan document, persisted artifact metadata, and state transitions
 * used by the planner and store layers.
 */
export type WorkflowStatus = "awaiting_approval" | "approved";

export interface PlanFrontMatter {
  artifactId: string;
  requirement: string;
  createdAt: string;
  contentHash: string;
}

export interface PlanDocument {
  frontMatter: PlanFrontMatter;
  body: string;
}

export interface ArtifactMetadata extends PlanFrontMatter {
  kind: "plan";
  path: string;
}

export interface WorkflowState {
  workflowId: string;
  status: WorkflowStatus;
  artifactId: string;
  updatedAt: string;
}

export interface AgentSessionRunner {
  run(prompt: string, workingDirectory: string): Promise<string>;
}

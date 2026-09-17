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

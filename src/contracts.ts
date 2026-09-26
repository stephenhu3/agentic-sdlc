/**
 * Shared domain contracts for the SDLC workflow.
 * The workflow persists immutable artifacts for each role and uses deterministic state transitions
 * to move work through planning, implementation, QA, validation, human review, and documentation.
 */
export type WorkflowStage =
  | "awaiting_initial_plan_approval"
  | "implementing"
  | "qa"
  | "validation"
  | "awaiting_validation_decision"
  | "awaiting_plan_revision_approval"
  | "documenting"
  | "awaiting_next_prompt"
  | "blocked"
  | "failed";

export type ArtifactKind =
  | "plan"
  | "implementation"
  | "qa-report"
  | "validation-report"
  | "human-decision"
  | "iteration-report";

export type ProducerRole = "planner" | "implementer" | "qa" | "validator" | "documenter" | "human";

export type ArtifactStatus =
  | "pending_approval"
  | "approved"
  | "candidate"
  | "generated"
  | "passed"
  | "failed"
  | "blocked";

export type QaOutcome = "passed" | "failed";
export type ValidationOutcome = "passed" | "failed" | "blocked";
export type ValidationDecisionRoute = "accept_and_document" | "fix_implementation" | "reconcile_plan";
export type DefectSeverity = "low" | "medium" | "high";

export interface ArtifactReference {
  artifactId: string;
  kind: ArtifactKind;
  contentHash: string;
  path: string;
}

export interface ArtifactEnvelope<T> extends ArtifactReference {
  workflowId: string;
  iteration: number;
  producer: ProducerRole;
  createdAt: string;
  status: ArtifactStatus;
  inputs: ArtifactReference[];
  data: T;
}

export interface PromptRecord {
  sequence: number;
  content: string;
  createdAt: string;
}

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

export interface PlanRevision {
  revisionId: string;
  requirement: string;
  summary: string;
  body: string;
  promptHistory: PromptRecord[];
  acceptanceCriteria: string[];
  implementationTasks: string[];
  risks: string[];
  openDesignDecisions: string[];
}

export interface ChangedFile {
  path: string;
  summary: string;
}

export interface CommandEvidence {
  command: string;
  outcome: "passed" | "failed";
  output: string;
}

export interface ImplementationSnapshot {
  snapshotId: string;
  planRevisionId: string;
  promptSequence: number;
  summary: string;
  changedFiles: ChangedFile[];
  tests: CommandEvidence[];
  deviations: string[];
  blockers: string[];
  recommendations: string[];
}

export interface DefectRecord {
  title: string;
  severity: DefectSeverity;
  details: string;
}

export interface QaReport {
  reportId: string;
  planRevisionId: string;
  snapshotId: string;
  snapshotHash: string;
  summary: string;
  outcome: QaOutcome;
  testResults: CommandEvidence[];
  defects: DefectRecord[];
  recommendations: string[];
}

export interface ValidationFinding {
  criterion: string;
  status: ValidationOutcome;
  evidence: string[];
  details: string;
}

export interface ValidationReport {
  reportId: string;
  planRevisionId: string;
  planRevisionHash: string;
  snapshotId: string;
  snapshotHash: string;
  summary: string;
  findings: ValidationFinding[];
  unknowns: string[];
  risks: string[];
  recommendations: string[];
  openDesignDecisions: string[];
}

export interface HumanDecision {
  decisionId: string;
  route: ValidationDecisionRoute;
  validationArtifactId: string;
  validationHash: string;
  planRevisionId: string;
  planRevisionHash: string;
  snapshotId: string;
  snapshotHash: string;
  rationale: string;
  acceptedDeviations: string[];
  createdAt: string;
}

export interface IterationReport {
  reportId: string;
  prompt: PromptRecord;
  planRevisionId: string;
  implementationSummary: string;
  qaSummary: string;
  validationSummary: string;
  humanDecision: HumanDecision;
  openDesignDecisions: string[];
  remainingRisks: string[];
  sourceArtifacts: ArtifactReference[];
}

export interface WorkflowState {
  workflowId: string;
  stage: WorkflowStage;
  iteration: number;
  version: number;
  activePlanRevision?: ArtifactReference;
  pendingPlanRevision?: ArtifactReference;
  currentImplementation?: ArtifactReference;
  latestQaReport?: ArtifactReference;
  latestValidationReport?: ArtifactReference;
  latestHumanDecision?: ArtifactReference;
  lastPromptSequence: number;
  updatedAt: string;
}

export interface AgentSessionRunner {
  run(prompt: string, workingDirectory: string): Promise<string>;
}

export interface ImplementationSessionRunner {
  run(prompt: string, workingDirectory: string): Promise<string>;
}

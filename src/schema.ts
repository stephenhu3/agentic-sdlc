/**
 * Validates persisted workflow payloads with Zod.
 * Schemas are shared by the coordinator, planner, and persistence layers so every artifact
 * can be validated before it is written or consumed.
 */
import { z } from "zod";
import type {
  ArtifactEnvelope,
  ArtifactReference,
  ChangedFile,
  CommandEvidence,
  DefectRecord,
  HumanDecision,
  ImplementationSnapshot,
  IterationReport,
  PlanDocument,
  PlanRevision,
  PromptRecord,
  QaReport,
  ValidationFinding,
  ValidationReport,
  WorkflowState,
} from "./contracts.js";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const artifactKindSchema = z.enum([
  "plan",
  "implementation",
  "qa-report",
  "validation-report",
  "human-decision",
  "iteration-report",
]);

export const producerRoleSchema = z.enum(["planner", "implementer", "qa", "validator", "documenter", "human"]);

export const artifactStatusSchema = z.enum([
  "pending_approval",
  "approved",
  "candidate",
  "generated",
  "passed",
  "failed",
  "blocked",
]);

export const artifactReferenceSchema: z.ZodType<ArtifactReference> = z.object({
  artifactId: z.string().uuid(),
  kind: artifactKindSchema,
  contentHash: hashSchema,
  path: z.string().min(1),
});

export const promptRecordSchema: z.ZodType<PromptRecord> = z.object({
  sequence: z.number().int().positive(),
  content: z.string().min(1),
  createdAt: z.string().datetime(),
});

export const planFrontMatterSchema = z.object({
  artifactId: z.string().uuid(),
  requirement: z.string().min(1),
  createdAt: z.string().datetime(),
  contentHash: hashSchema,
});

export const planDocumentSchema: z.ZodType<PlanDocument> = z.object({
  frontMatter: planFrontMatterSchema,
  body: z.string().min(1),
});

export const planRevisionSchema: z.ZodType<PlanRevision> = z.object({
  revisionId: z.string().uuid(),
  requirement: z.string().min(1),
  summary: z.string().min(1),
  body: z.string().min(1),
  promptHistory: z.array(promptRecordSchema),
  acceptanceCriteria: z.array(z.string().min(1)),
  implementationTasks: z.array(z.string().min(1)),
  risks: z.array(z.string().min(1)),
  openDesignDecisions: z.array(z.string().min(1)),
});

export const changedFileSchema: z.ZodType<ChangedFile> = z.object({
  path: z.string().min(1),
  summary: z.string().min(1),
});

export const commandEvidenceSchema: z.ZodType<CommandEvidence> = z.object({
  command: z.string().min(1),
  outcome: z.enum(["passed", "failed"]),
  output: z.string(),
});

export const implementationSnapshotSchema: z.ZodType<ImplementationSnapshot> = z.object({
  snapshotId: z.string().uuid(),
  planRevisionId: z.string().uuid(),
  promptSequence: z.number().int().positive(),
  summary: z.string().min(1),
  changedFiles: z.array(changedFileSchema),
  tests: z.array(commandEvidenceSchema),
  deviations: z.array(z.string().min(1)),
  blockers: z.array(z.string().min(1)),
  recommendations: z.array(z.string().min(1)),
});

export const defectRecordSchema: z.ZodType<DefectRecord> = z.object({
  title: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  details: z.string().min(1),
});

export const qaReportSchema: z.ZodType<QaReport> = z.object({
  reportId: z.string().uuid(),
  planRevisionId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  snapshotHash: hashSchema,
  summary: z.string().min(1),
  outcome: z.enum(["passed", "failed"]),
  testResults: z.array(commandEvidenceSchema),
  defects: z.array(defectRecordSchema),
  recommendations: z.array(z.string().min(1)),
});

export const validationFindingSchema: z.ZodType<ValidationFinding> = z.object({
  criterion: z.string().min(1),
  status: z.enum(["passed", "failed", "blocked"]),
  evidence: z.array(z.string().min(1)),
  details: z.string().min(1),
});

export const validationReportSchema: z.ZodType<ValidationReport> = z.object({
  reportId: z.string().uuid(),
  planRevisionId: z.string().uuid(),
  planRevisionHash: hashSchema,
  snapshotId: z.string().uuid(),
  snapshotHash: hashSchema,
  summary: z.string().min(1),
  findings: z.array(validationFindingSchema),
  unknowns: z.array(z.string().min(1)),
  risks: z.array(z.string().min(1)),
  recommendations: z.array(z.string().min(1)),
  openDesignDecisions: z.array(z.string().min(1)),
});

export const humanDecisionSchema: z.ZodType<HumanDecision> = z.object({
  decisionId: z.string().uuid(),
  route: z.enum(["accept_and_document", "fix_implementation", "reconcile_plan"]),
  validationArtifactId: z.string().uuid(),
  validationHash: hashSchema,
  planRevisionId: z.string().uuid(),
  planRevisionHash: hashSchema,
  snapshotId: z.string().uuid(),
  snapshotHash: hashSchema,
  rationale: z.string().min(1),
  acceptedDeviations: z.array(z.string().min(1)),
  createdAt: z.string().datetime(),
});

export const iterationReportSchema: z.ZodType<IterationReport> = z.object({
  reportId: z.string().uuid(),
  prompt: promptRecordSchema,
  planRevisionId: z.string().uuid(),
  implementationSummary: z.string().min(1),
  qaSummary: z.string().min(1),
  validationSummary: z.string().min(1),
  humanDecision: humanDecisionSchema,
  openDesignDecisions: z.array(z.string().min(1)),
  remainingRisks: z.array(z.string().min(1)),
  sourceArtifacts: z.array(artifactReferenceSchema),
});

export function artifactEnvelopeSchema<T extends z.ZodTypeAny>(
  dataSchema: T,
): z.ZodType<ArtifactEnvelope<z.infer<T>>> {
  return z.object({
    artifactId: z.string().uuid(),
    kind: artifactKindSchema,
    contentHash: hashSchema,
    path: z.string().min(1),
    workflowId: z.string().uuid(),
    iteration: z.number().int().positive(),
    producer: producerRoleSchema,
    createdAt: z.string().datetime(),
    status: artifactStatusSchema,
    inputs: z.array(artifactReferenceSchema),
    data: dataSchema,
  }) as unknown as z.ZodType<ArtifactEnvelope<z.infer<T>>>;
}

export const workflowStateSchema: z.ZodType<WorkflowState> = z.object({
  workflowId: z.string().uuid(),
  stage: z.enum([
    "awaiting_initial_plan_approval",
    "implementing",
    "qa",
    "validation",
    "awaiting_validation_decision",
    "awaiting_plan_revision_approval",
    "documenting",
    "awaiting_next_prompt",
    "blocked",
    "failed",
  ]),
  iteration: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  activePlanRevision: artifactReferenceSchema.optional(),
  pendingPlanRevision: artifactReferenceSchema.optional(),
  currentImplementation: artifactReferenceSchema.optional(),
  latestQaReport: artifactReferenceSchema.optional(),
  latestValidationReport: artifactReferenceSchema.optional(),
  latestHumanDecision: artifactReferenceSchema.optional(),
  lastPromptSequence: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});

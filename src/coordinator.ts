import { randomUUID } from "node:crypto";
import type {
  ArtifactEnvelope,
  ArtifactReference,
  HumanDecision,
  IterationReport,
  PlanRevision,
  PromptRecord,
  ValidationDecisionRoute,
  WorkflowState,
} from "./contracts.js";
import { Documenter, type PrepareIterationReportInput } from "./documenter.js";
import { Implementer, type PrepareImplementationInput } from "./implementer.js";
import { toReference, SdlcStore } from "./persistence.js";
import { Planner, type ApprovalBinding } from "./planner.js";
import { QAAgent, type PrepareQaReportInput } from "./qa.js";
import { Validator, type PrepareValidationReportInput } from "./validator.js";

export class WorkflowCoordinator {
  public constructor(
    private readonly store: SdlcStore,
    private readonly planner: Planner,
    private readonly implementer: Implementer = new Implementer(),
    private readonly qa: QAAgent = new QAAgent(),
    private readonly validator: Validator = new Validator(),
    private readonly documenter: Documenter = new Documenter(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  private artifactReference(artifact: ArtifactEnvelope<unknown>): ArtifactReference {
    return toReference(artifact);
  }

  private assertMatchesReference(reference: ArtifactReference, artifact: ArtifactEnvelope<unknown>, label: string): void {
    if (reference.artifactId !== artifact.artifactId || reference.contentHash !== artifact.contentHash) {
      throw new Error(`${label} is stale for the current workflow state`);
    }
  }

  private nextState(state: WorkflowState, updates: Partial<WorkflowState>): WorkflowState {
    return {
      ...state,
      ...updates,
      version: state.version + 1,
      updatedAt: this.now().toISOString(),
    };
  }

  public async startInitialPlan(requirement: string) {
    return this.planner.createPlan(requirement);
  }

  public async approveCurrentPlan(expected: ApprovalBinding): Promise<WorkflowState> {
    return this.planner.approvePlan(expected);
  }

  public async appendHumanPrompt(content: string): Promise<PromptRecord> {
    const state = await this.store.readWorkflowState();
    if (!state) throw new Error("Workflow state not found");
    const prompt: PromptRecord = {
      sequence: state.lastPromptSequence + 1,
      content: content.trim(),
      createdAt: this.now().toISOString(),
    };
    await this.store.appendPrompt(prompt);
    let activePlan = state.activePlanRevision;
    if (activePlan) {
      await this.store.projectCurrentPlan(await this.store.readPlanRevision(activePlan.artifactId), await this.store.listPrompts());
    }
    const nextState = this.nextState(state, { lastPromptSequence: prompt.sequence });
    await this.store.writeWorkflowState(nextState, state.version);
    await this.store.appendEvent({
      createdAt: prompt.createdAt,
      workflowId: nextState.workflowId,
      stage: nextState.stage,
      type: "prompt.appended",
      sequence: prompt.sequence,
    });
    return prompt;
  }

  public async recordImplementation(input: PrepareImplementationInput) {
    const state = await this.store.readWorkflowState();
    if (!state?.activePlanRevision) throw new Error("No approved plan revision is active");
    if (state.stage !== "implementing") throw new Error("Workflow is not ready for implementation");
    if (state.lastPromptSequence < 1) throw new Error("No human implementation prompt has been recorded");
    const snapshot = this.implementer.createSnapshot(state.activePlanRevision.artifactId, state.lastPromptSequence, input);
    const artifact = await this.store.writeImplementationSnapshot({
      workflowId: state.workflowId,
      iteration: state.iteration,
      createdAt: this.now().toISOString(),
      inputs: [state.activePlanRevision],
      data: snapshot,
    });
    const nextState = this.nextState(state, {
      stage: "qa",
      currentImplementation: this.artifactReference(artifact),
      latestQaReport: undefined,
      latestValidationReport: undefined,
      latestHumanDecision: undefined,
    });
    await this.store.writeWorkflowState(nextState, state.version);
    await this.store.appendEvent({
      createdAt: nextState.updatedAt,
      workflowId: nextState.workflowId,
      stage: nextState.stage,
      type: "implementation.recorded",
      artifactId: artifact.artifactId,
      artifactHash: artifact.contentHash,
    });
    return { snapshot: artifact, state: nextState };
  }

  public async recordQaReport(input: PrepareQaReportInput) {
    const state = await this.store.readWorkflowState();
    if (!state?.activePlanRevision || !state.currentImplementation) throw new Error("No implementation snapshot is available for QA");
    if (state.stage !== "qa") throw new Error("Workflow is not waiting for QA");
    const qaReport = this.qa.createReport(
      state.activePlanRevision.artifactId,
      state.currentImplementation.artifactId,
      state.currentImplementation.contentHash,
      input,
    );
    const artifact = await this.store.writeQaReport({
      workflowId: state.workflowId,
      iteration: state.iteration,
      createdAt: this.now().toISOString(),
      inputs: [state.activePlanRevision, state.currentImplementation],
      data: qaReport,
    });
    const nextState = this.nextState(state, {
      stage: qaReport.outcome === "passed" ? "validation" : "implementing",
      latestQaReport: this.artifactReference(artifact),
      latestValidationReport: undefined,
      latestHumanDecision: undefined,
    });
    await this.store.writeWorkflowState(nextState, state.version);
    await this.store.appendEvent({
      createdAt: nextState.updatedAt,
      workflowId: nextState.workflowId,
      stage: nextState.stage,
      type: "qa.recorded",
      artifactId: artifact.artifactId,
      artifactHash: artifact.contentHash,
      outcome: qaReport.outcome,
    });
    return { report: artifact, state: nextState };
  }

  public async recordValidationReport(input: PrepareValidationReportInput) {
    const state = await this.store.readWorkflowState();
    if (!state?.activePlanRevision || !state.currentImplementation || !state.latestQaReport) {
      throw new Error("Validation requires an approved plan, implementation snapshot, and QA report");
    }
    if (state.stage !== "validation") throw new Error("Workflow is not waiting for validation");
    const qaArtifact = await this.store.readQaReport(state.iteration);
    if (qaArtifact.data.outcome !== "passed") throw new Error("Validator cannot run before QA passes on the latest snapshot");
    if (
      qaArtifact.data.snapshotId !== state.currentImplementation.artifactId ||
      qaArtifact.data.snapshotHash !== state.currentImplementation.contentHash
    ) {
      throw new Error("QA evidence is stale for the latest implementation snapshot");
    }
    const report = this.validator.createReport(
      state.activePlanRevision.artifactId,
      state.activePlanRevision.contentHash,
      state.currentImplementation.artifactId,
      state.currentImplementation.contentHash,
      input,
    );
    const artifact = await this.store.writeValidationReport({
      workflowId: state.workflowId,
      iteration: state.iteration,
      createdAt: this.now().toISOString(),
      inputs: [state.activePlanRevision, state.currentImplementation, state.latestQaReport],
      data: report,
    });
    const nextState = this.nextState(state, {
      stage: "awaiting_validation_decision",
      latestValidationReport: this.artifactReference(artifact),
      latestHumanDecision: undefined,
    });
    await this.store.writeWorkflowState(nextState, state.version);
    await this.store.appendEvent({
      createdAt: nextState.updatedAt,
      workflowId: nextState.workflowId,
      stage: nextState.stage,
      type: "validation.recorded",
      artifactId: artifact.artifactId,
      artifactHash: artifact.contentHash,
    });
    return { report: artifact, state: nextState };
  }

  public async recordHumanDecision(input: {
    route: ValidationDecisionRoute;
    rationale: string;
    acceptedDeviations?: string[];
    expectedValidation: ApprovalBinding;
    expectedPlan: ApprovalBinding;
    expectedImplementation: ApprovalBinding;
  }) {
    const state = await this.store.readWorkflowState();
    if (!state?.activePlanRevision || !state.currentImplementation || !state.latestValidationReport) {
      throw new Error("Validation decision requires an approved plan, implementation, and validation report");
    }
    if (state.stage !== "awaiting_validation_decision") {
      throw new Error("Workflow is not waiting for a validation decision");
    }
    if (
      input.expectedValidation.artifactId !== state.latestValidationReport.artifactId ||
      input.expectedValidation.contentHash !== state.latestValidationReport.contentHash
    ) {
      throw new Error("Validation decision does not match the latest validation report");
    }
    if (
      input.expectedPlan.artifactId !== state.activePlanRevision.artifactId ||
      input.expectedPlan.contentHash !== state.activePlanRevision.contentHash
    ) {
      throw new Error("Validation decision does not match the active plan revision");
    }
    if (
      input.expectedImplementation.artifactId !== state.currentImplementation.artifactId ||
      input.expectedImplementation.contentHash !== state.currentImplementation.contentHash
    ) {
      throw new Error("Validation decision does not match the latest implementation snapshot");
    }
    const decision: HumanDecision = {
      decisionId: randomUUID(),
      route: input.route,
      validationArtifactId: state.latestValidationReport.artifactId,
      validationHash: state.latestValidationReport.contentHash,
      planRevisionId: state.activePlanRevision.artifactId,
      planRevisionHash: state.activePlanRevision.contentHash,
      snapshotId: state.currentImplementation.artifactId,
      snapshotHash: state.currentImplementation.contentHash,
      rationale: input.rationale.trim(),
      acceptedDeviations: (input.acceptedDeviations ?? []).map((value) => value.trim()).filter(Boolean),
      createdAt: this.now().toISOString(),
    };
    const artifact = await this.store.writeHumanDecision({
      workflowId: state.workflowId,
      iteration: state.iteration,
      inputs: [state.activePlanRevision, state.currentImplementation, state.latestValidationReport],
      data: decision,
    });
    const nextStage =
      input.route === "accept_and_document"
        ? "documenting"
        : input.route === "fix_implementation"
          ? "implementing"
          : "awaiting_plan_revision_approval";
    const nextState = this.nextState(state, {
      stage: nextStage,
      latestHumanDecision: this.artifactReference(artifact),
    });
    await this.store.writeWorkflowState(nextState, state.version);
    await this.store.appendEvent({
      createdAt: nextState.updatedAt,
      workflowId: nextState.workflowId,
      stage: nextState.stage,
      type: "decision.recorded",
      artifactId: artifact.artifactId,
      artifactHash: artifact.contentHash,
      route: input.route,
    });
    return { decision: artifact, state: nextState };
  }

  public async preparePlanRevisionCandidate(requirement: string) {
    return this.planner.preparePlanRevisionCandidate(requirement);
  }

  public async approvePlanRevisionCandidate(expected: ApprovalBinding) {
    return this.planner.approvePlan(expected);
  }

  public async rejectPlanRevisionCandidate(expected: ApprovalBinding) {
    return this.planner.rejectPlanRevisionCandidate(expected);
  }

  public async documentIteration(
    input: Omit<PrepareIterationReportInput, "prompt" | "planRevisionId" | "implementationSummary" | "qaSummary" | "validationSummary" | "humanDecision" | "sourceArtifacts"> & {
      openDesignDecisions?: string[];
      remainingRisks?: string[];
    } = {},
  ) {
    const state = await this.store.readWorkflowState();
    if (!state?.activePlanRevision || !state.currentImplementation || !state.latestQaReport || !state.latestValidationReport || !state.latestHumanDecision) {
      throw new Error("Iteration reporting requires complete implementation, QA, validation, and decision artifacts");
    }
    if (state.stage !== "documenting") throw new Error("Workflow is not ready to document the iteration");
    const prompts = await this.store.listPrompts();
    const implementation = await this.store.readImplementationSnapshot(state.iteration);
    const qa = await this.store.readQaReport(state.iteration);
    const validation = await this.store.readValidationReport(state.iteration);
    const decision = await this.store.readHumanDecision(state.iteration);
    this.assertMatchesReference(state.currentImplementation, implementation, "Implementation snapshot");
    this.assertMatchesReference(state.latestQaReport, qa, "QA report");
    this.assertMatchesReference(state.latestValidationReport, validation, "Validation report");
    this.assertMatchesReference(state.latestHumanDecision, decision, "Human decision");
    const prompt = prompts.find((entry) => entry.sequence === implementation.data.promptSequence);
    if (!prompt) throw new Error("Implementation snapshot references a prompt that is no longer available");
    const report = this.documenter.createReport({
      prompt,
      planRevisionId: state.activePlanRevision.artifactId,
      implementationSummary: implementation.data.summary,
      qaSummary: qa.data.summary,
      validationSummary: validation.data.summary,
      humanDecision: decision.data,
      openDesignDecisions: input.openDesignDecisions ?? validation.data.openDesignDecisions,
      remainingRisks: input.remainingRisks ?? validation.data.risks,
      sourceArtifacts: [
        state.activePlanRevision,
        state.currentImplementation,
        state.latestQaReport,
        state.latestValidationReport,
        state.latestHumanDecision,
      ],
    });
    const artifact = await this.store.writeIterationReport({
      workflowId: state.workflowId,
      iteration: state.iteration,
      createdAt: this.now().toISOString(),
      inputs: [
        state.activePlanRevision,
        state.currentImplementation,
        state.latestQaReport,
        state.latestValidationReport,
        state.latestHumanDecision,
      ],
      data: report,
    });
    const nextState = this.nextState(state, {
      stage: "awaiting_next_prompt",
      iteration: state.iteration + 1,
      currentImplementation: undefined,
      latestQaReport: undefined,
      latestValidationReport: undefined,
      latestHumanDecision: undefined,
      pendingPlanRevision: undefined,
    });
    await this.store.writeWorkflowState(nextState, state.version);
    await this.store.appendEvent({
      createdAt: nextState.updatedAt,
      workflowId: nextState.workflowId,
      stage: nextState.stage,
      type: "iteration.documented",
      artifactId: artifact.artifactId,
      artifactHash: artifact.contentHash,
    });
    return { report: artifact, state: nextState };
  }
}

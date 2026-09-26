/**
 * Coordinates plan generation and approval.
 * The planner requests a markdown artifact from the agent, canonicalizes it into a structured
 * plan revision, and persists immutable revisions whose approval is bound to exact hashes.
 */
import { randomUUID } from "node:crypto";
import type { AgentSessionRunner, ArtifactEnvelope, PlanRevision, PromptRecord, WorkflowState } from "./contracts.js";
import { parsePlan, SdlcStore } from "./persistence.js";
import { sha256 } from "./hash.js";

export interface PlannerResult {
  artifactId: string;
  status: "awaiting_initial_plan_approval";
  plan: ArtifactEnvelope<PlanRevision>;
  state: WorkflowState;
}

export interface ApprovalBinding {
  artifactId: string;
  contentHash: string;
}

function extractListItems(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^([-*]|\d+\.)\s+/.test(line))
    .map((line) => line.replace(/^([-*]|\d+\.)\s+/, "").trim())
    .filter(Boolean);
}

function extractSectionList(body: string, heading: string): string[] {
  const lines = body.split("\n");
  const normalizedHeading = heading.toLowerCase();
  const values: string[] = [];
  let capturing = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^#{1,6}\s+/.test(line)) {
      const currentHeading = line.replace(/^#{1,6}\s+/, "").trim().toLowerCase();
      capturing = currentHeading === normalizedHeading;
      continue;
    }
    if (!capturing) continue;
    if (/^([-*]|\d+\.)\s+/.test(line)) {
      values.push(line.replace(/^([-*]|\d+\.)\s+/, "").trim());
      continue;
    }
    if (line.length > 0) break;
  }
  return values;
}

function firstHeadingOrSentence(body: string): string {
  const line = body
    .split("\n")
    .map((item) => item.trim())
    .find(Boolean);
  return (line ?? "Plan revision").replace(/^#+\s*/, "");
}

export class Planner {
  public constructor(
    private readonly runner: AgentSessionRunner,
    private readonly store: SdlcStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async generatePlanRevision(input: {
    workflowId: string;
    iteration: number;
    requirement: string;
    promptHistory: PromptRecord[];
    status: "pending_approval" | "candidate";
    writeCurrentView: boolean;
    inputArtifacts?: ArtifactEnvelope<unknown>[];
  }): Promise<ArtifactEnvelope<PlanRevision>> {
    const normalizedRequirement = input.requirement.trim();
    if (!normalizedRequirement) throw new Error("Requirement must not be empty");
    const artifactId = randomUUID();
    const createdAt = this.now().toISOString();
    const generated = await this.runner.run(
      [
        "Create an implementation plan for the following human requirement.",
        "Return Markdown with exactly this JSON-valued front matter shape:",
        `artifactId: ${JSON.stringify(artifactId)}`,
        `requirement: ${JSON.stringify(normalizedRequirement)}`,
        `createdAt: ${JSON.stringify(createdAt)}`,
        "Then include a concise actionable plan body.",
      ].join("\n"),
      process.cwd(),
    );
    const parsed = parsePlan(generated);
    if (parsed.frontMatter.artifactId !== artifactId || parsed.frontMatter.requirement !== normalizedRequirement) {
      throw new Error("Planner response front matter does not match the requested requirement");
    }
    const body = parsed.body.trim();
    const planRevision: PlanRevision = {
      revisionId: artifactId,
      requirement: normalizedRequirement,
      summary: firstHeadingOrSentence(body),
      body,
      promptHistory: input.promptHistory,
      acceptanceCriteria: extractSectionList(body, "Acceptance Criteria"),
      implementationTasks: extractSectionList(body, "Implementation Tasks"),
      risks: [],
      openDesignDecisions: [],
    };
    if (planRevision.implementationTasks.length === 0) {
      planRevision.implementationTasks = extractListItems(body);
    }
    return this.store.writePlanRevision({
      workflowId: input.workflowId,
      iteration: input.iteration,
      createdAt,
      status: input.status,
      inputs: (input.inputArtifacts ?? []).map((artifact) => ({
        artifactId: artifact.artifactId,
        kind: artifact.kind,
        contentHash: artifact.contentHash,
        path: artifact.path,
      })),
      data: {
        ...planRevision,
        body,
        promptHistory: input.promptHistory,
      },
      writeCurrentView: input.writeCurrentView,
      currentPromptHistory: input.promptHistory,
    });
  }

  public async createPlan(requirement: string): Promise<PlannerResult> {
    const workflowId = randomUUID();
    const createdAt = this.now().toISOString();
    const prompt: PromptRecord = {
      sequence: 1,
      content: requirement.trim(),
      createdAt,
    };
    await this.store.appendPrompt(prompt);
    const plan = await this.generatePlanRevision({
      workflowId,
      iteration: 1,
      requirement,
      promptHistory: [prompt],
      status: "pending_approval",
      writeCurrentView: true,
    });
    const state: WorkflowState = {
      workflowId,
      stage: "awaiting_initial_plan_approval",
      iteration: 1,
      version: 0,
      pendingPlanRevision: {
        artifactId: plan.artifactId,
        kind: plan.kind,
        contentHash: plan.contentHash,
        path: plan.path,
      },
      lastPromptSequence: 1,
      updatedAt: createdAt,
    };
    await this.store.writeWorkflowState(state, undefined, {
      createdAt,
      workflowId,
      stage: state.stage,
      type: "plan.created",
      artifactId: plan.artifactId,
      artifactHash: plan.contentHash,
    });
    return { artifactId: plan.artifactId, status: "awaiting_initial_plan_approval", plan, state };
  }

  public async approvePlan(expected: ApprovalBinding): Promise<WorkflowState> {
    const state = await this.store.readWorkflowState();
    if (!state) throw new Error("No workflow is awaiting approval");
    if (!state.pendingPlanRevision) throw new Error("No plan revision is pending approval");
    if (
      expected.artifactId !== state.pendingPlanRevision.artifactId ||
      expected.contentHash !== state.pendingPlanRevision.contentHash
    ) {
      throw new Error("Plan approval does not match the pending plan revision");
    }
    if (!["awaiting_initial_plan_approval", "awaiting_plan_revision_approval"].includes(state.stage)) {
      throw new Error("Workflow is not waiting for plan approval");
    }
    const activePlanRevision = state.pendingPlanRevision;
    const plan = await this.store.readPlanRevision(activePlanRevision.artifactId);
    await this.store.projectCurrentPlan(plan, await this.store.listPrompts());
    const approved: WorkflowState = {
      ...state,
      stage: "implementing",
      version: state.version + 1,
      activePlanRevision,
      pendingPlanRevision: undefined,
      updatedAt: this.now().toISOString(),
    };
    await this.store.writeWorkflowState(approved, state.version, {
      createdAt: approved.updatedAt,
      workflowId: approved.workflowId,
      stage: approved.stage,
      type: "plan.approved",
      artifactId: activePlanRevision.artifactId,
      artifactHash: activePlanRevision.contentHash,
    });
    return approved;
  }

  public async preparePlanRevisionCandidate(requirement: string): Promise<ArtifactEnvelope<PlanRevision>> {
    const state = await this.store.readWorkflowState();
    if (!state) throw new Error("Workflow state not found");
    if (state.stage !== "awaiting_plan_revision_approval") {
      throw new Error("Workflow is not waiting for a plan revision candidate");
    }
    const inputArtifacts = [state.activePlanRevision, state.currentImplementation, state.latestValidationReport]
      .filter((artifact): artifact is NonNullable<typeof artifact> => Boolean(artifact))
      .map((artifact) => ({ ...artifact }));
    const prompts = await this.store.listPrompts();
    const candidate = await this.generatePlanRevision({
      workflowId: state.workflowId,
      iteration: state.iteration,
      requirement,
      promptHistory: prompts,
      status: "candidate",
      writeCurrentView: false,
      inputArtifacts: inputArtifacts as ArtifactEnvelope<unknown>[],
    });
    const nextState: WorkflowState = {
      ...state,
      version: state.version + 1,
      pendingPlanRevision: {
        artifactId: candidate.artifactId,
        kind: candidate.kind,
        contentHash: candidate.contentHash,
        path: candidate.path,
      },
      updatedAt: this.now().toISOString(),
    };
    await this.store.writeWorkflowState(nextState, state.version, {
      createdAt: nextState.updatedAt,
      workflowId: state.workflowId,
      stage: nextState.stage,
      type: "plan.candidate_created",
      artifactId: candidate.artifactId,
      artifactHash: candidate.contentHash,
    });
    return candidate;
  }

  public async rejectPlanRevisionCandidate(expected: ApprovalBinding): Promise<WorkflowState> {
    const state = await this.store.readWorkflowState();
    if (!state?.pendingPlanRevision) throw new Error("No plan revision candidate is pending approval");
    if (state.stage !== "awaiting_plan_revision_approval") {
      throw new Error("Workflow is not waiting for a plan revision approval decision");
    }
    if (
      expected.artifactId !== state.pendingPlanRevision.artifactId ||
      expected.contentHash !== state.pendingPlanRevision.contentHash
    ) {
      throw new Error("Plan rejection does not match the pending plan revision");
    }
    const rejected: WorkflowState = {
      ...state,
      version: state.version + 1,
      pendingPlanRevision: undefined,
      stage: "awaiting_validation_decision",
      updatedAt: this.now().toISOString(),
    };
    await this.store.writeWorkflowState(rejected, state.version, {
      createdAt: rejected.updatedAt,
      workflowId: rejected.workflowId,
      stage: rejected.stage,
      type: "plan.candidate_rejected",
      artifactId: expected.artifactId,
      artifactHash: expected.contentHash,
    });
    return rejected;
  }
}

export function hashPlanBody(body: string): string {
  return sha256(body.trim());
}

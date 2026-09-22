import { randomUUID } from "node:crypto";
import type { AgentSessionRunner, PlanDocument, WorkflowState } from "./contracts.js";
import { sha256 } from "./hash.js";
import { parsePlan, SdlcStore } from "./persistence.js";

export interface PlannerResult {
  artifactId: string;
  status: "awaiting_approval";
  plan: PlanDocument;
  state: WorkflowState;
}

export class Planner {
  public constructor(
    private readonly runner: AgentSessionRunner,
    private readonly store: SdlcStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async createPlan(requirement: string): Promise<PlannerResult> {
    const normalizedRequirement = requirement.trim();
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
    const canonicalPlan: PlanDocument = {
      ...parsed,
      body: parsed.body.trim(),
      frontMatter: {
        ...parsed.frontMatter,
        contentHash: sha256(parsed.body.trim()),
      },
    };
    const metadata = await this.store.writePlan(canonicalPlan);
    const state: WorkflowState = {
      workflowId: randomUUID(),
      status: "awaiting_approval",
      artifactId: metadata.artifactId,
      updatedAt: this.now().toISOString(),
    };
    await this.store.writeWorkflowState(state);
    return { artifactId: metadata.artifactId, status: "awaiting_approval", plan: canonicalPlan, state };
  }

  public async approvePlan(): Promise<WorkflowState> {
    const state = await this.store.readWorkflowState();
    if (!state) throw new Error("No workflow is awaiting approval");
    if (state.status !== "awaiting_approval") throw new Error("Workflow plan has already been approved");
    const approved = { ...state, status: "approved" as const, updatedAt: this.now().toISOString() };
    await this.store.writeWorkflowState(approved);
    return approved;
  }
}

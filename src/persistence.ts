/**
 * Handles durable workflow persistence under the local .sdlc workspace.
 * Immutable artifacts are stored in stable locations while workflow state is updated atomically
 * so stale reports and approvals can be detected before they are applied.
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ArtifactEnvelope,
  ArtifactReference,
  HumanDecision,
  ImplementationSnapshot,
  IterationReport,
  PlanDocument,
  PlanRevision,
  PromptRecord,
  QaReport,
  ValidationReport,
  WorkflowState,
} from "./contracts.js";
import { sha256 } from "./hash.js";
import {
  artifactEnvelopeSchema,
  humanDecisionSchema,
  implementationSnapshotSchema,
  iterationReportSchema,
  planDocumentSchema,
  planRevisionSchema,
  promptRecordSchema,
  qaReportSchema,
  validationReportSchema,
  workflowStateSchema,
} from "./schema.js";
import { renderIterationHtml, renderPlanHtml, renderQaHtml, renderValidationHtml } from "./html-render.js";

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, path);
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toReference<T>(artifact: ArtifactEnvelope<T>): ArtifactReference {
  return {
    artifactId: artifact.artifactId,
    kind: artifact.kind,
    contentHash: artifact.contentHash,
    path: artifact.path,
  };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export class SdlcStore {
  public constructor(private readonly rootDirectory: string) {}

  private async withWorkflowLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = join(this.rootDirectory, ".sdlc", "workflow.lock");
    await mkdir(dirname(lockPath), { recursive: true });
    try {
      await mkdir(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("Workflow state is being updated concurrently");
      }
      throw error;
    }
    try {
      return await operation();
    } finally {
      await rm(lockPath, { recursive: true, force: true });
    }
  }

  private artifactEnvelope<T>(
    artifactId: string,
    kind: ArtifactReference["kind"],
    path: string,
    workflowId: string,
    iteration: number,
    producer: ArtifactEnvelope<T>["producer"],
    status: ArtifactEnvelope<T>["status"],
    inputs: ArtifactReference[],
    data: T,
    createdAt: string,
  ): ArtifactEnvelope<T> {
    return {
      artifactId,
      kind,
      contentHash: sha256(stableSerialize(data)),
      path,
      workflowId,
      iteration,
      producer,
      createdAt,
      status,
      inputs,
      data,
    };
  }

  private promptPath(sequence: number): string {
    return join(this.rootDirectory, ".sdlc", "prompts", `${String(sequence).padStart(4, "0")}-prompt.json`);
  }

  private async appendPromptUnlocked(prompt: PromptRecord): Promise<void> {
    await atomicWrite(
      this.promptPath(prompt.sequence),
      `${stableSerialize(promptRecordSchema.parse(prompt))}\n`,
    );
  }

  public async createWorkflow(
    state: WorkflowState,
    initialPrompt: PromptRecord,
    event?: Record<string, unknown>,
  ): Promise<void> {
    const nextState = workflowStateSchema.parse(state);
    await this.withWorkflowLock(async () => {
      const current = await this.readWorkflowState();
      if (current) {
        throw new Error("A workflow already exists in this workspace");
      }
      await this.appendPromptUnlocked(initialPrompt);
      await atomicWrite(join(this.rootDirectory, ".sdlc", "workflow.json"), `${stableSerialize(nextState)}\n`);
      if (event) {
        await this.appendEventUnlocked(event);
      }
    });
  }

  public async appendPromptAndUpdateWorkflowState(
    prompt: PromptRecord,
    state: WorkflowState,
    expectedVersion: number,
    event?: Record<string, unknown>,
  ): Promise<void> {
    const nextState = workflowStateSchema.parse(state);
    await this.withWorkflowLock(async () => {
      const current = await this.readWorkflowState();
      if (!current) throw new Error("Workflow state does not exist");
      if (current.version !== expectedVersion) {
        throw new Error(`Workflow state version mismatch: expected ${expectedVersion}, received ${current.version}`);
      }
      await this.appendPromptUnlocked(prompt);
      await atomicWrite(join(this.rootDirectory, ".sdlc", "workflow.json"), `${stableSerialize(nextState)}\n`);
      if (event) {
        await this.appendEventUnlocked(event);
      }
    });
  }

  public async listPrompts(): Promise<PromptRecord[]> {
    const promptDirectory = join(this.rootDirectory, ".sdlc", "prompts");
    try {
      const files = (await readdir(promptDirectory)).sort();
      return await Promise.all(files.map(async (file) => promptRecordSchema.parse(await readJson(join(promptDirectory, file)))));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  public async writePlanRevision(input: {
    workflowId: string;
    iteration: number;
    createdAt: string;
    status: ArtifactEnvelope<PlanRevision>["status"];
    inputs: ArtifactReference[];
    data: PlanRevision;
    writeCurrentView: boolean;
    currentPromptHistory?: PromptRecord[];
  }): Promise<ArtifactEnvelope<PlanRevision>> {
    const data = planRevisionSchema.parse(input.data);
    const directory = join(this.rootDirectory, ".sdlc", "plan", "revisions", data.revisionId);
    const htmlPath = join(directory, "PLAN.html");
    const artifact = artifactEnvelopeSchema(planRevisionSchema).parse(
      this.artifactEnvelope(
        data.revisionId,
        "plan",
        htmlPath,
        input.workflowId,
        input.iteration,
        "planner",
        input.status,
        input.inputs,
        data,
        input.createdAt,
      ),
    );
    const html = renderPlanHtml(data, {
      artifactId: artifact.artifactId,
      contentHash: artifact.contentHash,
      status: artifact.status,
    });
    await atomicWrite(join(directory, "artifact.json"), `${stableSerialize(artifact)}\n`);
    await atomicWrite(htmlPath, html);
    if (input.writeCurrentView) {
      await this.projectCurrentPlan(artifact, input.currentPromptHistory ?? data.promptHistory);
    }
    return artifact;
  }

  public async projectCurrentPlan(plan: ArtifactEnvelope<PlanRevision>, promptHistory: PromptRecord[]): Promise<void> {
    const projectedPlan: PlanRevision = {
      ...plan.data,
      promptHistory: promptHistory.map((prompt) => promptRecordSchema.parse(prompt)),
    };
    await atomicWrite(
      join(this.rootDirectory, ".sdlc", "PLAN.html"),
      renderPlanHtml(projectedPlan, {
        artifactId: plan.artifactId,
        contentHash: plan.contentHash,
        status: plan.status,
      }),
    );
  }

  public async readPlanRevision(artifactId: string): Promise<ArtifactEnvelope<PlanRevision>> {
    return artifactEnvelopeSchema(planRevisionSchema).parse(
      await readJson(join(this.rootDirectory, ".sdlc", "plan", "revisions", artifactId, "artifact.json")),
    );
  }

  public async writeImplementationSnapshot(input: {
    workflowId: string;
    iteration: number;
    createdAt: string;
    inputs: ArtifactReference[];
    data: ImplementationSnapshot;
  }): Promise<ArtifactEnvelope<ImplementationSnapshot>> {
    const data = implementationSnapshotSchema.parse(input.data);
    const directory = join(
      this.rootDirectory,
      ".sdlc",
      "iterations",
      String(input.iteration),
      "implementations",
      data.snapshotId,
    );
    const path = join(directory, "artifact.json");
    const artifact = artifactEnvelopeSchema(implementationSnapshotSchema).parse(
      this.artifactEnvelope(
        data.snapshotId,
        "implementation",
        path,
        input.workflowId,
        input.iteration,
        "implementer",
        "generated",
        input.inputs,
        data,
        input.createdAt,
      ),
    );
    await atomicWrite(path, `${stableSerialize(artifact)}\n`);
    await atomicWrite(
      join(this.rootDirectory, ".sdlc", "iterations", String(input.iteration), "implementation.json"),
      `${stableSerialize(artifact)}\n`,
    );
    return artifact;
  }

  public async readImplementationSnapshot(iteration: number): Promise<ArtifactEnvelope<ImplementationSnapshot>> {
    return artifactEnvelopeSchema(implementationSnapshotSchema).parse(
      await readJson(join(this.rootDirectory, ".sdlc", "iterations", String(iteration), "implementation.json")),
    );
  }

  public async readImplementationSnapshotByReference(
    reference: ArtifactReference,
  ): Promise<ArtifactEnvelope<ImplementationSnapshot>> {
    return artifactEnvelopeSchema(implementationSnapshotSchema).parse(await readJson(reference.path));
  }

  public async writeQaReport(input: {
    workflowId: string;
    iteration: number;
    createdAt: string;
    inputs: ArtifactReference[];
    data: QaReport;
  }): Promise<ArtifactEnvelope<QaReport>> {
    const data = qaReportSchema.parse(input.data);
    const directory = join(this.rootDirectory, ".sdlc", "iterations", String(input.iteration), "qa", data.reportId);
    const jsonPath = join(directory, "artifact.json");
    const htmlPath = join(directory, "QA.html");
    const artifact = artifactEnvelopeSchema(qaReportSchema).parse(
      this.artifactEnvelope(
        data.reportId,
        "qa-report",
        jsonPath,
        input.workflowId,
        input.iteration,
        "qa",
        data.outcome === "passed" ? "passed" : "failed",
        input.inputs,
        data,
        input.createdAt,
      ),
    );
    await atomicWrite(jsonPath, `${stableSerialize(artifact)}\n`);
    await atomicWrite(htmlPath, renderQaHtml(artifact));
    const currentDirectory = join(this.rootDirectory, ".sdlc", "iterations", String(input.iteration));
    await atomicWrite(join(currentDirectory, "QA.json"), `${stableSerialize(artifact)}\n`);
    await atomicWrite(join(currentDirectory, "QA.html"), renderQaHtml(artifact));
    return artifact;
  }

  public async readQaReport(iteration: number): Promise<ArtifactEnvelope<QaReport>> {
    return artifactEnvelopeSchema(qaReportSchema).parse(
      await readJson(join(this.rootDirectory, ".sdlc", "iterations", String(iteration), "QA.json")),
    );
  }

  public async readQaReportByReference(reference: ArtifactReference): Promise<ArtifactEnvelope<QaReport>> {
    return artifactEnvelopeSchema(qaReportSchema).parse(await readJson(reference.path));
  }

  public async writeValidationReport(input: {
    workflowId: string;
    iteration: number;
    createdAt: string;
    inputs: ArtifactReference[];
    data: ValidationReport;
  }): Promise<ArtifactEnvelope<ValidationReport>> {
    const data = validationReportSchema.parse(input.data);
    const directory = join(
      this.rootDirectory,
      ".sdlc",
      "iterations",
      String(input.iteration),
      "validation",
      data.reportId,
    );
    const jsonPath = join(directory, "artifact.json");
    const htmlPath = join(directory, "VALIDATION.html");
    const artifact = artifactEnvelopeSchema(validationReportSchema).parse(
      this.artifactEnvelope(
        data.reportId,
        "validation-report",
        jsonPath,
        input.workflowId,
        input.iteration,
        "validator",
        data.findings.some((finding) => finding.status === "failed")
          ? "failed"
          : data.findings.some((finding) => finding.status === "blocked")
            ? "blocked"
            : "passed",
        input.inputs,
        data,
        input.createdAt,
      ),
    );
    await atomicWrite(jsonPath, `${stableSerialize(artifact)}\n`);
    await atomicWrite(htmlPath, renderValidationHtml(artifact));
    const currentDirectory = join(this.rootDirectory, ".sdlc", "iterations", String(input.iteration));
    await atomicWrite(join(currentDirectory, "VALIDATION.json"), `${stableSerialize(artifact)}\n`);
    await atomicWrite(join(currentDirectory, "VALIDATION.html"), renderValidationHtml(artifact));
    return artifact;
  }

  public async readValidationReport(iteration: number): Promise<ArtifactEnvelope<ValidationReport>> {
    return artifactEnvelopeSchema(validationReportSchema).parse(
      await readJson(join(this.rootDirectory, ".sdlc", "iterations", String(iteration), "VALIDATION.json")),
    );
  }

  public async readValidationReportByReference(
    reference: ArtifactReference,
  ): Promise<ArtifactEnvelope<ValidationReport>> {
    return artifactEnvelopeSchema(validationReportSchema).parse(await readJson(reference.path));
  }

  public async writeHumanDecision(input: {
    workflowId: string;
    iteration: number;
    inputs: ArtifactReference[];
    data: HumanDecision;
  }): Promise<ArtifactEnvelope<HumanDecision>> {
    const data = humanDecisionSchema.parse(input.data);
    const directory = join(
      this.rootDirectory,
      ".sdlc",
      "iterations",
      String(input.iteration),
      "decisions",
      data.decisionId,
    );
    const path = join(directory, "artifact.json");
    const artifact = artifactEnvelopeSchema(humanDecisionSchema).parse(
      this.artifactEnvelope(
        data.decisionId,
        "human-decision",
        path,
        input.workflowId,
        input.iteration,
        "human",
        "approved",
        input.inputs,
        data,
        data.createdAt,
      ),
    );
    await atomicWrite(path, `${stableSerialize(artifact)}\n`);
    await atomicWrite(
      join(this.rootDirectory, ".sdlc", "iterations", String(input.iteration), "decision.json"),
      `${stableSerialize(artifact)}\n`,
    );
    return artifact;
  }

  public async readHumanDecision(iteration: number): Promise<ArtifactEnvelope<HumanDecision>> {
    return artifactEnvelopeSchema(humanDecisionSchema).parse(
      await readJson(join(this.rootDirectory, ".sdlc", "iterations", String(iteration), "decision.json")),
    );
  }

  public async readHumanDecisionByReference(reference: ArtifactReference): Promise<ArtifactEnvelope<HumanDecision>> {
    return artifactEnvelopeSchema(humanDecisionSchema).parse(await readJson(reference.path));
  }

  public async writeIterationReport(input: {
    workflowId: string;
    iteration: number;
    createdAt: string;
    inputs: ArtifactReference[];
    data: IterationReport;
  }): Promise<ArtifactEnvelope<IterationReport>> {
    const data = iterationReportSchema.parse(input.data);
    const directory = join(this.rootDirectory, ".sdlc", "iterations", String(input.iteration));
    const htmlPath = join(directory, `ITERATION-${input.iteration}.html`);
    const artifact = artifactEnvelopeSchema(iterationReportSchema).parse(
      this.artifactEnvelope(
        data.reportId,
        "iteration-report",
        htmlPath,
        input.workflowId,
        input.iteration,
        "documenter",
        "generated",
        input.inputs,
        data,
        input.createdAt,
      ),
    );
    await atomicWrite(join(directory, `ITERATION-${input.iteration}.json`), `${stableSerialize(artifact)}\n`);
    await atomicWrite(htmlPath, renderIterationHtml(artifact));
    return artifact;
  }

  public async readIterationReport(iteration: number): Promise<ArtifactEnvelope<IterationReport>> {
    return artifactEnvelopeSchema(iterationReportSchema).parse(
      await readJson(join(this.rootDirectory, ".sdlc", "iterations", String(iteration), `ITERATION-${iteration}.json`)),
    );
  }

  private async appendEventUnlocked(event: Record<string, unknown>): Promise<void> {
    const path = join(this.rootDirectory, ".sdlc", "events.jsonl");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${stableSerialize(event)}\n`, { encoding: "utf8", flag: "a" });
  }

  public async writeWorkflowState(
    state: WorkflowState,
    expectedVersion?: number,
    event?: Record<string, unknown>,
  ): Promise<void> {
    const nextState = workflowStateSchema.parse(state);
    await this.withWorkflowLock(async () => {
      if (expectedVersion !== undefined) {
        const current = await this.readWorkflowState();
        if (!current) throw new Error("Workflow state does not exist");
        if (current.version !== expectedVersion) {
          throw new Error(`Workflow state version mismatch: expected ${expectedVersion}, received ${current.version}`);
        }
      }
      await atomicWrite(join(this.rootDirectory, ".sdlc", "workflow.json"), `${stableSerialize(nextState)}\n`);
      if (event) {
        await this.appendEventUnlocked(event);
      }
    });
  }

  public async readWorkflowState(): Promise<WorkflowState | undefined> {
    try {
      return workflowStateSchema.parse(await readJson(join(this.rootDirectory, ".sdlc", "workflow.json")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
}

export function serializePlan(plan: PlanDocument): string {
  return `---\n${Object.entries(plan.frontMatter)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n")}\n---\n\n${plan.body.trim()}\n`;
}

export function parsePlan(content: string): PlanDocument {
  const match = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/.exec(content);
  if (!match) throw new Error("Plan must contain YAML-style front matter");
  const frontMatter = Object.fromEntries(
    match[1].split("\n").map((line) => {
      const separator = line.indexOf(": ");
      if (separator < 0) throw new Error(`Invalid front matter line: ${line}`);
      return [line.slice(0, separator), JSON.parse(line.slice(separator + 2))];
    }),
  );
  return planDocumentSchema.parse({ frontMatter, body: match[2] });
}

export { toReference };

import { mkdtemp, readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentSessionRunner } from "../src/contracts.js";
import { WorkflowCoordinator } from "../src/coordinator.js";
import { Documenter } from "../src/documenter.js";
import { Implementer } from "../src/implementer.js";
import { SdlcStore } from "../src/persistence.js";
import { Planner } from "../src/planner.js";
import { QAAgent } from "../src/qa.js";
import { Validator } from "../src/validator.js";

function createPlanner(root: string) {
  const requirementToBody = new Map<string, string>([
    ["Initial requirement", "# Initial plan\n\n1. Implement feature.\n2. Verify behavior.\n"],
    ["Reconcile implementation", "# Reconciled plan\n\n1. Capture the shipped behavior.\n"],
  ]);
  const runner: AgentSessionRunner = {
    run: async (prompt) => {
      const artifactId = /artifactId: "([^"]+)"/.exec(prompt)?.[1];
      const requirement = /requirement: "([^"]+)"/.exec(prompt)?.[1];
      assert.ok(artifactId);
      assert.ok(requirement);
      return `---\nartifactId: ${JSON.stringify(artifactId)}\nrequirement: ${JSON.stringify(
        requirement as string,
      )}\ncreatedAt: "2026-01-01T00:00:00.000Z"\ncontentHash: "0000000000000000000000000000000000000000000000000000000000000000"\n---\n\n${requirementToBody.get(requirement) ?? "# Generic plan\n\n1. Do work.\n"}`;
    },
  };
  const store = new SdlcStore(root);
  const nowValues = [
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:01:00.000Z",
    "2026-01-01T00:02:00.000Z",
    "2026-01-01T00:03:00.000Z",
    "2026-01-01T00:04:00.000Z",
    "2026-01-01T00:05:00.000Z",
    "2026-01-01T00:06:00.000Z",
    "2026-01-01T00:07:00.000Z",
    "2026-01-01T00:08:00.000Z",
    "2026-01-01T00:09:00.000Z",
  ];
  const now = () => new Date(nowValues.shift() ?? "2026-01-01T00:10:00.000Z");
  const planner = new Planner(runner, store, now);
  return {
    store,
    coordinator: new WorkflowCoordinator(
      store,
      planner,
      new Implementer(),
      new QAAgent(),
      new Validator(),
      new Documenter(),
      now,
    ),
  };
}

test("workflow repeats QA until pass, then validates and documents an iteration report", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-sdlc-workflow-"));
  const { store, coordinator } = createPlanner(root);
  const plan = await coordinator.startInitialPlan("Initial requirement");
  await coordinator.approveCurrentPlan({ artifactId: plan.plan.artifactId, contentHash: plan.plan.contentHash });
  const implementation = await coordinator.recordImplementation({
    summary: "Implemented the feature",
    changedFiles: [{ path: "src/index.ts", summary: "Added orchestration" }],
    tests: [{ command: "npm test", outcome: "passed", output: "ok" }],
  });
  const failedQa = await coordinator.recordQaReport({
    summary: "Regression found",
    outcome: "failed",
    testResults: [{ command: "npm test", outcome: "failed", output: "bug" }],
    defects: [{ title: "Broken behavior", severity: "high", details: "Regression" }],
  });
  assert.equal(failedQa.state.stage, "implementing");

  await coordinator.appendHumanPrompt("Fix the regression without changing scope");
  const repaired = await coordinator.recordImplementation({
    summary: "Fixed the regression",
    changedFiles: [{ path: "src/index.ts", summary: "Corrected orchestration" }],
    tests: [{ command: "npm test", outcome: "passed", output: "ok" }],
  });
  assert.notEqual(repaired.snapshot.contentHash, implementation.snapshot.contentHash);

  await coordinator.recordQaReport({
    summary: "QA passed on the repaired snapshot",
    outcome: "passed",
    testResults: [{ command: "npm test", outcome: "passed", output: "ok" }],
  });
  const validation = await coordinator.recordValidationReport({
    summary: "Validation passed",
    findings: [{ criterion: "Implement feature.", status: "passed", evidence: ["src/index.ts"], details: "Implemented" }],
    openDesignDecisions: ["Need to decide whether to add a CLI wrapper"],
  });
  await assert.rejects(
    coordinator.recordHumanDecision({
      route: "accept_and_document",
      rationale: "stale",
      expectedValidation: { artifactId: validation.report.artifactId, contentHash: "1".repeat(64) },
      expectedPlan: { artifactId: repaired.state.activePlanRevision!.artifactId, contentHash: repaired.state.activePlanRevision!.contentHash },
      expectedImplementation: { artifactId: repaired.snapshot.artifactId, contentHash: repaired.snapshot.contentHash },
    }),
    /does not match/,
  );

  await coordinator.recordHumanDecision({
    route: "accept_and_document",
    rationale: "Looks good",
    expectedValidation: { artifactId: validation.report.artifactId, contentHash: validation.report.contentHash },
    expectedPlan: {
      artifactId: repaired.state.activePlanRevision!.artifactId,
      contentHash: repaired.state.activePlanRevision!.contentHash,
    },
    expectedImplementation: { artifactId: repaired.snapshot.artifactId, contentHash: repaired.snapshot.contentHash },
  });
  const documented = await coordinator.documentIteration();
  assert.equal(documented.state.stage, "awaiting_next_prompt");
  assert.equal(documented.state.iteration, 2);
  const html = await readFile(join(root, ".sdlc", "iterations", "1", "ITERATION-1.html"), "utf8");
  assert.match(html, /Open Design Decisions/);
  assert.match(html, /Need to decide whether to add a CLI wrapper/);
  assert.equal((await store.listPrompts()).map((prompt) => prompt.sequence).join(","), "1,2");
});

test("validator cannot run before QA passes on the latest implementation snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-sdlc-workflow-"));
  const { coordinator } = createPlanner(root);
  const plan = await coordinator.startInitialPlan("Initial requirement");
  await coordinator.approveCurrentPlan({ artifactId: plan.plan.artifactId, contentHash: plan.plan.contentHash });
  await coordinator.recordImplementation({
    summary: "Implemented the feature",
    changedFiles: [{ path: "src/index.ts", summary: "Added orchestration" }],
  });
  await assert.rejects(
    coordinator.recordValidationReport({
      summary: "Validation attempted too early",
      findings: [{ criterion: "Implement feature.", status: "passed", evidence: ["src/index.ts"], details: "done" }],
    }),
    /not waiting for validation/,
  );
});

test("plan revision candidates require explicit approval or rejection", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-sdlc-workflow-"));
  const { coordinator } = createPlanner(root);
  const plan = await coordinator.startInitialPlan("Initial requirement");
  await coordinator.approveCurrentPlan({ artifactId: plan.plan.artifactId, contentHash: plan.plan.contentHash });
  const implementation = await coordinator.recordImplementation({
    summary: "Implemented the feature",
    changedFiles: [{ path: "src/index.ts", summary: "Added orchestration" }],
  });
  await coordinator.recordQaReport({
    summary: "QA passed",
    outcome: "passed",
    testResults: [{ command: "npm test", outcome: "passed", output: "ok" }],
  });
  const validation = await coordinator.recordValidationReport({
    summary: "Implementation differs slightly",
    findings: [{ criterion: "Implement feature.", status: "passed", evidence: ["src/index.ts"], details: "done" }],
  });
  await coordinator.recordHumanDecision({
    route: "reconcile_plan",
    rationale: "Reflect the actual shipped behavior",
    expectedValidation: { artifactId: validation.report.artifactId, contentHash: validation.report.contentHash },
    expectedPlan: {
      artifactId: implementation.state.activePlanRevision!.artifactId,
      contentHash: implementation.state.activePlanRevision!.contentHash,
    },
    expectedImplementation: { artifactId: implementation.snapshot.artifactId, contentHash: implementation.snapshot.contentHash },
  });
  const candidate = await coordinator.preparePlanRevisionCandidate("Reconcile implementation");
  const rejected = await coordinator.rejectPlanRevisionCandidate({
    artifactId: candidate.artifactId,
    contentHash: candidate.contentHash,
  });
  assert.equal(rejected.stage, "awaiting_validation_decision");

  await coordinator.recordHumanDecision({
    route: "reconcile_plan",
    rationale: "Reflect the actual shipped behavior",
    expectedValidation: { artifactId: validation.report.artifactId, contentHash: validation.report.contentHash },
    expectedPlan: {
      artifactId: implementation.state.activePlanRevision!.artifactId,
      contentHash: implementation.state.activePlanRevision!.contentHash,
    },
    expectedImplementation: { artifactId: implementation.snapshot.artifactId, contentHash: implementation.snapshot.contentHash },
  });
  const candidateTwo = await coordinator.preparePlanRevisionCandidate("Reconcile implementation");
  const approved = await coordinator.approvePlanRevisionCandidate({
    artifactId: candidateTwo.artifactId,
    contentHash: candidateTwo.contentHash,
  });
  assert.equal(approved.stage, "implementing");
  assert.equal(approved.activePlanRevision?.artifactId, candidateTwo.artifactId);
});

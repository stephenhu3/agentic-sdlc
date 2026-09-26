import { mkdtemp, readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentSessionRunner } from "../src/contracts.js";
import { SdlcStore } from "../src/persistence.js";
import { Planner } from "../src/planner.js";

test("planner persists a pending plan revision and binds approval to the exact hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-sdlc-"));
  const requirement = "Add an export endpoint";
  const body = "# Plan\n\n1. Add the endpoint.\n2. Test the endpoint.\n";
  const runner: AgentSessionRunner = {
    run: async (prompt) => {
      const artifactId = /artifactId: "([^"]+)"/.exec(prompt)?.[1];
      assert.ok(artifactId);
      return `---\nartifactId: ${JSON.stringify(artifactId)}\nrequirement: ${JSON.stringify(requirement)}\ncreatedAt: "2026-01-01T00:00:00.000Z"\ncontentHash: "0000000000000000000000000000000000000000000000000000000000000000"\n---\n\n${body}`;
    },
  };
  const store = new SdlcStore(root);
  const planner = new Planner(runner, store, () => new Date("2026-01-01T00:00:00.000Z"));

  const result = await planner.createPlan(requirement);
  const state = await store.readWorkflowState();
  assert.equal(result.status, "awaiting_initial_plan_approval");
  assert.equal(state?.stage, "awaiting_initial_plan_approval");
  assert.equal(state?.pendingPlanRevision?.artifactId, result.artifactId);
  assert.equal(result.plan.data.implementationTasks.length, 2);
  assert.equal(
    (await readFile(join(root, ".sdlc", "plan", "revisions", result.artifactId, "PLAN.html"), "utf8")).includes(
      "Add the endpoint.",
    ),
    true,
  );
  await assert.rejects(
    planner.approvePlan({
      artifactId: result.artifactId,
      contentHash: "1111111111111111111111111111111111111111111111111111111111111111",
    }),
    /does not match/,
  );
  const approved = await planner.approvePlan({
    artifactId: result.artifactId,
    contentHash: result.plan.contentHash,
  });
  assert.equal(approved.stage, "implementing");
  assert.equal(approved.activePlanRevision?.artifactId, result.artifactId);
  assert.equal((await readFile(join(root, ".sdlc", "PLAN.html"), "utf8")).includes("Prompt History"), true);
});

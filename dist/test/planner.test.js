import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Planner } from "../src/planner.js";
import { SdlcStore } from "../src/persistence.js";
import { sha256 } from "../src/hash.js";
test("planner persists a hashed plan and pauses for approval", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentic-sdlc-"));
    const requirement = "Add an export endpoint";
    const body = "# Plan\n\n1. Add the endpoint.\n";
    const runner = {
        run: async (prompt) => {
            const artifactId = /artifactId: "([^"]+)"/.exec(prompt)?.[1];
            assert.ok(artifactId);
            return `---\nartifactId: ${JSON.stringify(artifactId)}\nrequirement: ${JSON.stringify(requirement)}\ncreatedAt: "2026-01-01T00:00:00.000Z"\ncontentHash: ${JSON.stringify(sha256(body.trim()))}\n---\n\n${body}`;
        },
    };
    const planner = new Planner(runner, new SdlcStore(root), () => new Date("2026-01-01T00:00:00.000Z"));
    const result = await planner.createPlan(requirement);
    const state = await new SdlcStore(root).readWorkflowState();
    assert.equal(state?.status, "awaiting_approval");
    assert.equal(state?.artifactId, result.artifactId);
    assert.equal((await readFile(join(root, ".sdlc", "artifacts", result.artifactId, "PLAN.md"), "utf8")).includes("contentHash"), true);
    assert.equal((await planner.approvePlan()).status, "approved");
});
//# sourceMappingURL=planner.test.js.map
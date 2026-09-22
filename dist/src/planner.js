import { randomUUID } from "node:crypto";
import { sha256 } from "./hash.js";
import { parsePlan } from "./persistence.js";
export class Planner {
    runner;
    store;
    now;
    constructor(runner, store, now = () => new Date()) {
        this.runner = runner;
        this.store = store;
        this.now = now;
    }
    async createPlan(requirement) {
        const normalizedRequirement = requirement.trim();
        if (!normalizedRequirement)
            throw new Error("Requirement must not be empty");
        const artifactId = randomUUID();
        const createdAt = this.now().toISOString();
        const generated = await this.runner.run([
            "Create an implementation plan for the following human requirement.",
            "Return Markdown with exactly this JSON-valued front matter shape:",
            `artifactId: ${JSON.stringify(artifactId)}`,
            `requirement: ${JSON.stringify(normalizedRequirement)}`,
            `createdAt: ${JSON.stringify(createdAt)}`,
            "Then include a concise actionable plan body.",
        ].join("\n"), process.cwd());
        const parsed = parsePlan(generated);
        if (parsed.frontMatter.artifactId !== artifactId || parsed.frontMatter.requirement !== normalizedRequirement) {
            throw new Error("Planner response front matter does not match the requested requirement");
        }
        const canonicalPlan = {
            ...parsed,
            body: parsed.body.trim(),
            frontMatter: {
                ...parsed.frontMatter,
                contentHash: sha256(parsed.body.trim()),
            },
        };
        const metadata = await this.store.writePlan(canonicalPlan);
        const state = {
            workflowId: randomUUID(),
            status: "awaiting_approval",
            artifactId: metadata.artifactId,
            updatedAt: this.now().toISOString(),
        };
        await this.store.writeWorkflowState(state);
        return { artifactId: metadata.artifactId, status: "awaiting_approval", plan: canonicalPlan, state };
    }
    async approvePlan() {
        const state = await this.store.readWorkflowState();
        if (!state)
            throw new Error("No workflow is awaiting approval");
        if (state.status !== "awaiting_approval")
            throw new Error("Workflow plan has already been approved");
        const approved = { ...state, status: "approved", updatedAt: this.now().toISOString() };
        await this.store.writeWorkflowState(approved);
        return approved;
    }
}
//# sourceMappingURL=planner.js.map
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { artifactMetadataSchema, planDocumentSchema, workflowStateSchema } from "./schema.js";
async function atomicWrite(path, content) {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, path);
}
export class SdlcStore {
    rootDirectory;
    constructor(rootDirectory) {
        this.rootDirectory = rootDirectory;
    }
    async writePlan(plan) {
        const validatedPlan = planDocumentSchema.parse(plan);
        const artifactDirectory = join(this.rootDirectory, ".sdlc", "artifacts", validatedPlan.frontMatter.artifactId);
        const planPath = join(artifactDirectory, "PLAN.md");
        const metadata = {
            ...validatedPlan.frontMatter,
            kind: "plan",
            path: planPath,
        };
        await atomicWrite(planPath, serializePlan(validatedPlan));
        await atomicWrite(join(artifactDirectory, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
        return artifactMetadataSchema.parse(metadata);
    }
    async writeWorkflowState(state) {
        await atomicWrite(join(this.rootDirectory, ".sdlc", "workflow.json"), `${JSON.stringify(workflowStateSchema.parse(state), null, 2)}\n`);
    }
    async readWorkflowState() {
        try {
            return workflowStateSchema.parse(JSON.parse(await readFile(join(this.rootDirectory, ".sdlc", "workflow.json"), "utf8")));
        }
        catch (error) {
            if (error.code === "ENOENT")
                return undefined;
            throw error;
        }
    }
}
export function serializePlan(plan) {
    return `---\n${Object.entries(plan.frontMatter)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join("\n")}\n---\n\n${plan.body.trim()}\n`;
}
export function parsePlan(content) {
    const match = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/.exec(content);
    if (!match)
        throw new Error("Plan must contain YAML-style front matter");
    const frontMatter = Object.fromEntries(match[1].split("\n").map((line) => {
        const separator = line.indexOf(": ");
        if (separator < 0)
            throw new Error(`Invalid front matter line: ${line}`);
        return [line.slice(0, separator), JSON.parse(line.slice(separator + 2))];
    }));
    return planDocumentSchema.parse({ frontMatter, body: match[2] });
}
//# sourceMappingURL=persistence.js.map
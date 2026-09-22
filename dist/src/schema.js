import { z } from "zod";
export const planFrontMatterSchema = z.object({
    artifactId: z.string().uuid(),
    requirement: z.string().min(1),
    createdAt: z.string().datetime(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const planDocumentSchema = z.object({
    frontMatter: planFrontMatterSchema,
    body: z.string().min(1),
});
export const artifactMetadataSchema = planFrontMatterSchema.extend({
    kind: z.literal("plan"),
    path: z.string().min(1),
});
export const workflowStateSchema = z.object({
    workflowId: z.string().min(1),
    status: z.enum(["awaiting_approval", "approved"]),
    artifactId: z.string().min(1),
    updatedAt: z.string().datetime(),
});
//# sourceMappingURL=schema.js.map
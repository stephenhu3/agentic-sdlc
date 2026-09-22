import { z } from "zod";
import type { ArtifactMetadata, PlanDocument, WorkflowState } from "./contracts.js";
export declare const planFrontMatterSchema: any;
export declare const planDocumentSchema: z.ZodType<PlanDocument>;
export declare const artifactMetadataSchema: z.ZodType<ArtifactMetadata>;
export declare const workflowStateSchema: z.ZodType<WorkflowState>;

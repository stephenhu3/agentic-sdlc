import { randomUUID } from "node:crypto";
import type { ArtifactReference, HumanDecision, IterationReport, PromptRecord } from "./contracts.js";

export interface PrepareIterationReportInput {
  prompt: PromptRecord;
  planRevisionId: string;
  implementationSummary: string;
  qaSummary: string;
  validationSummary: string;
  humanDecision: HumanDecision;
  openDesignDecisions?: string[];
  remainingRisks?: string[];
  sourceArtifacts: ArtifactReference[];
}

export class Documenter {
  public createReport(input: PrepareIterationReportInput): IterationReport {
    return {
      reportId: randomUUID(),
      prompt: input.prompt,
      planRevisionId: input.planRevisionId,
      implementationSummary: input.implementationSummary.trim(),
      qaSummary: input.qaSummary.trim(),
      validationSummary: input.validationSummary.trim(),
      humanDecision: input.humanDecision,
      openDesignDecisions: (input.openDesignDecisions ?? []).map((value) => value.trim()).filter(Boolean),
      remainingRisks: (input.remainingRisks ?? []).map((value) => value.trim()).filter(Boolean),
      sourceArtifacts: input.sourceArtifacts,
    };
  }
}

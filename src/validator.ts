import { randomUUID } from "node:crypto";
import type { ValidationFinding, ValidationReport } from "./contracts.js";

export interface PrepareValidationReportInput {
  summary: string;
  findings: ValidationFinding[];
  unknowns?: string[];
  risks?: string[];
  recommendations?: string[];
  openDesignDecisions?: string[];
}

export class Validator {
  public createReport(
    planRevisionId: string,
    planRevisionHash: string,
    snapshotId: string,
    snapshotHash: string,
    input: PrepareValidationReportInput,
  ): ValidationReport {
    return {
      reportId: randomUUID(),
      planRevisionId,
      planRevisionHash,
      snapshotId,
      snapshotHash,
      summary: input.summary.trim(),
      findings: input.findings.map((finding) => ({
        criterion: finding.criterion.trim(),
        status: finding.status,
        evidence: finding.evidence.map((value) => value.trim()).filter(Boolean),
        details: finding.details.trim(),
      })),
      unknowns: (input.unknowns ?? []).map((value) => value.trim()).filter(Boolean),
      risks: (input.risks ?? []).map((value) => value.trim()).filter(Boolean),
      recommendations: (input.recommendations ?? []).map((value) => value.trim()).filter(Boolean),
      openDesignDecisions: (input.openDesignDecisions ?? []).map((value) => value.trim()).filter(Boolean),
    };
  }
}

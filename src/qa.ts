import { randomUUID } from "node:crypto";
import type { CommandEvidence, DefectRecord, QaReport } from "./contracts.js";

export interface PrepareQaReportInput {
  summary: string;
  outcome: QaReport["outcome"];
  testResults?: CommandEvidence[];
  defects?: DefectRecord[];
  recommendations?: string[];
}

export class QAAgent {
  public createReport(
    planRevisionId: string,
    snapshotId: string,
    snapshotHash: string,
    input: PrepareQaReportInput,
  ): QaReport {
    return {
      reportId: randomUUID(),
      planRevisionId,
      snapshotId,
      snapshotHash,
      summary: input.summary.trim(),
      outcome: input.outcome,
      testResults: (input.testResults ?? []).map((result) => ({
        ...result,
        command: result.command.trim(),
        output: result.output,
      })),
      defects: (input.defects ?? []).map((defect) => ({
        ...defect,
        title: defect.title.trim(),
        details: defect.details.trim(),
      })),
      recommendations: (input.recommendations ?? []).map((value) => value.trim()).filter(Boolean),
    };
  }
}

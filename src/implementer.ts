import { randomUUID } from "node:crypto";
import type { ChangedFile, CommandEvidence, ImplementationSnapshot } from "./contracts.js";

export interface PrepareImplementationInput {
  summary: string;
  changedFiles: ChangedFile[];
  tests?: CommandEvidence[];
  deviations?: string[];
  blockers?: string[];
  recommendations?: string[];
}

export class Implementer {
  public createSnapshot(planRevisionId: string, promptSequence: number, input: PrepareImplementationInput): ImplementationSnapshot {
    return {
      snapshotId: randomUUID(),
      planRevisionId,
      promptSequence,
      summary: input.summary.trim(),
      changedFiles: input.changedFiles.map((file) => ({ path: file.path.trim(), summary: file.summary.trim() })),
      tests: (input.tests ?? []).map((test) => ({ ...test, command: test.command.trim(), output: test.output })),
      deviations: (input.deviations ?? []).map((value) => value.trim()).filter(Boolean),
      blockers: (input.blockers ?? []).map((value) => value.trim()).filter(Boolean),
      recommendations: (input.recommendations ?? []).map((value) => value.trim()).filter(Boolean),
    };
  }
}

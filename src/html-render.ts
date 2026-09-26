import type {
  ArtifactEnvelope,
  HumanDecision,
  IterationReport,
  PlanRevision,
  QaReport,
  ValidationReport,
} from "./contracts.js";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderList(title: string, values: string[]): string {
  if (!values.length) return "";
  return `<section><h2>${escapeHtml(title)}</h2><ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul></section>`;
}

function renderParagraph(title: string, value: string): string {
  return `<section><h2>${escapeHtml(title)}</h2><p>${escapeHtml(value)}</p></section>`;
}

function renderPreformatted(title: string, value: string): string {
  return `<section><h2>${escapeHtml(title)}</h2><pre>${escapeHtml(value)}</pre></section>`;
}

function renderPromptHistory(plan: PlanRevision): string {
  return `<section><h2>Prompt History</h2><ol>${plan.promptHistory
    .map(
      (prompt) =>
        `<li><strong>#${prompt.sequence}</strong> <time>${escapeHtml(prompt.createdAt)}</time><div>${escapeHtml(prompt.content)}</div></li>`,
    )
    .join("")}</ol></section>`;
}

function renderShell(title: string, sections: string[]): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 2rem; line-height: 1.5; }
      pre { white-space: pre-wrap; background: #f6f8fa; padding: 1rem; border-radius: 6px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #d0d7de; padding: 0.5rem; vertical-align: top; text-align: left; }
      code { background: #f6f8fa; padding: 0.1rem 0.3rem; border-radius: 4px; }
      .meta { color: #57606a; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    ${sections.join("\n")}
  </body>
</html>
`;
}

export function renderPlanHtml(plan: PlanRevision, options?: { artifactId?: string; contentHash?: string; status?: string }): string {
  return renderShell(`Plan Revision ${plan.revisionId}`, [
    options?.artifactId ? `<p class="meta">Artifact: <code>${escapeHtml(options.artifactId)}</code></p>` : "",
    options?.contentHash ? `<p class="meta">Hash: <code>${escapeHtml(options.contentHash)}</code></p>` : "",
    options?.status ? `<p class="meta">Status: ${escapeHtml(options.status)}</p>` : "",
    renderParagraph("Requirement", plan.requirement),
    renderParagraph("Summary", plan.summary),
    renderPromptHistory(plan),
    renderList("Acceptance Criteria", plan.acceptanceCriteria),
    renderList("Implementation Tasks", plan.implementationTasks),
    renderList("Risks", plan.risks),
    renderList("Open Design Decisions", plan.openDesignDecisions),
    renderPreformatted("Plan Body", plan.body),
  ]);
}

export function renderQaHtml(report: ArtifactEnvelope<QaReport>): string {
  return renderShell(`QA Report ${report.artifactId}`, [
    `<p class="meta">Plan Revision: <code>${escapeHtml(report.data.planRevisionId)}</code></p>`,
    `<p class="meta">Implementation Snapshot: <code>${escapeHtml(report.data.snapshotId)}</code></p>`,
    `<p class="meta">Outcome: ${escapeHtml(report.data.outcome)}</p>`,
    renderParagraph("Summary", report.data.summary),
    renderList(
      "Test Results",
      report.data.testResults.map((result) => `${result.command} (${result.outcome})${result.output ? `: ${result.output}` : ""}`),
    ),
    renderList(
      "Defects",
      report.data.defects.map((defect) => `[${defect.severity}] ${defect.title}: ${defect.details}`),
    ),
    renderList("Recommendations", report.data.recommendations),
  ]);
}

export function renderValidationHtml(report: ArtifactEnvelope<ValidationReport>): string {
  const rows = report.data.findings
    .map(
      (finding) =>
        `<tr><td>${escapeHtml(finding.criterion)}</td><td>${escapeHtml(finding.status)}</td><td>${escapeHtml(
          finding.evidence.join("; "),
        )}</td><td>${escapeHtml(finding.details)}</td></tr>`,
    )
    .join("");
  return renderShell(`Validation Report ${report.artifactId}`, [
    `<p class="meta">Plan Revision: <code>${escapeHtml(report.data.planRevisionId)}</code> (${escapeHtml(report.data.planRevisionHash)})</p>`,
    `<p class="meta">Implementation Snapshot: <code>${escapeHtml(report.data.snapshotId)}</code> (${escapeHtml(
      report.data.snapshotHash,
    )})</p>`,
    renderParagraph("Summary", report.data.summary),
    `<section><h2>Findings</h2><table><thead><tr><th>Criterion</th><th>Status</th><th>Evidence</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table></section>`,
    renderList("Unknowns", report.data.unknowns),
    renderList("Risks", report.data.risks),
    renderList("Recommendations", report.data.recommendations),
    renderList("Open Design Decisions", report.data.openDesignDecisions),
  ]);
}

function renderDecision(decision: HumanDecision): string {
  return `<section>
    <h2>Human Decision</h2>
    <p><strong>Route:</strong> ${escapeHtml(decision.route)}</p>
    <p><strong>Rationale:</strong> ${escapeHtml(decision.rationale)}</p>
    <p><strong>Validation:</strong> <code>${escapeHtml(decision.validationArtifactId)}</code> (${escapeHtml(decision.validationHash)})</p>
    <p><strong>Plan Revision:</strong> <code>${escapeHtml(decision.planRevisionId)}</code> (${escapeHtml(decision.planRevisionHash)})</p>
    <p><strong>Snapshot:</strong> <code>${escapeHtml(decision.snapshotId)}</code> (${escapeHtml(decision.snapshotHash)})</p>
  </section>`;
}

export function renderIterationHtml(report: ArtifactEnvelope<IterationReport>): string {
  return renderShell(`Iteration ${report.iteration} Report`, [
    `<p class="meta">Artifact: <code>${escapeHtml(report.artifactId)}</code></p>`,
    `<p class="meta">Workflow: <code>${escapeHtml(report.workflowId)}</code></p>`,
    renderParagraph("Human Prompt", report.data.prompt.content),
    `<section><h2>Plan Revision</h2><p><code>${escapeHtml(report.data.planRevisionId)}</code></p></section>`,
    renderParagraph("Implementation Summary", report.data.implementationSummary),
    renderParagraph("QA Summary", report.data.qaSummary),
    renderParagraph("Validation Summary", report.data.validationSummary),
    renderDecision(report.data.humanDecision),
    renderList("Open Design Decisions", report.data.openDesignDecisions),
    renderList("Remaining Risks", report.data.remainingRisks),
    renderList(
      "Source Artifacts",
      report.data.sourceArtifacts.map(
        (artifact) => `${artifact.kind}: ${artifact.artifactId} (${artifact.contentHash}) @ ${artifact.path}`,
      ),
    ),
  ]);
}

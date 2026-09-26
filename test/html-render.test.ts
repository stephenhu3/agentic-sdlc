import { strict as assert } from "node:assert";
import { test } from "node:test";
import { renderIterationHtml, renderValidationHtml } from "../src/html-render.js";
import type { ArtifactEnvelope, IterationReport, ValidationReport } from "../src/contracts.js";

test("validation and iteration HTML escape hostile agent markup", () => {
  const validation: ArtifactEnvelope<ValidationReport> = {
    artifactId: "11111111-1111-4111-8111-111111111111",
    kind: "validation-report",
    contentHash: "a".repeat(64),
    path: "/tmp/VALIDATION.html",
    workflowId: "22222222-2222-4222-8222-222222222222",
    iteration: 1,
    producer: "validator",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "passed",
    inputs: [],
    data: {
      reportId: "11111111-1111-4111-8111-111111111111",
      planRevisionId: "33333333-3333-4333-8333-333333333333",
      planRevisionHash: "b".repeat(64),
      snapshotId: "44444444-4444-4444-8444-444444444444",
      snapshotHash: "c".repeat(64),
      summary: "<script>alert(1)</script>",
      findings: [
        {
          criterion: "<b>criterion</b>",
          status: "passed",
          evidence: ["<img src=x onerror=alert(1)>"],
          details: "<div>details</div>",
        },
      ],
      unknowns: [],
      risks: [],
      recommendations: [],
      openDesignDecisions: ["<svg onload=alert(1)>"],
    },
  };

  const iteration: ArtifactEnvelope<IterationReport> = {
    artifactId: "55555555-5555-4555-8555-555555555555",
    kind: "iteration-report",
    contentHash: "d".repeat(64),
    path: "/tmp/ITERATION-1.html",
    workflowId: "22222222-2222-4222-8222-222222222222",
    iteration: 1,
    producer: "documenter",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "generated",
    inputs: [],
    data: {
      reportId: "55555555-5555-4555-8555-555555555555",
      prompt: { sequence: 1, content: "<script>prompt</script>", createdAt: "2026-01-01T00:00:00.000Z" },
      planRevisionId: "33333333-3333-4333-8333-333333333333",
      implementationSummary: "<iframe></iframe>",
      qaSummary: "<object></object>",
      validationSummary: "<embed></embed>",
      humanDecision: {
        decisionId: "66666666-6666-4666-8666-666666666666",
        route: "accept_and_document",
        validationArtifactId: validation.artifactId,
        validationHash: validation.contentHash,
        planRevisionId: validation.data.planRevisionId,
        planRevisionHash: validation.data.planRevisionHash,
        snapshotId: validation.data.snapshotId,
        snapshotHash: validation.data.snapshotHash,
        rationale: "<marquee>accept</marquee>",
        acceptedDeviations: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      openDesignDecisions: ["<math>1</math>"],
      remainingRisks: [],
      sourceArtifacts: [],
    },
  };

  const validationHtml = renderValidationHtml(validation);
  const iterationHtml = renderIterationHtml(iteration);
  assert.equal(validationHtml.includes("<script>alert(1)</script>"), false);
  assert.match(validationHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(validationHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(iterationHtml.includes("<iframe></iframe>"), false);
  assert.match(iterationHtml, /&lt;script&gt;prompt&lt;\/script&gt;/);
  assert.match(iterationHtml, /&lt;marquee&gt;accept&lt;\/marquee&gt;/);
});

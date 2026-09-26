# Agentic SDLC Workflow Specification

## Purpose

Define an artifact-driven, human-governed software development workflow coordinated by role-specific agents. Each iteration moves through planning, implementation, QA, business-logic validation, a human decision, and documentation. The workflow must preserve the provenance of decisions and reports, prevent stale evidence from being reused, and never allow an agent to authorize its own handoff or bypass a human gate.

This root-level `PLAN.md` is the system specification. Runtime workflows generate their own `PLAN.html` and related artifacts under `.sdlc/`.

## Operating Principles

- Deterministic workflow code owns state transitions, permissions, artifact validation, and approval gates.
- Agents produce role-scoped artifacts and may recommend next steps, but cannot authorize transitions or make human decisions.
- Every review is tied to an exact plan revision and implementation snapshot.
- QA and Validator run sequentially: Validator starts only after QA passes on the latest implementation snapshot.
- Plan revisions, implementation snapshots, review reports, and iteration reports are immutable. Current views may be regenerated from those records.
- Human approval is explicit and recorded with the exact artifacts and hashes under review.
- Untrusted agent output is rendered as escaped text, never injected as raw HTML.

## Agent Responsibilities

### Planner

Planner creates the high-level plan from the human's initial request and repository context. It produces `PLAN.html` containing:

- Goals, scope, and non-goals.
- Business rules and expected system behavior.
- Acceptance criteria and implementation tasks.
- Dependencies, assumptions, test expectations, and known risks.
- An ordered history of human implementation prompts and plan changes.

The initial plan always pauses for human approval before implementation begins. For later iterations, Planner waits for an explicit human prompt before preparing the next plan. Planner does not initiate work for a future iteration on its own.

### Implementer

Implementer applies the authorized work to the repository using the exact approved plan revision and human prompt. It records:

- Changed files and a concise change summary.
- The plan revision and implementation prompt used as inputs.
- Tests run and results, when applicable.
- Deviations, blockers, and recommendations.
- The identity and content hash of the resulting implementation snapshot.

Implementer cannot approve its own changes or choose the post-validation route. It may prepare a candidate plan revision only after the human explicitly selects plan reconciliation at the validation gate. A candidate revision does not become active until approved by the human.

### QA

QA verifies correctness, regressions, and the behavior of claimed bug fixes against the approved plan and acceptance criteria. It produces a QA report with test commands, evidence, results, and defects. QA may add or run tests but does not patch product code.

If QA finds defects, it hands them to Implementer. Implementer creates a new snapshot, and QA repeats until correctness passes. Validator must not start until QA has passed on the latest snapshot.

### Validator

Validator independently checks whether the latest implementation and system architecture conform to the latest approved `PLAN.html`, business rules, and acceptance criteria. It produces `VALIDATION.html` that:

- Highlights conformance and deviations between the plan and current implementation/system architecture.
- Maps each relevant criterion to implementation evidence.
- Records pass, fail, or blocked findings, unknowns, risks, and recommendations.
- Identifies the exact plan revision and implementation snapshot reviewed.

Validator does not change product code or the plan. A validation result or recommendation is not authorization to act.

### Documenter

After the human accepts validation for an iteration, Documenter creates `ITERATION-<n>.html`, a human-readable overview containing:

- The human prompt and plan revision for the iteration.
- The implementation changes and recommendations from each agent.
- QA evidence and outcomes.
- Validation findings and the human's disposition of deviations.
- Remaining risks and references to the source artifacts.

When the report is persisted, the workflow returns to Planner and waits for the next human prompt.

## Iteration Lifecycle

1. **Plan:** Planner prepares the initial `PLAN.html`. The workflow waits for human approval of that exact plan revision.
2. **Implement:** Implementer applies the approved plan and authorized prompt, then records an implementation snapshot.
3. **QA:** QA tests the snapshot. On failure, defects return to Implementer and the new snapshot returns to QA. Repeat until QA passes.
4. **Validate:** Validator runs only after QA passes. It compares the latest snapshot and system architecture with the latest approved plan and writes `VALIDATION.html`.
5. **Human decision:** The human reviews the validation report and chooses exactly one route:
   - **Accept and document:** Accept this iteration, including explicit acceptance of any remaining deviations, and proceed to Documenter.
   - **Fix implementation:** Authorize Implementer to apply specified or recommended fixes while retaining the current approved plan. The changed implementation returns to QA, then Validator.
   - **Reconcile plan:** Authorize updating the plan to reflect the human-approved implementation or system behavior. Implementer prepares a candidate `PLAN.html` revision. The human reviews and approves that candidate before it becomes the active plan. Any implementation work required by the revised plan proceeds through Implementer, QA, and Validator.
6. **Document:** After validation is accepted, Documenter generates the iteration overview. The workflow then returns to Planner in a waiting-for-human-input state.
7. **Next iteration:** Planner consumes the next explicit human prompt, appends it to the ordered prompt history, and prepares the next plan revision or iteration scope. The workflow does not automatically begin another iteration after documentation.

If a candidate plan revision is rejected, the previously approved plan remains active and unmodified. The workflow returns to the human decision/planning stage. No report, approval, or test result for an older snapshot may be treated as evidence for a newer snapshot.

## Human Approval Gates

Human approval is mandatory for:

- The initial plan before implementation starts.
- Material changes to plan scope, business rules, interfaces, or acceptance criteria.
- Security-sensitive changes involving authentication, authorization, secrets, cryptography, or sensitive data.
- Destructive or external actions, including data deletion, migrations, and production deployment.
- Merge or release.
- The post-validation route selection and any candidate plan revision before it becomes active.

The post-validation decision must be an explicit human action bound to the relevant `VALIDATION.html`, plan revision, and implementation snapshot. Agents cannot infer or substitute that decision based on a pass/fail result or risk score.

Small implementation deviations may proceed only when they do not change approved scope, business logic, interfaces, or acceptance criteria. They must be recorded and presented to Validator and the human for disposition.

## Artifacts and Provenance

Each artifact records, directly or through validated metadata:

- Workflow ID, iteration number, artifact ID, and artifact kind.
- Producer role and creation timestamp.
- Input artifact IDs and content hashes.
- Plan revision and implementation snapshot, where applicable.
- Content hash and status.

Suggested runtime layout:

```text
.sdlc/workflows/<workflow-id>/
  workflow.json
  events.jsonl
  PLAN.html
  plan/revisions/<revision-id>/PLAN.html
  prompts/<sequence>-prompt.json
  iterations/<iteration-number>/
    implementation.json
    QA.html
    VALIDATION.html
    ITERATION-<iteration-number>.html
```

The workflow's current `PLAN.html` is a rendered view of the latest approved plan plus the full chronological prompt/change history. Each approved plan revision remains archived and immutable. Human implementation prompts are preserved in order for review and posterity. Event and decision records are append-only; workflow state updates are atomic. Exact storage names may be adjusted to repository conventions, but immutability, ordering, provenance, and discoverability are required.

HTML reports should be rendered from validated structured data using deterministic templates. Agent-provided content must be escaped. Reports should link to or identify their source artifacts and hashes so a reader can trace every finding.

## Workflow State and Synchronization

The coordinator persists the workflow stage, iteration number, active approved plan revision, current implementation snapshot, latest QA and validation artifacts, pending human decision, and timestamps. Recommended stages include:

- `awaiting_initial_plan_approval`
- `implementing`
- `qa`
- `validation`
- `awaiting_validation_decision`
- `awaiting_plan_revision_approval`
- `documenting`
- `awaiting_next_prompt`
- `blocked`
- `failed`

Every handoff validates expected stage, artifact identity, content hashes, and workflow state version. Stale approvals, reviews, or agent responses are rejected. QA rework creates a new snapshot and invalidates the prior QA/validation evidence for the current state. Work may be retried only under explicit coordinator policy, with attempts and failures recorded in the event history.

## Implementation Scope

The current repository is a planner-only foundation: it generates and persists `PLAN.md`, and workflow state currently distinguishes only `awaiting_approval` and `approved`. Implementing this specification requires extending the contracts, schemas, persistence, and tests to support multiple roles, HTML artifacts, iterations, review loops, and explicit human decisions.

The current Copilot session runner is artifact-only and explicitly forbids tools or file modification. Implementer therefore requires a distinct, explicitly scoped execution capability. Do not silently grant repository write access to artifact-only agent sessions.

Expected areas of change:

- `src/contracts.ts`: workflow states, role outputs, artifact provenance, iteration and decision contracts.
- `src/schema.ts`: validation for workflow states, artifact envelopes, reports, and human decisions.
- `src/planner.ts`: initial plan generation, prompt history, plan revisions, and approval binding.
- `src/persistence.ts`: immutable artifact storage, current plan projection, prompt/event history, and atomic workflow state.
- `src/agent.ts`: preserve artifact-only execution and provide a separate scoped implementation runner.
- `src/index.ts`: export the coordinator and role contracts.
- `test/`: deterministic workflow, artifact, and handoff tests.
- `README.md`: describe roles, artifact paths, lifecycle, and gates.

## Acceptance Criteria

- Initial planning always pauses for approval of the exact plan revision and hash.
- Each human implementation prompt appears in order in the current plan view and in durable history.
- QA runs after each implementation snapshot, repeats until pass, and Validator is never invoked before QA passes on the latest snapshot.
- `VALIDATION.html` identifies the exact approved plan and implementation snapshot and includes evidence for its conformance/deviation findings.
- All three post-validation routes behave as specified; implementation fixes return through QA and Validator, and plan candidates require approval before activation.
- Documenter runs only after validation is accepted, produces a per-iteration overview with correct artifact references, then waits for a new human prompt.
- No agent can mutate workflow state, self-approve, choose the human route, bypass a gate, or silently replace an approved plan.
- Stale artifacts, approvals, and review results cannot be applied to a newer workflow state or implementation snapshot.
- Generated HTML is standalone as required by its presentation context and safely escapes untrusted agent content.

## Verification Plan

1. Add deterministic fake-agent tests for schemas, legal and illegal transitions, approval binding, artifact lineage, ordered prompt history, and stale handoff rejection.
2. Test QA failure and repair cycles, including that each new implementation snapshot is retested and validation waits for QA pass.
3. Test each human decision route and plan revision approval/rejection behavior.
4. Verify that validation compares the expected plan and snapshot, and that prior validation results are not reused after changes.
5. Verify Documenter waits for accepted validation, includes all required iteration information, and returns the workflow to `awaiting_next_prompt`.
6. Render hostile agent-supplied markup and verify it is escaped in `VALIDATION.html` and `ITERATION-<n>.html`.
7. Run `npm test` and `npm run build`.

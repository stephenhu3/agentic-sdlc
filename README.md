# agentic-sdlc

TypeScript foundation for an artifact-driven SDLC workflow built on the GitHub Copilot SDK.

## Setup

```bash
npm install
npm test
npm run build
```

The runtime requires Node.js 20.19+ (or Node.js 22.12+), a Copilot CLI runtime, and
an authenticated Copilot environment. The SDK uses the normal Copilot CLI login by
default; set `COPILOT_CLI_PATH` when using an existing CLI installation.

## Workflow roles

- **Planner** creates immutable plan revisions and the current `PLAN.html` view.
- **Implementer** records repository changes against the approved plan revision and latest human prompt.
- **QA** records deterministic test evidence for each implementation snapshot.
- **Validator** produces `VALIDATION.html` only after QA passes on the latest snapshot.
- **Documenter** produces `ITERATION-<n>.html` after the human accepts validation.

## Workflow lifecycle

`WorkflowCoordinator` enforces the repository workflow:

1. `awaiting_initial_plan_approval`
2. `implementing`
3. `qa`
4. `validation`
5. `awaiting_validation_decision`
6. `awaiting_plan_revision_approval`
7. `documenting`
8. `awaiting_next_prompt`

Human decisions are explicitly bound to the exact plan revision hash, implementation
snapshot hash, and validation artifact hash that were reviewed. Stale evidence is
rejected when the workflow advances to a newer snapshot or version.

## Runtime artifacts

The runtime persists artifacts under `.sdlc/`:

```text
.sdlc/
  workflow.json
  events.jsonl
  PLAN.html
  plan/revisions/<revision-id>/
    artifact.json
    PLAN.html
  prompts/<sequence>-prompt.json
  iterations/<iteration-number>/
    implementation.json
    QA.json
    QA.html
    VALIDATION.json
    VALIDATION.html
    decision.json
    ITERATION-<iteration-number>.json
    ITERATION-<iteration-number>.html
```

All HTML is rendered from validated structured data and escapes untrusted agent output.
Open design decisions can be carried from validation into the final iteration report so a
human can follow up after the iteration is accepted.

## Testing

```bash
npm test
npm run build
```

The tests use injected fake runners, so they validate state transitions, prompt history,
stale-approval rejection, QA/validation sequencing, and HTML escaping without starting a
live Copilot session.

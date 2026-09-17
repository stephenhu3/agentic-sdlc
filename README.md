# agentic-sdlc

TypeScript foundation for an autonomous SDLC workflow built on the GitHub Copilot SDK.

## Setup

```bash
npm install
npm test
npm run build
```

The runtime requires Node.js 20.19+ (or Node.js 22.12+), a Copilot CLI runtime, and
an authenticated Copilot environment. The SDK uses the normal Copilot CLI login by
default; set `COPILOT_CLI_PATH` when using an existing CLI installation.

## Planner vertical slice

`Planner.createPlan(requirement)` starts an isolated Copilot session, validates the
returned Markdown artifact, and atomically persists:

- `.sdlc/artifacts/<artifact-id>/PLAN.md`
- `.sdlc/artifacts/<artifact-id>/metadata.json`
- `.sdlc/workflow.json`

The workflow state is `awaiting_approval` until `Planner.approvePlan()` is called.
The plan front matter includes the requirement, creation timestamp, artifact ID, and
SHA-256 hash of the plan body. The agent runner is injected, so deterministic test
runners can be used without starting Copilot.

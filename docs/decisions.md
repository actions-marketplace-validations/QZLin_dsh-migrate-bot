# Design decisions index

This index links the decisions that constrain later changes and the questions waiting for the owner. The owning document holds the complete decision; this page holds only the link and status, so the index cannot drift from the reasoning.

A new decision adds an entry to the Design decisions section of its owning document and a row here in the same change.

| Decision | Status | Owner document |
|---|---|---|
| A migration consults no model | decided | [Workflow decisions](design/workflow.md#design-decisions) |
| A bump adds target support without raising the plugin's runtime floor | decided | [Workflow decisions](design/workflow.md#design-decisions) |
| A failed migration proposes a draft instead of being repaired | decided | [Workflow decisions](design/workflow.md#design-decisions) |
| The event log on the state branch is the only durable state | decided | [Workflow decisions](design/workflow.md#design-decisions) |
| The checks are keyless and deterministic | decided | [Checks decisions](design/checks.md#design-decisions) |
| The first failing check ends the pass | decided | [Checks decisions](design/checks.md#design-decisions) |
| The Action is a composite Action built from its tag, with no container image | decided | [Release decisions](operations/release.md#design-decisions) |
| Release artifacts and consumer references belong to this fork | decided | [Release decisions](operations/release.md#design-decisions) |
| pnpm is the pinned repository package manager; consumer checks retain release-time npm resolution | decided | [Release decisions](operations/release.md#design-decisions) |
| Documentation is one set of Markdown documents with computed gates, and no generated site | decided | [The tier taxonomy](AGENTS.md#design-decisions) |

Open questions live as design proposals under `docs/proposals/`; decided questions live in the owning document's Design decisions section, and the index records their status.

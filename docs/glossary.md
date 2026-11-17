---
kind: glossary
description: Every project term once: its definition, its name in code and configuration, and the words it replaces.
---

# Glossary

Every document uses these terms as written here and does not redefine them. *Replaces* lists words that meant the same thing in older documents; `scripts/verify-terms.ts` fails when one of them appears in the prose of a Markdown document, `action.yml` or `examples/`, outside code spans and this page.

## Migrations

| Term | Definition | In code and configuration | Replaces |
|---|---|---|---|
| **release** | One `dsh-v*` tag of `deepseek-ai/deepseek-harness`. | `Release{tag, version}` | — |
| **target release** | The release a migration moves the plugin to. | `target` | — |
| **source release** | The release the plugin worked on before: the target of the last verified migration, or the lowest release the plugin's `@deepseek-ai/dsh-*` ranges admit. | `source` | baseline tag |
| **consumer** | A plugin repository that runs the Action. | `GITHUB_REPOSITORY` | consumer plugin repo, plugin repo |
| **plugin** | A directory whose `package.json` declares `dsh.bundle`; a consumer holds one at its root or several below it. | `Plugin`, `findPlugins` | — |
| **bump** | Updating a plugin for the target release: adding target support to its runtime dsh ranges without raising their minimum, moving development dependencies to the target, and optionally raising its own `version` by a patch. | `planBump`, `bump.done` | version bump attempt, minor migrate |
| **bump change** | One manifest field a bump rewrote, with the value before and after. | `BumpChangeEntry`, `BumpChange` | version delta |
| **migration** | One consumer and one target release: the unit of work, identified by the target version. | `migrations/<version>/` | migrate run |
| **check** | One of the three keyless checks of a tree against a release: mechanical, boot, web. A check produces a **check result** with an outcome `pass`, `fail` or `skipped`. | `CheckName`, `CheckResult` | gate stack, verification layer, fast gate |
| **mechanical check** | The dependency contract, the source contract, the plugin shape, and the plugin's own build, typecheck and tests with `@deepseek-ai/dsh-*` pinned to the release. | `mechanical` | — |
| **boot check** | Installing the tree into a temporary profile and starting dsh; it passes when dsh reaches the credential check. | `boot` | boot probe |
| **web check** | Serving a temporary web profile with the plugins mounted, waiting for its ready line, and reading the agent-preset roster. | `web` | web smoke |
| **failure fingerprint** | The normalised first failing line of a check; what the proposal quotes. | `fingerprint` | failure signature |
| **changed tree** | A working tree with changes outside the ignored paths. | `isTreeChanged` | — |
| **ignored paths** | Paths a migration never commits or counts as a change. | `IGNORED_PATHS` | migrate noise |
| **proposal** | The branch, issue and pull request a migration publishes for a changed tree. | `Proposal`, branch `dsh-migrate/proposal` | migrate PR, migration PR, migrate pull request, migration pull request |
| **draft proposal** | A proposal whose checks failed: the pull request is a draft, and says the change is not ready to merge. | `Proposal.draft` | failed migration PR |
| **state branch** | The branch that holds every migration's event log and the badge. | `dsh-migrate/state` | seen.json, seen state |
| **event log** | The append-only events of one migration, from which its state is replayed. | `migrations/<version>/events.jsonl` | — |
| **projection** | What is derived from the event logs: the processed release, the verified release and the open proposal. | `Projection` | watch cursor, seen tag |
| **verified release** | A release a migration needed no change for, or whose proposal a maintainer merged. | `projection.verified` | — |
| **watchdog** | A wall-clock limit on one command or check. | `timeouts.commandMs` | — |

## The repository

| Term | Definition | In code and configuration | Replaces |
|---|---|---|---|
| **rules** | The instructions in `AGENTS.md` that every agent session in this repository follows. | — | standing orders |
| **gate** | A deterministic repository check run by `pnpm run gates`. | `scripts/verify-*.ts` | — |
| **feature catalog** | The table of user-facing capabilities, their entry point, implementation, and owning document. | `docs/features.md` | feature table |
| **design decision** | A binding choice recorded in the Design decisions section of its owning document and linked from `docs/decisions.md`. | Design decisions sections | decision record |
| **design proposal** | An open or parked decision with options, recommendation, acceptance criteria and risks. | `docs/proposals/` | design question |

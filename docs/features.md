# Feature catalog

The user-facing capabilities of the Action. This table is the catalogue of record: each row names the entry point that exercises the feature, the code that implements it, and the document that owns its contract. A change to a feature updates its row and the owning document together.

| ID | Feature | Entry point | Implementation | Owning document |
|---|---|---|---|---|
| F1 | Bump a plugin repository to a harness release, check it, and propose the result | `dsh-migrate bump` / the Action | `src/cli.ts`, `src/workflow/machine.ts` | [Workflow](design/workflow.md#1-decisions) |
| F2 | Add target support to runtime dsh declarations — the dependency blocks and `engines.dsh` — without raising their minimum, move development dependencies to the target, and optionally bump the plugin version | `bump.ownVersion` | `src/domain/bump.ts`, `src/activities/bump.ts` | [Dependency version policy](design/workflow.md#dependency-version-policy) |
| F3 | Run the checks on a working tree without starting a migration | `dsh-migrate check` | `src/activities/check-tree.ts` | [Checks](design/checks.md#the-checks) |
| F4 | Publish a proposal, as a draft when a check failed | the Action | `src/activities/proposal.ts`, `src/github/templates.ts` | [The proposal](design/workflow.md#5-what-a-consumer-sees) |
| F5 | Keep the migration record and the README badge on the state branch | the Action | `src/state/store.ts`, `src/workflow/badge.ts` | [The state branch](design/workflow.md#4-the-state-branch) |
| F6 | Skip a release already processed, and take over an open proposal | `force`, the schedule | `src/workflow/start.ts` | [Starting a migration](design/workflow.md#6-starting-a-migration) |
| F7 | Read the migration state as JSON | `dsh-migrate status` | `src/cli.ts` | [The state branch](design/workflow.md#4-the-state-branch) |
| F8 | Print the validated configuration | `dsh-migrate print-config` | `src/config/load.ts` | [Configuration reference](reference/configuration.md#configuration-reference) |

The catalogue names capabilities, not every function. A new feature adds a row and an entry in [the index](index.md); a removed feature deletes its row.

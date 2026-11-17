# dsh-migrate-bot

A GitHub Action that raises a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin to each new `dsh-v*` release and runs the plugin's own checks. It is a composite Action, consults no model, and repairs nothing: it bumps the versions, runs the checks, and proposes what it tried — as a pull request when the checks pass, and as a draft pull request that says what failed when they do not.

## What it does

For each consumer repository and target release, one migration, which covers the plugin at the repository's root or every plugin below it:

1. adds the target release to the `@deepseek-ai/dsh-*` ranges the plugin runs against without ever raising their minimum, moves development dependencies to the target, and, unless the consumer turns it off, raises each plugin's own `version` by a patch ([dependency version policy](docs/design/workflow.md#dependency-version-policy));
2. runs the [checks](docs/design/checks.md#the-checks) — mechanical (dependency contract, build, typecheck, tests), boot, and web — and stops at the first failure;
3. proposes the changed tree on the branch `dsh-migrate/proposal`, with a pull request and an issue that carry the changed fields and the output of every check. A migration whose checks failed publishes the same proposal as a draft, so the change and its failure are read together.

A newer release takes over the open proposal instead of opening a second one. A repository that a release already leaves alone is skipped, and so is a release whose own proposal is still open. The workflow is specified as a statechart; its states and transitions are in the [workflow reference](docs/reference/workflow.md), and the design is in [docs/design/workflow.md](docs/design/workflow.md).

A failure is reported, never repaired. What a failing check needs is a change to the plugin's own code, and that decision belongs to whoever maintains it: the draft pull request is where they make it.

## Install

A plugin repository adds a workflow that calls this repository's reusable workflow, and optionally a configuration file; [docs/operations/install.md](docs/operations/install.md#the-workflow) has the steps. No secret is needed: the Action uses the workflow's own token.

```yaml
name: dsh-migrate

on:
  schedule:
    - cron: '0 3 * * *'
  workflow_dispatch:

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  dsh-migrate:
    uses: QZLin/dsh-migrate-bot/.github/workflows/migrate.yml@v3
    secrets: inherit
```

Every configuration key is in the [configuration reference](docs/reference/configuration.md).

## The state branch and the badge

The Action keeps its record on the branch `dsh-migrate/state`: one event log per migration, and `badge.json`. Leave the branch unmerged. The badge shows the newest verified release and, when a newer release was processed, what happened to it:

```markdown
[![dsh](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOWNER%2FREPO%2Frefs%2Fheads%2Fdsh-migrate%2Fstate%2Fbadge.json)](https://github.com/OWNER/REPO/tree/dsh-migrate/state)
```

A release is verified by a migration that needed no change, or by a proposal a maintainer merged.

## Run it locally

```sh
pnpm install --frozen-lockfile
pnpm test
node dist/src/cli.js check --workdir /path/to/plugin --target 0.2.0-rc.2
```

`check` runs every check on a working tree without starting a migration or publishing a proposal. `bump` runs a whole migration; pass `--skip-github` so it calls no GitHub API and opens no proposal or issue. It still writes its state branch to the checkout's `origin` when there is one, and keeps it as a local ref when the clone has none. The boot and web checks install the target release from npm into `DSH_MIGRATE_HOME` (default `.dsh-migrate/`), once per release.

The Action is a composite Action: it installs Node and pnpm on the runner, builds itself from the tag's own sources, and runs. No container runtime is needed, and no image has to be published, so a self-hosted runner needs only Node and git.

## Contributing

[AGENTS.md](AGENTS.md) holds the rules for working in this repository, and [docs/index.md](docs/index.md) lists every document. Run `pnpm run gates` and `pnpm test` before pushing.

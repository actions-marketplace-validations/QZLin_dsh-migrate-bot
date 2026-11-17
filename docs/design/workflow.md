# The migration workflow

One migration moves one consumer repository to one target release. It bumps the versions, runs the checks, and proposes what it tried. This document is the design: the decisions behind that shape, the invariants the statechart keeps, what the state branch stores, and when a run starts, skips, or takes over a proposal. The states and transitions themselves are in the [workflow reference](../reference/workflow.md), generated from `src/workflow/machine.ts`.

## 1. Decisions

**A migration consults no model** (*decided*). Why: the migration is a version bump and a test run, and both are deterministic. A model in that loop made the outcome depend on a provider, a prompt, a spend cap and a session that can fail on its own; none of that is needed to answer "does this plugin still work on the new release". Constraint: no session, prompt, spend cap, token trace or repair attempt exists anywhere in the Action, and a failing check is never followed by an edit to the plugin. Revisit when: a class of upgrade turns out to need a change no bump can express and a maintainer asks for one to be attempted automatically.

**The bump and the checks are separate states** (*decided*). Why: the bump writes files and the checks read them, so a failure has a location — the bump, or one check — and the event log says which. A single activity would report "migration failed" without saying whether the version was even raised. Constraint: `bumping` publishes nothing; `checking` writes nothing; only `publishing` touches the remote.

**A failed migration still proposes** (*decided*). Why: a maintainer who has to reproduce the bump by hand before reading the failure pays for the same work twice, and the failing output only makes sense beside the diff that produced it. Constraint: the proposal of a failed migration is a **draft**, its title and body say the checks fail, and the migration ends `awaitingMerge`, not `failed`: the job succeeded at reporting. A migration that changed nothing and failed has nothing to propose, and ends `failed`.

**The plugin's own version moves too** (*decided*, opt-out). Why: a consumer who merges the proposal releases the plugin, and a release whose version did not move cannot be published. Constraint: `bump.ownVersion` raises `version` by a patch; it is skipped for a manifest whose `version` is not a release.

**One interpretation of state, on the state branch** (*decided*). Why: the Action has no database, runs in jobs that GitHub can cancel, and must answer the same after a retry. Constraint: the event log is the only durable record; everything a reader sees — the processed release, the verified release, the open proposal, the badge — is projected from it ([the state branch](#4-the-state-branch)).

## 2. The shape

`bumping` applies the dependency version policy below and, when asked, raises each plugin version. `checking` runs the enabled checks in order and stops at the first failure, because a later check would report the consequence of the earlier one. `concluding` inspects the tree once and decides: a changed tree with publishing on becomes a proposal; a changed tree with publishing off ends `unpublished`; an unchanged tree that failed ends `failed`; an unchanged tree that passed ends `compatible`. `publishing` pushes the branch and opens or updates the issue and the pull request. `awaitingMerge` waits for the maintainer, and its close moves the migration to `accepted` or `rejected`.

The scope is the repository, not a plugin: a consumer holding several plugins gets one migration, one proposal and one bump event that names every manifest it touched.

### Dependency version policy

Only `devDependencies` states what the plugin is developed and validated against: a dsh dependency there moves to `^<target>`. The other three blocks state what the plugin runs against, so their minimum is the floor the plugin supports and a migration never raises it.

`peerDependencies`, `dependencies` and `optionalDependencies` take the same treatment: a range that already admits the target stays unchanged, and one that does not gains a ` || ^<target>` branch. The original range and its exclusions remain intact, so supporting a new target never drops a release the plugin already declared.

For a plugin developed and deployed on `0.2.2-rc.1`, an attempt against `0.2.2-rc.3` can produce:

```json
{
  "peerDependencies": {
    "@deepseek-ai/dsh-agent": "0.2.2-rc.1 || ^0.2.2-rc.3"
  },
  "dependencies": {
    "@deepseek-ai/dsh-agent": "0.2.2-rc.1 || ^0.2.2-rc.3"
  },
  "devDependencies": {
    "@deepseek-ai/dsh-agent": "^0.2.2-rc.3"
  }
}
```

A pre-existing `^0.2.2-rc.1` range already admits `rc.3` and is left as written. Prereleases from a different version cohort need an explicit additional branch by npm's rules. An unrestricted range is spelled as `>=0.0.0-0` before adding a prerelease branch, because npm otherwise collapses `* || ^<prerelease>` to `*` and discards the target. Non-registry references and packages outside `@deepseek-ai/dsh-*` are untouched.

The target is the version used by the checks, not a request to upgrade the deployed harness: the checks install it explicitly (`src/mechanical/peers.ts`), so validating against the target does not depend on the declared ranges. The proposal says so and asks the maintainer to check that deployment's peer requirements before merging. Widening a declaration does not re-test every historical runtime or prove a source-code migration is backward compatible; this Action changes no plugin source. A manifest whose floor was already raised by an earlier version of this tool is not silently rewritten: that would assert support the plugin may no longer have. The maintainer restores evidence-backed support once, and later bumps retain it.

## 3. Invariants

Each holds on every run, and `tests/unit/workflow-machine.test.ts` drives random runs to check it:

- **I1** a migration bumps exactly once, before anything else;
- **I2** it publishes at most once, and only from a changed tree with publishing on;
- **I3** the proposal is a draft exactly when a check failed before it;
- **I4** a pass of checks stops at its first failure;
- **I5** a migration that concludes without publishing ends `compatible` only when nothing failed, and `failed` only when something did;
- **I6** a merged proposal verifies its release, and a closed one does not.

An `activity.error` ends the migration in `error` from any state, whatever it was doing.

## 4. The state branch

The branch `dsh-migrate/state` holds `migrations/<version>/events.jsonl` per migration and `badge.json`. The log is the record: one `started` entry naming the input, then one entry per event. It is written with git plumbing and never checked out, so the plugin's working tree is untouched, and it is pushed right after every effect that leaves the job, so a cancelled job loses at most work whose effects stayed inside it.

Nothing else is stored. The processed release, the verified release and the open proposal are recomputed from the logs on every read, so they cannot disagree with them. A release counts as verified when a migration for it ended `compatible` or its proposal was merged.

## 5. What a consumer sees

The proposal is one branch, `dsh-migrate/proposal`, force-pushed, with one issue and one pull request that carry the changed fields, the output of the check that failed, and the working-tree diff. Both bodies carry a hidden marker, so a retry finds what a previous attempt created instead of opening a second one. The pull request is a draft when its checks failed. A reused pull request changes draft state through GitHub's `convertPullRequestToDraft` or `markPullRequestReadyForReview` mutation; its actual state is read before conversion, so retrying does not convert it twice.

The branch carries the default branch's `.github/workflows/` as it stands when the proposal is pushed: GitHub refuses a push by a token without the `workflows` permission when the branch's workflow files differ from the default branch's, and the default branch can change them while the migration runs. A workflow change the bump made itself is left out the same way, and the proposal says so.

## 6. Starting a migration

The decision happens before a migration exists, so it is not part of the statechart and a skipped run leaves no log ([`decideStart`](../../src/workflow/start.ts)):

- a release already processed is skipped, unless the run is forced;
- a release whose own proposal is open is skipped even when forced: the new run would replace the log that holds the proposal, and a run that did not publish would leave the pull request open with no migration behind it;
- a newer release takes over the open proposal — same branch, same issue, same pull request — unless a maintainer has committed to it, which a force-push would discard.

The close of a proposal's pull request normally arrives as its own event. A job that failed, or that GitHub cancelled while another of the concurrency group waited, delivers it late: every run first asks GitHub whether the open proposal's pull request is still open, and delivers the close when it is not.

## 7. Reporting a failure

A failure is reported where it happened and left there. The check's output is bounded and kept in the proposal (the full log stays in the run directory), the step summary names the failing check, and the badge shows the release as `failed` when nothing was proposed. The Action does not retry, does not edit the plugin, and does not open a second issue: making a failing check pass is the maintainer's change, made on the draft.

## Design decisions

- **A bump adds target support without ever raising the plugin's runtime floor** (*decided*). Why: a maintainer may validate against a newer harness while users still deploy an older supported one, and only they can decide that an old release stopped working. Constraint: `peerDependencies`, `dependencies` and `optionalDependencies` keep their minimum and gain the target only when it did not admit it; only `devDependencies` moves to the target; widening does not deploy a harness or repair sources. The [dependency version policy](#dependency-version-policy) owns the exact range rules. Revisit when: the owner explicitly requests a support-policy change that drops older runtimes.

- **A migration consults no model** (*decided*). Why: the work is a version bump plus the plugin's own checks, and both are deterministic; a model in that loop made the outcome depend on a provider, a prompt, a spend cap and a session that could fail on its own. Constraint: no session, prompt, spend cap or repair attempt exists in the Action, and a failing check is never followed by an edit to the plugin. Revisit when: an upgrade needs a change no bump can express and the owner asks for one to be attempted automatically.
- **A failed migration proposes a draft** (*decided*). Why: the failing output only means something beside the diff that produced it, and reproducing the bump by hand to read it is work the Action already did. Constraint: the proposal is a draft, says the checks fail, and the migration ends `awaitingMerge`; only a migration that changed nothing and failed ends `failed`.
- **The event log on the state branch is the only durable state** (*decided*). Why: jobs are cancelled and retried, and the Action has no database; one append-only log replayed by the statechart answers the same every time. Constraint: no other persisted file carries a fact a reader needs, and the badge is derived, not written by hand.

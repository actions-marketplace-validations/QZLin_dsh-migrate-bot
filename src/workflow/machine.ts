import { assign, setup } from 'xstate'
import type {
  BumpChangeEntry,
  CheckName,
  CheckResult,
  MigrationEvent,
  MigrationInput,
  Proposal,
  Settings,
} from './model.ts'

/**
 * The migration workflow, as a statechart.
 *
 * This machine is the specification: every state, every event it accepts, and
 * every activity it asks for is declared here and nowhere else. It performs no
 * I/O. A state that needs work done declares one `run` entry action whose
 * parameters name the activity; the engine executes it and sends the result
 * back as an event. `docs/reference/workflow.md` is generated from this file.
 *
 * A migration is deterministic: it bumps the plugin to the target release, runs
 * the checks, and publishes what it tried. Nothing here consults a model, so a
 * failure is reported where it happened and left to the maintainer.
 */

export type ActivityRequest =
  | { activity: 'bump' }
  | { activity: 'check'; check: CheckName; release: 'target' }
  | { activity: 'inspectTree' }
  | { activity: 'publishProposal'; draft: boolean }

export interface MigrationContext {
  input: MigrationInput
  /** Checks still to run in the current pass, in order. */
  queue: CheckName[]
  /** Every field the bump changed, across every plugin of the repository. */
  changes: BumpChangeEntry[]
  /** One line saying what the bump did, for the log and the proposal. */
  bumpDetail: string
  /** The check that failed, when one did. */
  failure: CheckResult | undefined
  warnings: string[]
  proposal: Proposal | undefined
  /** Whether the proposal was merged. */
  merged: boolean
  /** Where the migration ends once the tree has been inspected: the state it concluded in. */
  concluded: 'compatible' | 'unpublished' | 'awaitingMerge' | undefined
}

/** The checks one pass runs, in order. A disabled check is left out. */
export function checksFor(settings: Settings): CheckName[] {
  return [
    'mechanical' as const,
    ...(settings.checks.boot ? ['boot' as const] : []),
    ...(settings.checks.web ? ['web' as const] : []),
  ]
}

type Guard = (args: { context: MigrationContext; event: MigrationEvent }) => boolean

/** What each guard means; `docs/reference/workflow.md` prints this table. */
export const GUARD_DESCRIPTIONS = {
  queueEmpty: 'Every check of the pass has run.',
  checkFailed: 'The check failed.',
  changedAndPublish: 'The tree changed and publishing is on.',
  changed: 'The tree changed.',
  failureRecorded: 'A check failed, so the migration has nothing verified to propose.',
  concludedIn: 'The migration concluded in the given state.',
  proposalMerged: 'The closed pull request is this proposal, and it was merged.',
  proposalClosed: 'The closed pull request is this proposal.',
  proposalMergedNow: 'The closed pull request is this proposal, it was merged, and no merge was recorded yet.',
  proposalClosedOpen: 'The closed pull request is this proposal, and no merge was recorded yet.',
} as const

const checkFailed: Guard = ({ event }) => event.type === 'check.done' && event.result.outcome === 'fail'

export const migrationMachine = setup({
  types: {
    context: {} as MigrationContext,
    events: {} as MigrationEvent,
    input: {} as MigrationInput,
  },
  actions: {
    /** Ask the engine for one activity. The body is empty: the engine reads the parameters. */
    run: (_, _params: ActivityRequest) => {},
  },
  guards: {
    queueEmpty: ({ context }) => context.queue.length === 0,
    checkFailed,
    changedAndPublish: ({ context, event }) => event.type === 'tree.inspected' && event.changed
      && context.input.settings.publish,
    changed: ({ event }) => event.type === 'tree.inspected' && event.changed,
    failureRecorded: ({ context }) => context.failure !== undefined,
    concludedIn: ({ context }, params: { state: NonNullable<MigrationContext['concluded']> }) => context.concluded === params.state,
    proposalMerged: ({ context, event }) => event.type === 'pull-request.closed' && event.merged
      && event.number === context.proposal?.pullRequest.number,
    proposalClosed: ({ context, event }) => event.type === 'pull-request.closed'
      && event.number === context.proposal?.pullRequest.number,
    proposalMergedNow: ({ context, event }) => !context.merged && event.type === 'pull-request.closed' && event.merged
      && event.number === context.proposal?.pullRequest.number,
    proposalClosedOpen: ({ context, event }) => !context.merged && event.type === 'pull-request.closed'
      && event.number === context.proposal?.pullRequest.number,
  },
}).createMachine({
  id: 'migration',
  context: ({ input }) => ({
    input,
    queue: [],
    changes: [],
    bumpDetail: '',
    failure: undefined,
    warnings: [],
    proposal: undefined,
    merged: false,
    concluded: undefined,
  }),
  initial: 'start',
  on: {
    'activity.error': { target: '.error' },
  },
  states: {
    start: {
      always: { target: 'bumping' },
    },
    bumping: {
      description: 'Add target support to runtime dsh ranges without raising their minimum, move development dependencies to the target, and optionally raise each plugin version.',
      entry: { type: 'run', params: { activity: 'bump' } },
      on: {
        'bump.done': {
          target: 'checking',
          actions: assign({
            changes: ({ event }) => event.changes,
            bumpDetail: ({ event }) => event.detail,
          }),
        },
      },
    },
    checking: {
      description: 'One pass of checks on the bumped tree; the first failure ends it.',
      entry: assign({ queue: ({ context }) => checksFor(context.input.settings) }),
      initial: 'next',
      states: {
        next: {
          always: [
            { guard: 'queueEmpty', target: '#migration.concluding' },
            { target: 'running' },
          ],
        },
        running: {
          description: 'Run the next check of the pass.',
          entry: {
            type: 'run',
            params: ({ context }) => ({ activity: 'check', check: context.queue[0] as CheckName, release: 'target' }),
          },
          on: {
            'check.done': [
              {
                guard: 'checkFailed',
                target: '#migration.concluding',
                actions: assign({ failure: ({ event }) => event.result }),
              },
              { target: 'next', actions: assign({ queue: ({ context }) => context.queue.slice(1) }) },
            ],
          },
        },
      },
    },
    concluding: {
      description: 'Decide what the tree that came out of the checks becomes: a proposal, a local change, or nothing.',
      entry: { type: 'run', params: { activity: 'inspectTree' } },
      on: {
        'tree.inspected': [
          { guard: 'changedAndPublish', target: 'publishing' },
          { guard: 'changed', target: 'concluded', actions: assign({ concluded: 'unpublished' }) },
          // Nothing changed, and a check failed: the tree needs a change this
          // Action does not make, so the migration ends without a proposal.
          { guard: 'failureRecorded', target: 'failed' },
          { target: 'concluded', actions: assign({ concluded: 'compatible' }) },
        ],
      },
    },
    publishing: {
      description: 'Push the proposal branch and open or update the issue and the pull request, as a draft when a check failed.',
      entry: {
        type: 'run',
        params: ({ context }) => ({ activity: 'publishProposal', draft: context.failure !== undefined }),
      },
      on: {
        'proposal.published': {
          target: 'settled',
          actions: assign({ proposal: ({ event }) => event.proposal, concluded: 'awaitingMerge' }),
        },
      },
    },
    concluded: {
      always: { target: 'settled' },
    },
    settled: {
      always: [
        { guard: { type: 'concludedIn', params: { state: 'awaitingMerge' } }, target: 'awaitingMerge' },
        { guard: { type: 'concludedIn', params: { state: 'unpublished' } }, target: 'unpublished' },
        { target: 'compatible' },
      ],
    },
    awaitingMerge: {
      description: 'Wait for the maintainer to merge, close, or replace the proposal.',
      on: {
        'pull-request.closed': [
          { guard: 'proposalMerged', target: 'accepted', actions: assign({ merged: true }) },
          { guard: 'proposalClosed', target: 'rejected' },
        ],
        'proposal.superseded': { target: 'superseded' },
      },
    },
    compatible: { type: 'final', description: 'The bumped tree passes every check, and nothing changed, so there is nothing to propose.' },
    unpublished: { type: 'final', description: 'The tree changed and publishing is turned off.' },
    failed: { type: 'final', description: 'A check failed and the bump changed nothing, so there is nothing to propose.' },
    accepted: { type: 'final', description: 'The proposal was merged.' },
    rejected: { type: 'final', description: 'The proposal was closed without merging.' },
    superseded: { type: 'final', description: 'A later migration took over the proposal.' },
    error: { type: 'final', description: 'An activity failed for a reason outside the plugin.' },
  },
})

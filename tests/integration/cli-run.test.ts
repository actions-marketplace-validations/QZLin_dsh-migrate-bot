import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import semver from 'semver'
import { appRootFrom } from '../../src/paths.ts'
import { StateStore } from '../../src/state/store.ts'
import { checkout } from '../support/repository.ts'
import { FakeGitHub } from '../support/github.ts'
import { serve } from '../support/serve.ts'

/**
 * The whole CLI, end to end: one run bumps the plugin, checks it and proposes
 * the result, and the next run reconciles the merged proposal. GitHub is the
 * in-memory fake served over HTTP, the state branch is a real git remote, and
 * `npm` is a stub, so nothing reaches the network and no model is consulted.
 */

const CLI = join(appRootFrom(import.meta.url), 'dist', 'src', 'cli.js')

function run(args: string[], env: Record<string, string>): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.on('close', (status) => { resolve({ status, output }) })
  })
}

/**
 * An offline `npm` on PATH. The shell that runs a mechanical command is `sh` on
 * Linux and `cmd.exe` on Windows, so both names are written: the stub installs
 * nothing either way.
 */
function stubNpm(bin: string): void {
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  writeFileSync(join(bin, 'npm.cmd'), '@exit /b 0\r\n')
}

/** A plugin checkout wired to the fake GitHub, with an offline `npm` and a test command. */
function prepare(testCommand: string, extraFiles: Record<string, string> = {}) {
  const repo = checkout({
    'package.json': JSON.stringify({
      name: '@acme/plugin',
      version: '1.0.0',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
      peerDependencies: { '@deepseek-ai/dsh-agent': '^0.1.7' },
    }, null, 2) + '\n',
    'cordis.patch.yml': '[]\n',
    'index.js': 'export const apply = () => {}\n',
    ...extraFiles,
  })
  mkdirSync(join(repo.work, '.github'))
  writeFileSync(join(repo.work, '.github', 'dsh-migrate.yml'), [
    'checks:',
    '  boot:',
    '    enabled: false',
    '  web:',
    '    enabled: false',
    'tests:',
    '  commands:',
    // Quoted, so YAML keeps it a string: `true` alone is a boolean.
    `    - "${testCommand}"`,
    '',
  ].join('\n'))
  repo.git(['add', '-A'])
  repo.git(['commit', '--quiet', '-m', 'config'])
  repo.git(['push', '--quiet', 'origin', 'HEAD:main'])
  // `node_modules` is present so the mechanical check installs nothing.
  mkdirSync(join(repo.work, 'node_modules'))
  const bin = join(repo.work, '..', 'bin')
  stubNpm(bin)
  const output = join(repo.work, '..', 'github-output')
  writeFileSync(output, '')
  return { repo, bin, output }
}

function environment(repo: { work: string }, bin: string, output: string, apiUrl: string): Record<string, string> {
  // A command runs through the platform's shell, so PATH needs that platform's
  // separator; the stub directory comes first either way.
  const delimiter = process.platform === 'win32' ? ';' : ':'
  return {
    PATH: [bin, process.env.PATH ?? ''].join(delimiter),
    HOME: process.env.HOME ?? '',
    DSH_MIGRATE_HOME: join(repo.work, '..', 'home'),
    GITHUB_TOKEN: 'gh-token',
    GITHUB_REPOSITORY: 'acme/plugin',
    GITHUB_API_URL: apiUrl,
    GITHUB_OUTPUT: output,
  }
}

test('a run bumps the plugin, checks it and proposes the result, and the next run reconciles the merge', async () => {
  const github = new FakeGitHub('acme/plugin')
  const server = await serve(github.fetch)
  const { repo, bin, output } = prepare('true')
  try {
    const env = environment(repo, bin, output, server.url)

    const bumped = await run(['bump', '--workdir', repo.work, '--target', '0.2.0'], env)
    assert.equal(bumped.status, 0, bumped.output)
    assert.match(readFileSync(output, 'utf8'), /status=proposed/)
    const pull = [...github.pulls.values()][0]
    assert.equal(pull?.head.ref, 'dsh-migrate/proposal')
    assert.equal(pull?.draft, false)
    // The proposal carries the bump: the dsh peer range and the plugin's own version.
    const manifest = JSON.parse(repo.git(['show', 'dsh-migrate/proposal:package.json'], repo.remote)) as {
      version: string
      peerDependencies: Record<string, string>
    }
    assert.equal(manifest.version, '1.0.1')
    assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-agent'], '^0.1.7 || ^0.2.0')
    const issue = [...github.issues.values()][0]
    assert.match(issue?.body ?? '', /Source release: `dsh-v0\.1\.7` \(declared-peers\)/)
    assert.match(issue?.body ?? '', /peerDependencies\.@deepseek-ai\/dsh-agent: `\^0\.1\.7` → `\^0\.1\.7 \|\| \^0\.2\.0`/)

    const skipped = await run(['bump', '--workdir', repo.work, '--target', '0.2.0'], env)
    assert.equal(skipped.status, 0)
    assert.match(skipped.output, /skipped \(unchanged-release\)/)

    // The merge's own job never ran: the next run finds the pull request merged.
    Object.assign(pull ?? {}, { state: 'closed', merged: true })
    const merged = await run(['bump', '--workdir', repo.work, '--target', '0.2.0'], env)
    assert.equal(merged.status, 0, merged.output)
    assert.match(merged.output, /was merged without its event reaching this Action/)

    const log = new StateStore(repo.clone()).read().logs.get('0.2.0') ?? []
    assert.deepEqual(log.filter(entry => entry.kind === 'event').map(entry => entry.kind === 'event' ? entry.event.type : ''), [
      'bump.done', 'check.done', 'tree.inspected', 'proposal.published', 'pull-request.closed',
    ])
    assert.match(repo.git(['show', 'dsh-migrate/state:badge.json'], repo.remote), /"message": "dsh-v0\.2\.0"/)
  } finally {
    await server.close()
    repo.cleanup()
  }
})

test('a prerelease proposal tests rc.3 without excluding a deployed rc.1 or changing plugin sources', async () => {
  const source = '0.2.2-rc.1'
  const target = '0.2.2-rc.3'
  const dependency = '@deepseek-ai/dsh-agent'
  const semverPath = createRequire(import.meta.url).resolve('semver')
  const compatibilityTest = `const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const semver = require(${JSON.stringify(semverPath)})
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const range = manifest.peerDependencies[${JSON.stringify(dependency)}]
assert.equal(semver.satisfies(${JSON.stringify(source)}, range, { includePrerelease: true }), true, 'the deployed runtime must stay supported')
assert.equal(semver.satisfies(process.env.DSH_MIGRATE_TARGET_VERSION, range), true, 'the validation target must be admitted')
assert.equal(manifest.devDependencies[${JSON.stringify(dependency)}], '^' + process.env.DSH_MIGRATE_TARGET_VERSION)
`
  const github = new FakeGitHub('acme/plugin')
  const server = await serve(github.fetch)
  const { repo, bin, output } = prepare('node compatibility-test.cjs', {
    'package.json': JSON.stringify({
      name: '@acme/plugin', version: '1.0.1', type: 'module',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
      peerDependencies: { [dependency]: source },
      dependencies: { [dependency]: source },
      devDependencies: { [dependency]: source },
    }, null, 2) + '\n',
    'compatibility-test.cjs': compatibilityTest,
  })
  try {
    const result = await run(['bump', '--workdir', repo.work, '--target', target], environment(repo, bin, output, server.url))
    assert.equal(result.status, 0, result.output)
    const pull = [...github.pulls.values()][0]
    assert.equal(pull?.draft, false, result.output)
    const manifest = JSON.parse(repo.git(['show', 'dsh-migrate/proposal:package.json'], repo.remote)) as {
      version: string; peerDependencies: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string>
    }
    assert.equal(manifest.version, '1.0.2')
    assert.equal(manifest.peerDependencies[dependency], `${source} || ^${target}`)
    assert.equal(manifest.dependencies[dependency], `${source} || ^${target}`)
    for (const block of [manifest.peerDependencies, manifest.dependencies]) {
      const range = block[dependency] as string
      assert.equal(semver.minVersion(range)?.version, source, 'the supported floor must not rise')
      assert.equal(semver.satisfies(source, range, { includePrerelease: true }), true)
      assert.equal(semver.satisfies(target, range), true)
    }
    assert.equal(manifest.devDependencies[dependency], `^${target}`)
    assert.equal(repo.git(['diff', '--name-only', 'main', 'dsh-migrate/proposal'], repo.remote), 'package.json')
    assert.equal(repo.git(['show', 'dsh-migrate/proposal:index.js'], repo.remote), 'export const apply = () => {}')
    const issue = [...github.issues.values()][0]
    assert.match(issue?.body ?? '', /Source release: `dsh-v0\.2\.2-rc\.1`/)
    assert.match(pull?.body ?? '', /0\.2\.2-rc\.1 \|\| \^0\.2\.2-rc\.3/)
    assert.match(pull?.body ?? '', /does not upgrade your deployed harness/)
  } finally {
    await server.close()
    repo.cleanup()
  }
})

test('a failing check proposes a draft that says what failed, and repairs nothing', async () => {
  const github = new FakeGitHub('acme/plugin')
  const server = await serve(github.fetch)
  // A test the plugin declares that fails, in a file so no shell quoting is involved.
  const { repo, bin, output } = prepare('node fail.js', { 'fail.js': "console.error('error: boom')\nprocess.exit(1)\n" })
  try {
    const env = environment(repo, bin, output, server.url)
    const failed = await run(['bump', '--workdir', repo.work, '--target', '0.2.0'], env)
    assert.equal(failed.status, 0, failed.output)
    const pull = [...github.pulls.values()][0]
    assert.equal(pull?.draft, true)
    assert.match(pull?.body ?? '', /this pull request is a draft/)
    assert.match(pull?.body ?? '', /boom/)
    // The plugin's own sources are untouched: the Action reports the failure, it does not repair it.
    assert.equal(repo.git(['show', 'dsh-migrate/proposal:index.js'], repo.remote), 'export const apply = () => {}')
  } finally {
    await server.close()
    repo.cleanup()
  }
})

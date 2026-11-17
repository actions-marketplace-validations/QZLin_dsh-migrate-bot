import { test } from 'node:test'
import assert from 'node:assert/strict'
import semver from 'semver'
import fc from 'fast-check'
import { planBump, formatManifest, rangeFor } from '../../src/domain/bump.ts'
import { checkDependencyContract } from '../../src/mechanical/dependencies.ts'
import { declaredRelease } from '../../src/domain/release.ts'

const PACKAGE = '@deepseek-ai/dsh-agent'
const MANIFEST = {
  name: '@acme/plugin',
  version: '1.4.2',
  peerDependencies: { '@deepseek-ai/dsh-cli': '^0.1.7', react: '^18' },
  dependencies: { '@deepseek-ai/dsh-llm': '>=0.1.0 <0.2', '@deepseek-ai/dsh-local': 'workspace:*' },
  devDependencies: { [PACKAGE]: '~0.1.7', typescript: '^5' },
}

test('only development dependencies move to the target; runtime ranges keep their minimum', () => {
  const plan = planBump(MANIFEST, '0.2.0', { ownVersion: false })
  assert.deepEqual(plan.changes.map(change => `${change.field}: ${change.from} -> ${change.to}`), [
    `peerDependencies.@deepseek-ai/dsh-cli: ^0.1.7 -> ^0.1.7 || ${rangeFor('0.2.0')}`,
    `dependencies.@deepseek-ai/dsh-llm: >=0.1.0 <0.2 -> >=0.1.0 <0.2 || ${rangeFor('0.2.0')}`,
    `devDependencies.${PACKAGE}: ~0.1.7 -> ${rangeFor('0.2.0')}`,
  ])
  assert.deepEqual(plan.manifest?.peerDependencies, { '@deepseek-ai/dsh-cli': '^0.1.7 || ^0.2.0', react: '^18' })
  // A workspace reference is not a registry range and is left alone.
  assert.deepEqual(plan.manifest?.dependencies, { '@deepseek-ai/dsh-llm': '>=0.1.0 <0.2 || ^0.2.0', '@deepseek-ai/dsh-local': 'workspace:*' })
  assert.equal(plan.manifest?.version, '1.4.2')
  assert.equal(semver.minVersion('>=0.1.0 <0.2 || ^0.2.0')?.version, '0.1.0')
})

test('the rc.1 to rc.3 bump preserves the deployed runtime while upgrading development dependencies', () => {
  const source = '0.2.2-rc.1'
  const target = '0.2.2-rc.3'
  const original = {
    name: '@acme/plugin',
    version: '1.0.1',
    peerDependencies: { [PACKAGE]: source },
    devDependencies: { [PACKAGE]: source },
  }
  const plan = planBump(original, target, { ownVersion: true })
  const manifest = plan.manifest
  assert.ok(manifest !== undefined)
  const peers = manifest.peerDependencies as Record<string, string>
  const range = peers[PACKAGE] as string
  assert.equal(range, `${source} || ^${target}`)
  assert.equal(semver.satisfies(source, range, { includePrerelease: true }), true, 'the deployed rc.1 must not be rejected')
  assert.equal(semver.satisfies(target, range), true, 'the target must pass the npm dependency contract')
  assert.equal(semver.minVersion(range)?.version, source)
  assert.deepEqual(manifest.devDependencies, { [PACKAGE]: `^${target}` })
  assert.equal(manifest.version, '1.0.2')
  assert.equal(declaredRelease(manifest)?.version, source)
  assert.deepEqual(checkDependencyContract(manifest, target, () => [source, target]), [])
  assert.deepEqual(checkDependencyContract({ peerDependencies: peers }, source, () => [source, target]), [])
  assert.deepEqual(original.peerDependencies, { [PACKAGE]: source }, 'planning must not mutate the original manifest')
})

test('a peer that already accepts the target stays unchanged, including its runtime minimum', () => {
  const range = '^0.2.2-rc.1'
  const target = '0.2.2-rc.3'
  const plan = planBump({ peerDependencies: { [PACKAGE]: range }, devDependencies: { [PACKAGE]: '0.2.2-rc.1' } }, target, { ownVersion: false })
  assert.deepEqual(plan.manifest?.peerDependencies, { [PACKAGE]: range })
  assert.deepEqual(plan.manifest?.devDependencies, { [PACKAGE]: `^${target}` })
  assert.deepEqual(plan.changes, [{ field: `devDependencies.${PACKAGE}`, from: '0.2.2-rc.1', to: `^${target}` }])
})

test('peer expansion preserves existing disjoint constraints across prerelease cohorts', () => {
  const range = '>=0.1.0-rc.8 <0.1.1 || ^0.1.2-alpha.1'
  const target = '0.2.0-rc.3'
  const plan = planBump({ peerDependencies: { [PACKAGE]: range } }, target, { ownVersion: false })
  const expanded = plan.changes[0]?.to
  assert.equal(expanded, `${range} || ^${target}`)
  assert.ok(expanded !== undefined)
  for (const supported of ['0.1.0-rc.8', '0.1.0', '0.1.2-alpha.1', '0.1.2']) {
    assert.equal(semver.satisfies(supported, expanded), true)
  }
  assert.equal(semver.satisfies('0.1.1-rc.1', expanded), false, 'a gap in old support must not be filled in')
  assert.equal(semver.satisfies(target, expanded), true)
})

test('unrestricted peers retain old runtime support and explicitly admit prerelease targets', () => {
  const target = '0.2.2-rc.3'
  for (const range of ['*', 'x', '>=0.0.0']) {
    const plan = planBump({ peerDependencies: { [PACKAGE]: range } }, target, { ownVersion: false })
    const expanded = plan.changes[0]?.to
    assert.equal(expanded, `>=0.0.0-0 || ^${target}`)
    assert.ok(expanded !== undefined)
    for (const old of ['0.0.0', '0.0.1', '9.0.0']) assert.equal(semver.satisfies(old, expanded), true)
    for (const old of ['0.0.0-0', '0.1.0-alpha.1', '9.0.0-rc.1']) {
      assert.equal(semver.satisfies(old, expanded, { includePrerelease: true }), true)
    }
    assert.equal(semver.satisfies(target, expanded), true)
    assert.deepEqual(checkDependencyContract(plan.manifest, target, () => [target]), [])
  }
})

test('optional peers follow the same compatibility rule without losing their metadata', () => {
  const meta = { [PACKAGE]: { optional: true } }
  const plan = planBump({ peerDependencies: { [PACKAGE]: '0.2.2-rc.1' }, peerDependenciesMeta: meta }, '0.2.2-rc.3', { ownVersion: false })
  assert.deepEqual(plan.manifest?.peerDependencies, { [PACKAGE]: '0.2.2-rc.1 || ^0.2.2-rc.3' })
  assert.deepEqual(plan.manifest?.peerDependenciesMeta, meta)
})

test('adding peer support is idempotent and successive targets retain every earlier branch', () => {
  const original = { peerDependencies: { [PACKAGE]: '0.2.2-rc.1' } }
  const first = planBump(original, '0.2.2-rc.3', { ownVersion: false }).manifest
  assert.ok(first !== undefined)
  assert.deepEqual(planBump(first, '0.2.2-rc.3', { ownVersion: false }).changes, [])
  const second = planBump(first, '0.3.0-rc.1', { ownVersion: false }).manifest
  assert.ok(second !== undefined)
  assert.deepEqual(second.peerDependencies, { [PACKAGE]: '0.2.2-rc.1 || ^0.2.2-rc.3 || ^0.3.0-rc.1' })
  assert.deepEqual(planBump(second, '0.2.2-rc.3', { ownVersion: false }).changes, [])
})

const releaseArbitrary = fc.tuple(
  fc.integer({ min: 0, max: 5 }),
  fc.integer({ min: 0, max: 10 }),
  fc.integer({ min: 0, max: 10 }),
  fc.constantFrom('', '-rc.1', '-rc.3', '-alpha.2'),
).map(([major, minor, patch, suffix]) => `${major}.${minor}.${patch}${suffix}`)

const rangeArbitrary = fc.oneof(
  fc.constantFrom('*', 'x', '>=0.0.0'),
  fc.array(fc.tuple(releaseArbitrary, fc.constantFrom('', '^', '~', '>=')), { minLength: 1, maxLength: 6 })
    .map(branches => branches.map(([version, prefix]) => `${prefix}${version}`).join(' || ')),
)

const RUNTIME_BLOCKS = ['peerDependencies', 'dependencies', 'optionalDependencies'] as const

test('no runtime block admits the target by raising the minimum the plugin already supports', () => {
  fc.assert(fc.property(rangeArbitrary, releaseArbitrary, fc.array(releaseArbitrary, { maxLength: 12 }), (range, target, probes) => {
    for (const block of RUNTIME_BLOCKS) {
      const original = { [block]: { [PACKAGE]: range } }
      const plan = planBump(original, target, { ownVersion: false })
      const expanded = plan.changes[0]?.to ?? range
      assert.equal(semver.satisfies(target, expanded), true, `${block} must admit ${target}`)
      const before = semver.minVersion(range)
      const after = semver.minVersion(expanded)
      assert.ok(before !== null && after !== null)
      assert.equal(semver.lte(after, before), true, `${block} raised the supported floor`)
      for (const includePrerelease of [false, true]) {
        for (const version of [...probes, before.version]) {
          if (semver.satisfies(version, range, { includePrerelease })) {
            assert.equal(semver.satisfies(version, expanded, { includePrerelease }), true, `${block} dropped ${version}`)
          }
        }
      }
      assert.deepEqual(planBump(plan.manifest ?? original, target, { ownVersion: false }).changes, [])
      assert.deepEqual(original[block], { [PACKAGE]: range })
    }
  }), { numRuns: 500 })
})

test('development dependencies move to the target even when the old range already admitted it', () => {
  fc.assert(fc.property(rangeArbitrary, releaseArbitrary, (range, target) => {
    const plan = planBump({ devDependencies: { [PACKAGE]: range } }, target, { ownVersion: false })
    assert.deepEqual(plan.manifest?.devDependencies, { [PACKAGE]: rangeFor(target) })
  }), { numRuns: 200 })
})

test('regular and optional dependencies keep their supported floor and gain the target', () => {
  const source = '0.2.2-rc.1'
  const target = '0.2.2-rc.3'
  const plan = planBump({
    dependencies: { [PACKAGE]: source },
    optionalDependencies: { [PACKAGE]: source },
  }, target, { ownVersion: false })
  const widened = `${source} || ^${target}`
  assert.deepEqual(plan.manifest, {
    dependencies: { [PACKAGE]: widened },
    optionalDependencies: { [PACKAGE]: widened },
  })
  for (const range of [widened]) {
    assert.equal(semver.minVersion(range)?.version, source, 'the supported floor must not rise')
    assert.equal(semver.satisfies(source, range, { includePrerelease: true }), true)
    assert.equal(semver.satisfies(target, range), true)
  }
  assert.equal(declaredRelease(plan.manifest)?.version, source)
  assert.deepEqual(checkDependencyContract(plan.manifest, target, () => [source, target]), [])
})

test('non-registry references and unrelated packages are unchanged in every block', () => {
  const block = { [PACKAGE]: 'workspace:*', '@deepseek-ai/dsh-cli': 'file:../cli', '@deepseek-ai/dsh-web': 'link:../web', react: '^18' }
  const manifest = { peerDependencies: block, dependencies: block, devDependencies: block, optionalDependencies: block }
  assert.deepEqual(planBump(manifest, '0.2.2-rc.3', { ownVersion: false }), { manifest: undefined, changes: [] })
})

test('the plugin\'s own version rises by a patch when the consumer asks for it', () => {
  const plan = planBump(MANIFEST, '0.2.0', { ownVersion: true })
  assert.equal(plan.manifest?.version, '1.4.3')
  assert.deepEqual(plan.changes.at(-1), { field: 'version', from: '1.4.2', to: '1.4.3' })
})

test('a manifest that already names the target changes nothing', () => {
  const already = { version: '1.0.0', dependencies: { [PACKAGE]: '^0.2.0' }, peerDependencies: { [PACKAGE]: '^0.1.7 || ^0.2.0' } }
  const plan = planBump(already, '0.2.0', { ownVersion: false })
  assert.deepEqual(plan.changes, [])
  assert.equal(plan.manifest, undefined)
})

test('a version that is not a release is left as it is', () => {
  const plan = planBump({ version: 'next', dependencies: { '@deepseek-ai/dsh-cli': '^0.1.7' } }, '0.2.0', { ownVersion: true })
  assert.equal(plan.manifest?.version, 'next')
  assert.deepEqual(plan.changes.map(change => change.field), ['dependencies.@deepseek-ai/dsh-cli'])
})

test('a manifest keeps the indentation and the trailing newline of its file', () => {
  const text = '{\n    "name": "@acme/plugin",\n    "version": "1.0.0"\n}\n'
  const written = formatManifest(text, { name: '@acme/plugin', version: '1.0.1' })
  assert.equal(written, '{\n    "name": "@acme/plugin",\n    "version": "1.0.1"\n}\n')
  assert.equal(formatManifest('{"a":1}', { a: 2 }), '{\n  "a": 2\n}')
})

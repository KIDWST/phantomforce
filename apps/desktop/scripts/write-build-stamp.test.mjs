import assert from 'node:assert/strict'
import { test } from 'vitest'

import {
  FALLBACK_BRANCH,
  FALLBACK_COMMIT,
  fromCI,
  fromFallback,
  fromLocalGit,
  isUpstreamHermesRepository,
  isFallbackCommit,
  resolveKernelPin,
  resolveProductRepository,
  resolveStamp
} from './write-build-stamp.mjs'

test('fromCI reads GITHUB_SHA / GITHUB_REF_NAME', () => {
  assert.deepEqual(fromCI({ GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: 'release' }), {
    commit: 'a'.repeat(40),
    branch: 'release',
    dirty: false,
    source: 'ci'
  })
  assert.equal(fromCI({}), null)
})

test('fromLocalGit returns null when git rev-parse fails', () => {
  const stamp = fromLocalGit('/tmp/not-a-repo', () => null)
  assert.equal(stamp, null)
})

test('fromLocalGit reads HEAD + branch + dirty status', () => {
  const calls = []
  const execFn = cmd => {
    calls.push(cmd)
    if (cmd === 'git rev-parse HEAD') return 'b'.repeat(40)
    if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'main'
    if (cmd === 'git status --porcelain -uno') return ' M apps/desktop/package.json'
    return null
  }
  assert.deepEqual(fromLocalGit('/repo', execFn), {
    commit: 'b'.repeat(40),
    branch: 'main',
    dirty: true,
    source: 'local'
  })
  assert.ok(calls.includes('git rev-parse HEAD'))
})

test('fromFallback uses the all-zero placeholder commit', () => {
  assert.deepEqual(fromFallback(), {
    commit: FALLBACK_COMMIT,
    branch: FALLBACK_BRANCH,
    dirty: false,
    source: 'fallback'
  })
  assert.equal(isFallbackCommit(FALLBACK_COMMIT), true)
  assert.equal(isFallbackCommit('a'.repeat(40)), false)
})

test('resolveStamp prefers CI over local git over fallback', () => {
  const ci = resolveStamp({
    env: { GITHUB_SHA: 'c'.repeat(40), GITHUB_REF_NAME: 'main' },
    execFn: () => 'should-not-run'
  })
  assert.equal(ci.source, 'ci')
  assert.equal(ci.commit, 'c'.repeat(40))

  const local = resolveStamp({
    env: {},
    execFn: cmd => {
      if (cmd === 'git rev-parse HEAD') return 'd'.repeat(40)
      if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'main'
      if (cmd === 'git status --porcelain -uno') return ''
      return null
    }
  })
  assert.equal(local.source, 'local')
  assert.equal(local.commit, 'd'.repeat(40))
  assert.equal(local.dirty, false)
})

test('resolveStamp falls back when neither CI nor git is available', () => {
  const stamp = resolveStamp({ env: {}, execFn: () => null })
  assert.deepEqual(stamp, {
    commit: FALLBACK_COMMIT,
    branch: FALLBACK_BRANCH,
    dirty: false,
    source: 'fallback'
  })
})

test('resolveKernelPin keeps the distributable kernel separate from the product commit', () => {
  assert.deepEqual(
    resolveKernelPin({
      env: { PHANTOMBOT_KERNEL_COMMIT: 'e'.repeat(40), PHANTOMBOT_KERNEL_BRANCH: 'main' },
      execFn: () => {
        throw new Error('must not resolve git when the production pin is explicit')
      }
    }),
    { commit: 'e'.repeat(40), branch: 'main', source: 'explicit' }
  )

  assert.deepEqual(
    resolveKernelPin({
      env: {},
      execFn: command => (command === 'git merge-base HEAD origin/main' ? 'f'.repeat(40) : null)
    }),
    { commit: 'f'.repeat(40), branch: 'main', source: 'merge-base:origin/main' }
  )

  assert.deepEqual(
    resolveKernelPin({
      env: {},
      execFn: command => (command === 'git rev-list --max-parents=0 HEAD' ? '1'.repeat(40) : null)
    }),
    { commit: '1'.repeat(40), branch: 'main', source: 'product-shallow-root' }
  )
})

test('resolveProductRepository requires an explicit PhantomBot fork when origin is upstream Hermes', () => {
  assert.equal(
    resolveProductRepository({
      env: {},
      execFn: command =>
        command === 'git remote get-url origin' ? 'https://github.com/NousResearch/hermes-agent.git' : null
    }),
    null
  )
  assert.equal(isUpstreamHermesRepository('git@github.com:NousResearch/hermes-agent.git'), true)
})

test('resolveProductRepository prefers the release override and accepts a non-upstream origin', () => {
  assert.equal(
    resolveProductRepository({
      env: { PHANTOMBOT_PRODUCT_REPOSITORY: 'https://github.com/KIDWST/phantombot.git' },
      execFn: () => {
        throw new Error('explicit repository must win')
      }
    }),
    'https://github.com/KIDWST/phantombot.git'
  )
  assert.equal(
    resolveProductRepository({
      env: {},
      execFn: () => 'https://github.com/KIDWST/phantombot.git'
    }),
    'https://github.com/KIDWST/phantombot.git'
  )
})

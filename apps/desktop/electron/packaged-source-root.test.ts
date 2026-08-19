import assert from 'node:assert/strict'
import path from 'node:path'

import { test } from 'vitest'

import { findAncestorSourceRoot } from './packaged-source-root'

test('finds the checkout containing an unpacked packaged executable', () => {
  const sourceRoot = path.resolve('virtual', 'phantombot')
  const executableDirectory = path.join(sourceRoot, 'apps', 'desktop', 'release', 'win-unpacked')

  const resolved = findAncestorSourceRoot(executableDirectory, candidate => candidate === sourceRoot)

  assert.equal(resolved, sourceRoot)
})

test('returns null when no nearby ancestor is a Hermes source root', () => {
  const executableDirectory = path.resolve('virtual', 'installed', 'PhantomBot')

  const resolved = findAncestorSourceRoot(executableDirectory, () => false, 3)

  assert.equal(resolved, null)
})

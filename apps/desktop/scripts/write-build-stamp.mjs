/**
 * Writes apps/desktop/build/install-stamp.json with the git ref the desktop
 * .exe should pin to at first-launch bootstrap time.  This file ships inside
 * the packaged app via electron-builder's extraResources entry and is read
 * by electron/main.ts to drive the install.ps1 stage bootstrap flow.
 *
 * Schema (subject to bump via STAMP_SCHEMA_VERSION):
 *   {
 *     "schemaVersion": 2,
 *     "commit":        "<40-char SHA>",
 *     "branch":        "<branch name>",
 *     "productCommit": "<PhantomBot desktop commit>",
 *     "productBranch": "<PhantomBot desktop branch>",
 *     "productRepository": "<consumer-distribution git URL>",
 *     "builtAt":       "<ISO 8601 UTC timestamp>",
 *     "dirty":         true|false,
 *     "source":        "ci" | "local" | "fallback"
 *   }
 *
 * Source preference order:
 *   1. CI env vars ($GITHUB_SHA / $GITHUB_REF_NAME) -- avoid edge cases with
 *      shallow clones, detached HEADs, etc. in CI.
 *   2. Local `git rev-parse` against the parent repo (../..).
 *   3. Fallback stamp for local/personal builds from non-git source trees
 *      (ZIP extract, interrupted clone with no HEAD, etc.).
 *
 * Dev / out-of-repo builds without git produce an explicit fallback stamp
 * rather than aborting the whole build.  Bootstrap treats the all-zero
 * commit as unpinned and follows the branch instead of fetching a fake SHA.
 */

import { mkdirSync, writeFileSync } from 'fs'
import { resolve, join, relative } from 'path'
import { execSync } from 'child_process'

import { isMain } from './utils.mjs'

const STAMP_SCHEMA_VERSION = 2

/** All-zero placeholder used when no real commit can be resolved. */
export const FALLBACK_COMMIT = '0000000000000000000000000000000000000000'
export const FALLBACK_BRANCH = 'main'

const DESKTOP_ROOT = resolve(import.meta.dirname, '..')
const REPO_ROOT = resolve(DESKTOP_ROOT, '..', '..')
const OUT_DIR = join(DESKTOP_ROOT, 'build')
const OUT_FILE = join(OUT_DIR, 'install-stamp.json')

function tryExec(cmd, opts) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim()
  } catch {
    return null
  }
}

export function fromCI(env = process.env) {
  const sha = env.GITHUB_SHA
  if (!sha) return null
  const branch = env.GITHUB_REF_NAME || env.GITHUB_HEAD_REF || null
  return {
    commit: sha,
    branch: branch,
    dirty: false, // CI builds from a checkout-of-ref by definition
    source: 'ci'
  }
}

export function fromLocalGit(repoRoot = REPO_ROOT, execFn = tryExec) {
  const sha = execFn('git rev-parse HEAD', { cwd: repoRoot })
  if (!sha) return null
  const branch = execFn('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot })
  // `git status --porcelain -uno` is empty iff tracked files match HEAD.
  // We exclude untracked files (-uno) intentionally: a developer who's
  // checked out an installer scratch dir alongside the repo shouldn't
  // poison every local build with a [DIRTY] stamp.  We DO care about
  // tracked-but-modified files because those mean the .exe content
  // differs from the commit being pinned.
  const status = execFn('git status --porcelain -uno', { cwd: repoRoot })
  const dirty = status !== null && status.length > 0
  return {
    commit: sha,
    branch: branch === 'HEAD' ? null : branch, // detached HEAD -> null
    dirty: dirty,
    source: 'local'
  }
}

export function fromFallback(branch = FALLBACK_BRANCH) {
  // Non-git builds (ZIP download, bootstrap installer without a resolvable
  // HEAD) cannot determine a real commit.  Use a placeholder so local /
  // personal builds can still complete.  The desktop bootstrap treats the
  // all-zero commit as "unknown" and falls back to an unpinned branch
  // bootstrap instead of trying to fetch a non-existent GitHub commit.
  return {
    commit: FALLBACK_COMMIT,
    branch: branch || FALLBACK_BRANCH,
    dirty: false,
    source: 'fallback'
  }
}

/**
 * Resolve the install stamp without writing it.  Pure enough for unit tests:
 * inject env / execFn / repoRoot to simulate CI, local git, or no-git trees.
 */
export function resolveStamp({
  env = process.env,
  repoRoot = REPO_ROOT,
  execFn = tryExec,
  fallbackBranch = FALLBACK_BRANCH
} = {}) {
  return fromCI(env) || fromLocalGit(repoRoot, execFn) || fromFallback(fallbackBranch)
}

export function isFallbackCommit(commit) {
  return typeof commit === 'string' && /^0{7,40}$/.test(commit)
}

export function canonicalRepository(value) {
  let normalized = String(value || '')
    .trim()
    .replace(/^git\+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .toLowerCase()

  if (normalized.startsWith('git@github.com:')) {
    normalized = `https://github.com/${normalized.slice('git@github.com:'.length)}`
  } else if (normalized.startsWith('ssh://git@github.com/')) {
    normalized = `https://github.com/${normalized.slice('ssh://git@github.com/'.length)}`
  }

  return normalized
}

export function isUpstreamHermesRepository(value) {
  return canonicalRepository(value) === 'https://github.com/nousresearch/hermes-agent'
}

export function resolveProductRepository({ env = process.env, execFn = tryExec } = {}) {
  const explicit = String(env.PHANTOMBOT_PRODUCT_REPOSITORY || '').trim()

  if (explicit) {
    return isUpstreamHermesRepository(explicit) ? null : explicit
  }

  const origin = execFn('git remote get-url origin', { cwd: REPO_ROOT })

  return origin && !isUpstreamHermesRepository(origin) ? origin : null
}

export function resolveKernelPin({ env = process.env, execFn = tryExec } = {}) {
  const explicitCommit = env.PHANTOMBOT_KERNEL_COMMIT

  if (explicitCommit) {
    return {
      commit: explicitCommit,
      branch: env.PHANTOMBOT_KERNEL_BRANCH || FALLBACK_BRANCH,
      source: 'explicit'
    }
  }

  // Pin the Hermes kernel revision this PhantomBot product branch is actually
  // based on. `origin/main` may fast-forward while a developer or update probe
  // is running; pinning that moving tip can select a kernel newer than the
  // desktop product was built and tested against.
  const remoteCommit = execFn('git merge-base HEAD origin/main', { cwd: REPO_ROOT })

  if (remoteCommit) {
    return { commit: remoteCommit, branch: FALLBACK_BRANCH, source: 'merge-base:origin/main' }
  }

  // The Hermes desktop updater can refresh origin/main with a depth-1 fetch.
  // In that shallow layout the new remote tip and this product branch are
  // intentionally disconnected, so merge-base cannot see their shared
  // history. The product branch's shallow root is the exact Hermes commit it
  // was forked from and remains the compatible bootstrap pin.
  const shallowRoot = execFn('git rev-list --max-parents=0 HEAD', { cwd: REPO_ROOT })

  if (shallowRoot) {
    return { commit: shallowRoot.split(/\s+/)[0], branch: FALLBACK_BRANCH, source: 'product-shallow-root' }
  }

  return { commit: FALLBACK_COMMIT, branch: FALLBACK_BRANCH, source: 'fallback' }
}

function main() {
  const productStamp = resolveStamp()
  const kernelPin = resolveKernelPin()
  const productRepository = resolveProductRepository()

  if (!productStamp || !productStamp.commit) {
    // Should not happen — fromFallback() always provides a commit.
    console.error(
      '[write-build-stamp] ERROR: could not determine git commit.\n' +
        '  - $GITHUB_SHA not set\n' +
        '  - `git rev-parse HEAD` failed at ' +
        REPO_ROOT +
        '\n' +
        'Packaged builds require a git ref to pin first-launch install.ps1\n' +
        'against. Run from a git checkout or set $GITHUB_SHA explicitly.'
    )
    process.exit(1)
  }

  if (isFallbackCommit(kernelPin.commit)) {
    console.warn(
      '[write-build-stamp] WARNING: no Hermes kernel commit found.\n' +
        '  Using a placeholder kernel commit — the packaged app will fall back\n' +
        '  to the default branch. Production builds must set\n' +
        '  PHANTOMBOT_KERNEL_COMMIT to a published Nous Hermes commit.'
    )
  }

  if (productStamp.dirty) {
    console.warn(
      '[write-build-stamp] WARNING: working tree is dirty.\n' +
        '  Pinning to ' +
        productStamp.commit.slice(0, 12) +
        ' but the packaged code may differ from that commit.\n' +
        '  Commit your changes before publishing this build.'
    )
  }

  if (!productRepository) {
    console.warn(
      '[write-build-stamp] WARNING: no PhantomBot product repository configured.\n' +
        '  Local builds remain available, but consumer packaging is blocked.\n' +
        '  Set PHANTOMBOT_PRODUCT_REPOSITORY to the published PhantomBot fork URL.'
    )
  }

  const payload = {
    schemaVersion: STAMP_SCHEMA_VERSION,
    // commit/branch retain compatible Hermes kernel provenance for runtime
    // diagnostics. The product fields below are the only consumer-bootstrap
    // source contract for current PhantomBot packages.
    commit: kernelPin.commit,
    branch: kernelPin.branch,
    productCommit: productStamp.commit,
    productBranch: productStamp.branch,
    productRemote: productRepository,
    productRepository,
    sourceOrigin: tryExec('git remote get-url origin', { cwd: REPO_ROOT }),
    builtAt: new Date().toISOString(),
    dirty: productStamp.dirty,
    source: productStamp.source,
    kernelPinSource: kernelPin.source
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  console.log(
    '[write-build-stamp] wrote ' +
      relative(REPO_ROOT, OUT_FILE) +
      ' -> ' +
      'product ' +
      productStamp.commit.slice(0, 12) +
      (productStamp.branch ? ' (' + productStamp.branch + ')' : '') +
      ' / kernel ' +
      kernelPin.commit.slice(0, 12) +
      (productStamp.dirty ? ' [DIRTY]' : '') +
      (kernelPin.source === 'fallback' ? ' [FALLBACK]' : '')
  )
}

if (isMain(import.meta.url)) {
  main()
}

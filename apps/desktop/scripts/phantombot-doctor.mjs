import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isMain } from './utils.mjs'
import { isUpstreamHermesRepository, resolveProductRepository } from './write-build-stamp.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..')
const DESKTOP_ROOT = path.join(REPO_ROOT, 'apps', 'desktop')
const PRODUCT_APP_ID = 'online.phantomforce.phantombot'

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd || REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      ...options
    }).trim()
  } catch {
    return null
  }
}

function git(...args) {
  return run('git', args)
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function readHermesVersion(kernelRoot) {
  try {
    const source = readFileSync(path.join(kernelRoot, 'hermes_cli', '__init__.py'), 'utf8')

    return source.match(/__version__\s*=\s*["']([^"']+)["']/)?.[1] || null
  } catch {
    return null
  }
}

export function parseAheadBehind(value) {
  const match = String(value || '')
    .trim()
    .match(/^(\d+)\s+(\d+)$/)

  return match
    ? { ahead: Number.parseInt(match[1], 10), behind: Number.parseInt(match[2], 10) }
    : { ahead: null, behind: null }
}

export function resolveHermesHome(env = process.env) {
  if (env.HERMES_HOME) {
    return path.resolve(env.HERMES_HOME)
  }

  if (process.platform === 'win32' && env.LOCALAPPDATA) {
    return path.join(env.LOCALAPPDATA, 'hermes')
  }

  return path.join(os.homedir(), '.hermes')
}

export function releaseBlockers(input) {
  const blockers = []

  if (!input.identityOk) {
    blockers.push('Desktop package identity is not PhantomBot.')
  }

  if (!input.kernelAvailable) {
    blockers.push('Hermes kernel checkout or version is unavailable.')
  }

  if (!input.productCommitPublished) {
    blockers.push('The PhantomBot product commit is not present on a configured remote.')
  }

  if (!input.productRepository) {
    blockers.push('No PhantomBot product repository is configured.')
  } else if (isUpstreamHermesRepository(input.productRepository)) {
    blockers.push('The PhantomBot product repository cannot be the upstream Hermes repository.')
  }

  if (
    input.productRepository &&
    (input.installStamp?.productRepository !== input.productRepository ||
      input.installStamp?.productCommit !== input.productCommit)
  ) {
    blockers.push('The packaged install stamp does not match the current PhantomBot source.')
  }

  if (!input.installStamp?.commit || /^0+$/.test(input.installStamp.commit)) {
    blockers.push('The packaged kernel install stamp is missing or unpinned.')
  }

  return blockers
}

function windowsHermesProcesses() {
  if (process.platform !== 'win32') {
    return []
  }

  const script = [
    "$items = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.Name -match '^(hermes|python)(\\.exe)?$' -and $_.CommandLine -match '(gateway\\s+run|hermes_cli\\.main.*\\sserve(?:\\s|$)|hermes(?:\\.exe)?\"?\\s+serve(?:\\s|$))' }",
    '$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)',
    '$rows = foreach ($item in $items) {',
    '  $ports = @($listeners | Where-Object OwningProcess -eq $item.ProcessId | Select-Object -ExpandProperty LocalPort -Unique)',
    '  [pscustomobject]@{ pid = [int]$item.ProcessId; executable = $item.ExecutablePath; command = $item.CommandLine; ports = $ports }',
    '}',
    '@($rows) | ConvertTo-Json -Compress'
  ].join('; ')
  const raw = run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    timeout: 15_000
  })

  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)

    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
  } catch {
    return []
  }
}

export function collectDoctorReport() {
  const desktopPackage = readJson(path.join(DESKTOP_ROOT, 'package.json'))
  const installStamp = readJson(path.join(DESKTOP_ROOT, 'build', 'install-stamp.json'))
  const hermesHome = resolveHermesHome()
  const kernelRoot = path.join(hermesHome, 'hermes-agent')
  const kernelVersion = readHermesVersion(kernelRoot)
  const branch = git('branch', '--show-current') || null
  const commit = git('rev-parse', 'HEAD') || null
  const upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}') || null
  const counts = parseAheadBehind(git('rev-list', '--left-right', '--count', 'HEAD...@{upstream}'))
  const publishedRefs = commit ? git('branch', '--remotes', '--contains', commit) : null
  const productRepository = resolveProductRepository()
  const identityOk =
    desktopPackage?.name === 'phantombot' &&
    desktopPackage?.productName === 'PhantomBot' &&
    desktopPackage?.build?.appId === PRODUCT_APP_ID
  const productCommitPublished = Boolean(publishedRefs)
  const kernelAvailable = existsSync(kernelRoot) && Boolean(kernelVersion)
  const blockers = releaseBlockers({
    identityOk,
    installStamp,
    kernelAvailable,
    productCommit: commit,
    productCommitPublished,
    productRepository
  })

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    product: {
      name: desktopPackage?.productName || null,
      appId: desktopPackage?.build?.appId || null,
      version: desktopPackage?.version || null,
      identityOk
    },
    source: {
      repositoryRoot: REPO_ROOT,
      remote: git('remote', 'get-url', 'origin') || null,
      branch,
      commit,
      dirty: Boolean(git('status', '--porcelain')),
      upstream,
      ...counts,
      productCommitPublished,
      productRepository
    },
    kernel: {
      home: hermesHome,
      root: kernelRoot,
      version: kernelVersion,
      available: kernelAvailable,
      binary:
        process.platform === 'win32'
          ? path.join(kernelRoot, 'venv', 'Scripts', 'hermes.exe')
          : path.join(kernelRoot, 'venv', 'bin', 'hermes')
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      packageManager: existsSync(path.join(REPO_ROOT, 'package-lock.json')) ? 'npm' : 'unknown'
    },
    processes: windowsHermesProcesses(),
    release: {
      ready: blockers.length === 0,
      blockers,
      installStamp
    }
  }
}

function printHuman(report) {
  const mark = value => (value ? 'OK' : 'BLOCKED')

  console.log(`PhantomBot doctor ${report.generatedAt}`)
  console.log(`Product   ${mark(report.product.identityOk)}  ${report.product.name} ${report.product.version}`)
  console.log(`Source    ${report.source.branch || 'detached'} @ ${report.source.commit?.slice(0, 12) || 'unknown'}`)
  console.log(`Remote    ${report.source.remote || 'none'}`)
  console.log(
    `Worktree  ${report.source.dirty ? 'dirty' : 'clean'} · ${report.source.ahead ?? '?'} ahead / ${report.source.behind ?? '?'} behind`
  )
  console.log(
    `Kernel    ${mark(report.kernel.available)}  Hermes ${report.kernel.version || 'unknown'} at ${report.kernel.root}`
  )
  console.log(`Runtime   Node ${report.runtime.node} · ${report.runtime.platform}/${report.runtime.arch}`)
  console.log(`Services  ${report.processes.length} Hermes service process(es) detected`)
  console.log(`Release   ${mark(report.release.ready)}`)

  for (const blocker of report.release.blockers) {
    console.log(`  - ${blocker}`)
  }
}

function main() {
  const report = collectDoctorReport()
  const json = process.argv.includes('--json')
  const requireReleaseReady = process.argv.includes('--release')

  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printHuman(report)
  }

  if (requireReleaseReady && !report.release.ready) {
    process.exitCode = 2
  }
}

if (isMain(import.meta.url)) {
  main()
}

import { KERNEL_IDENTITY, PRODUCT_IDENTITY } from './product-identity'

export type PhantomBotRuntimeMode = 'deployment' | 'packaged' | 'read-only-inspection' | 'worktree-development'

export interface RuntimeGitIdentity {
  ahead: number | null
  behind: number | null
  branch: string | null
  commit: string | null
  dirty: boolean | null
  remote: string | null
  repositoryRoot: string
  upstream: string | null
  worktree: string
}

export interface PackagedProductSource {
  dirty?: boolean | null
  productBranch?: string | null
  productCommit?: string | null
  productRemote?: string | null
}

export interface RuntimeBackendIdentity {
  baseUrl: string | null
  command: string | null
  health: 'degraded' | 'offline' | 'ready' | 'starting'
  host: string | null
  managed: boolean
  mode: 'local' | 'remote' | 'unknown'
  pid: number | null
  port: number | null
  profile: string | null
  workingDirectory: string | null
}

export interface RuntimeBuildIdentity {
  branch: string | null
  builtAt: string | null
  commit: string | null
  dirty: boolean | null
  kernelCommit: string | null
  source: string | null
}

export interface PhantomBotRuntimeIdentity {
  backend: RuntimeBackendIdentity
  build: RuntimeBuildIdentity
  config: {
    environment: 'development' | 'production'
    hermesHome: string
    userData: string
  }
  desktop: {
    appId: string
    appPath: string
    appVersion: string
    deploymentPath: string | null
    executable: string
  }
  generatedAt: string
  kernel: {
    binary: string | null
    root: string
    upstreamRepository: string
    version: string
  }
  mode: PhantomBotRuntimeMode
  product: {
    displayName: string
    publisher: string
  }
  runtime: {
    arch: string
    electronVersion: string
    nodeVersion: string
    platform: string
  }
  schemaVersion: 1
  source: RuntimeGitIdentity
}

export function resolveRuntimeMode(input: {
  explicitMode?: string | null
  isPackaged: boolean
  sourceIsGitWorktree: boolean
}): PhantomBotRuntimeMode {
  const explicit = String(input.explicitMode || '')
    .trim()
    .toLowerCase()

  if (explicit === 'read-only' || explicit === 'read-only-inspection') {
    return 'read-only-inspection'
  }

  if (explicit === 'deployment') {
    return 'deployment'
  }

  if (explicit === 'worktree' || explicit === 'worktree-development') {
    return 'worktree-development'
  }

  if (explicit === 'packaged') {
    return 'packaged'
  }

  if (input.isPackaged) {
    return 'packaged'
  }

  return input.sourceIsGitWorktree ? 'worktree-development' : 'deployment'
}

export function parseAheadBehind(value: string | null | undefined): { ahead: number | null; behind: number | null } {
  const match = String(value || '')
    .trim()
    .match(/^(\d+)\s+(\d+)$/)

  if (!match) {
    return { ahead: null, behind: null }
  }

  return {
    ahead: Number.parseInt(match[1], 10),
    behind: Number.parseInt(match[2], 10)
  }
}

export function parseRuntimeUrl(rawUrl: string | null | undefined): {
  host: string | null
  port: number | null
} {
  if (!rawUrl) {
    return { host: null, port: null }
  }

  try {
    const url = new URL(rawUrl)
    const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80

    return {
      host: url.hostname || null,
      port: Number.isInteger(port) && port > 0 ? port : null
    }
  } catch {
    return { host: null, port: null }
  }
}

export function createPackagedSourceIdentity(
  deploymentPath: string,
  stamp: PackagedProductSource | null | undefined
): RuntimeGitIdentity {
  return {
    ahead: null,
    behind: null,
    branch: stamp?.productBranch || null,
    commit: stamp?.productCommit || null,
    dirty: stamp?.dirty ?? null,
    remote: stamp?.productRemote || null,
    repositoryRoot: deploymentPath,
    upstream: null,
    worktree: deploymentPath
  }
}

export function createRuntimeIdentity(input: {
  appPath: string
  appVersion: string
  arch: string
  backend: RuntimeBackendIdentity
  build?: Partial<RuntimeBuildIdentity> | null
  deploymentPath?: string | null
  electronVersion: string
  environment: 'development' | 'production'
  executable: string
  generatedAt?: string
  hermesBinary?: string | null
  hermesHome: string
  kernelRoot: string
  kernelVersion: string
  mode: PhantomBotRuntimeMode
  nodeVersion: string
  platform: string
  source: RuntimeGitIdentity
  userData: string
}): PhantomBotRuntimeIdentity {
  const build = input.build || {}

  return {
    backend: input.backend,
    build: {
      branch: build.branch ?? null,
      builtAt: build.builtAt ?? null,
      commit: build.commit ?? null,
      dirty: build.dirty ?? null,
      kernelCommit: build.kernelCommit ?? null,
      source: build.source ?? null
    },
    config: {
      environment: input.environment,
      hermesHome: input.hermesHome,
      userData: input.userData
    },
    desktop: {
      appId: PRODUCT_IDENTITY.appId,
      appPath: input.appPath,
      appVersion: input.appVersion,
      deploymentPath: input.deploymentPath ?? null,
      executable: input.executable
    },
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    kernel: {
      binary: input.hermesBinary ?? null,
      root: input.kernelRoot,
      upstreamRepository: KERNEL_IDENTITY.upstreamRepository,
      version: input.kernelVersion
    },
    mode: input.mode,
    product: {
      displayName: PRODUCT_IDENTITY.displayName,
      publisher: PRODUCT_IDENTITY.publisher
    },
    runtime: {
      arch: input.arch,
      electronVersion: input.electronVersion,
      nodeVersion: input.nodeVersion,
      platform: input.platform
    },
    schemaVersion: 1,
    source: input.source
  }
}

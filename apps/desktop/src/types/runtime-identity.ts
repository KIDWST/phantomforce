export type PhantomBotRuntimeMode = 'deployment' | 'packaged' | 'read-only-inspection' | 'worktree-development'

export interface PhantomBotRuntimeIdentity {
  schemaVersion: 1
  generatedAt: string
  mode: PhantomBotRuntimeMode
  product: {
    displayName: string
    publisher: string
  }
  source: {
    repositoryRoot: string
    remote: string | null
    branch: string | null
    commit: string | null
    dirty: boolean | null
    upstream: string | null
    ahead: number | null
    behind: number | null
    worktree: string
  }
  build: {
    commit: string | null
    kernelCommit: string | null
    branch: string | null
    builtAt: string | null
    dirty: boolean | null
    source: string | null
  }
  desktop: {
    appId: string
    appPath: string
    appVersion: string
    deploymentPath: string | null
    executable: string
  }
  kernel: {
    binary: string | null
    root: string
    upstreamRepository: string
    version: string
  }
  runtime: {
    electronVersion: string
    nodeVersion: string
    platform: string
    arch: string
  }
  backend: {
    mode: 'local' | 'remote' | 'unknown'
    baseUrl: string | null
    host: string | null
    port: number | null
    pid: number | null
    managed: boolean
    health: 'degraded' | 'offline' | 'ready' | 'starting'
    command: string | null
    workingDirectory: string | null
    profile: string | null
  }
  config: {
    environment: 'development' | 'production'
    hermesHome: string
    userData: string
  }
}

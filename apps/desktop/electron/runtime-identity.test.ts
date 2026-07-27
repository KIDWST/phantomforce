import { describe, expect, it } from 'vitest'

import {
  createPackagedSourceIdentity,
  createRuntimeIdentity,
  parseAheadBehind,
  parseRuntimeUrl,
  resolveRuntimeMode
} from './runtime-identity'

describe('createPackagedSourceIdentity', () => {
  it('reports the installed PhantomBot artifact instead of the bootstrapped Hermes checkout', () => {
    expect(
      createPackagedSourceIdentity('C:\\Program Files\\PhantomBot', {
        dirty: false,
        productBranch: 'release',
        productCommit: 'a'.repeat(40),
        productRemote: 'https://github.com/PhantomForce/phantombot.git'
      })
    ).toEqual({
      ahead: null,
      behind: null,
      branch: 'release',
      commit: 'a'.repeat(40),
      dirty: false,
      remote: 'https://github.com/PhantomForce/phantombot.git',
      repositoryRoot: 'C:\\Program Files\\PhantomBot',
      upstream: null,
      worktree: 'C:\\Program Files\\PhantomBot'
    })
  })

  it('does not mislabel a legacy Hermes-only build stamp as a PhantomBot commit', () => {
    expect(createPackagedSourceIdentity('/Applications/PhantomBot.app', null)).toMatchObject({
      branch: null,
      commit: null,
      dirty: null,
      remote: null
    })
  })
})

describe('PhantomBot runtime identity', () => {
  it('keeps packaged, development, deployment, and read-only modes explicit', () => {
    expect(resolveRuntimeMode({ isPackaged: true, sourceIsGitWorktree: true })).toBe('packaged')
    expect(resolveRuntimeMode({ isPackaged: false, sourceIsGitWorktree: true })).toBe('worktree-development')
    expect(
      resolveRuntimeMode({
        explicitMode: 'worktree-development',
        isPackaged: true,
        sourceIsGitWorktree: true
      })
    ).toBe('worktree-development')
    expect(resolveRuntimeMode({ isPackaged: false, sourceIsGitWorktree: false })).toBe('deployment')
    expect(
      resolveRuntimeMode({
        explicitMode: 'read-only',
        isPackaged: false,
        sourceIsGitWorktree: true
      })
    ).toBe('read-only-inspection')
  })

  it('parses git ahead/behind counts without inventing missing values', () => {
    expect(parseAheadBehind('3  7')).toEqual({ ahead: 3, behind: 7 })
    expect(parseAheadBehind('not-tracking')).toEqual({ ahead: null, behind: null })
  })

  it('parses loopback and default runtime ports', () => {
    expect(parseRuntimeUrl('http://127.0.0.1:5190')).toEqual({ host: '127.0.0.1', port: 5190 })
    expect(parseRuntimeUrl('https://operator.example.test')).toEqual({ host: 'operator.example.test', port: 443 })
    expect(parseRuntimeUrl('not a url')).toEqual({ host: null, port: null })
  })

  it('identifies PhantomBot as the product and Hermes as its kernel', () => {
    const identity = createRuntimeIdentity({
      appPath: 'C:\\PhantomBot\\app.asar',
      appVersion: '0.17.0',
      arch: 'x64',
      backend: {
        baseUrl: 'http://127.0.0.1:5190',
        command: 'hermes serve',
        health: 'ready',
        host: '127.0.0.1',
        managed: true,
        mode: 'local',
        pid: 42,
        port: 5190,
        profile: 'default',
        workingDirectory: 'C:\\Work'
      },
      electronVersion: '40.10.2',
      environment: 'production',
      executable: 'C:\\PhantomBot\\PhantomBot.exe',
      generatedAt: '2026-07-26T00:00:00.000Z',
      hermesHome: 'C:\\Hermes',
      kernelRoot: 'C:\\Hermes\\hermes-agent',
      kernelVersion: '0.17.0',
      mode: 'packaged',
      nodeVersion: '22.0.0',
      platform: 'win32',
      source: {
        ahead: 1,
        behind: 0,
        branch: 'phantombot',
        commit: 'abc1234',
        dirty: false,
        remote: 'https://example.test/phantombot.git',
        repositoryRoot: 'C:\\src',
        upstream: 'origin/main',
        worktree: 'C:\\src'
      },
      userData: 'C:\\UserData'
    })

    expect(identity.product).toEqual({ displayName: 'PhantomBot', publisher: 'PhantomForce' })
    expect(identity.kernel.upstreamRepository).toContain('NousResearch/hermes-agent')
    expect(identity.backend.pid).toBe(42)
  })
})

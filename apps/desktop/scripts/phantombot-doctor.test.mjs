import { describe, expect, it } from 'vitest'

import { parseAheadBehind, releaseBlockers, resolveHermesHome } from './phantombot-doctor.mjs'

describe('PhantomBot doctor', () => {
  it('resolves an explicit Hermes home without guessing', () => {
    expect(resolveHermesHome({ HERMES_HOME: 'C:\\HermesHome' })).toBe('C:\\HermesHome')
  })

  it('parses tracking counts', () => {
    expect(parseAheadBehind('4 9')).toEqual({ ahead: 4, behind: 9 })
    expect(parseAheadBehind('')).toEqual({ ahead: null, behind: null })
  })

  it('blocks a consumer release whose product commit is unpublished', () => {
    expect(
      releaseBlockers({
        identityOk: true,
        installStamp: { commit: 'a'.repeat(40), productCommit: 'b'.repeat(40) },
        kernelAvailable: true,
        productCommit: 'b'.repeat(40),
        productCommitPublished: false
      })
    ).toContain('The PhantomBot product commit is not present on a configured remote.')
  })

  it('blocks a release that still points at the upstream Hermes repository', () => {
    expect(
      releaseBlockers({
        identityOk: true,
        installStamp: {
          commit: 'a'.repeat(40),
          productCommit: 'b'.repeat(40),
          productRepository: 'https://github.com/NousResearch/hermes-agent.git'
        },
        kernelAvailable: true,
        productCommit: 'b'.repeat(40),
        productCommitPublished: true,
        productRepository: 'https://github.com/NousResearch/hermes-agent.git'
      })
    ).toContain('The PhantomBot product repository cannot be the upstream Hermes repository.')
  })
})

import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  gitUrlRewriteEnvironment,
  healedProductBranch,
  PHANTOMBOT_STABLE_BRANCH,
  resolveProductUpdateTarget
} from './product-update-target'

test('packaged PhantomBot updates follow product provenance instead of Hermes origin/main', () => {
  assert.deepEqual(
    resolveProductUpdateTarget({
      config: null,
      installStamp: {
        productBranch: 'phantomforce/release-17',
        productRepository: 'https://github.com/KIDWST/phantomforce.git',
        sourceOrigin: 'https://github.com/NousResearch/hermes-agent.git'
      },
      packaged: true
    }),
    {
      branch: 'phantomforce/release-17',
      repositoryUrl: 'https://github.com/KIDWST/phantomforce.git',
      sourceOriginUrl: 'https://github.com/NousResearch/hermes-agent.git'
    }
  )
})

test('development builds keep the ordinary main update lane', () => {
  assert.equal(resolveProductUpdateTarget({ config: null, installStamp: null, packaged: false }).branch, 'main')
})

test('git rewrite is process-scoped, composable, and skips identical repositories', () => {
  assert.deepEqual(
    gitUrlRewriteEnvironment(
      { GIT_CONFIG_COUNT: '2' },
      {
        fromUrl: 'https://github.com/NousResearch/hermes-agent.git',
        toUrl: 'https://github.com/KIDWST/phantomforce.git'
      }
    ),
    {
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_2: 'url.https://github.com/KIDWST/phantomforce.git.insteadOf',
      GIT_CONFIG_VALUE_2: 'https://github.com/NousResearch/hermes-agent.git'
    }
  )

  assert.deepEqual(
    gitUrlRewriteEnvironment(
      {},
      {
        fromUrl: 'git@github.com:KIDWST/phantomforce.git',
        toUrl: 'https://github.com/KIDWST/phantomforce'
      }
    ),
    {}
  )
})

test('removed product release branches heal to the permanent stable lane', () => {
  assert.equal(
    healedProductBranch({
      branch: 'phantomforce/old-release',
      productRepository: true,
      remoteBranchExists: false
    }),
    PHANTOMBOT_STABLE_BRANCH
  )
  assert.equal(
    healedProductBranch({ branch: 'feature/demo', productRepository: false, remoteBranchExists: false }),
    'main'
  )
})

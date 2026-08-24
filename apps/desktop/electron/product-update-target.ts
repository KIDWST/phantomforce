export const PHANTOMBOT_STABLE_BRANCH = 'phantombot/stable'

type ProductInstallStamp = {
  productBranch?: string | null
  productRemote?: string | null
  productRepository?: string | null
  sourceOrigin?: string | null
}

type UpdateConfig = {
  branch?: string | null
}

export type ProductUpdateTarget = {
  branch: string
  repositoryUrl: string | null
  sourceOriginUrl: string | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function comparableRepository(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^git\+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//i, 'https://github.com/')
    .toLowerCase()
}

/**
 * Resolve the immutable product release lane carried by the packaged app.
 *
 * A PhantomBot package contains both a Hermes kernel pin and PhantomForce
 * product provenance. Updates must follow the latter. Falling back to
 * origin/main here silently replaces PhantomBot with upstream Hermes.
 */
export function resolveProductUpdateTarget({
  config,
  installStamp,
  packaged
}: {
  config?: UpdateConfig | null
  installStamp?: ProductInstallStamp | null
  packaged: boolean
}): ProductUpdateTarget {
  const productBranch = clean(installStamp?.productBranch)
  const configuredBranch = clean(config?.branch)
  const repositoryUrl = packaged ? clean(installStamp?.productRepository) || clean(installStamp?.productRemote) : null

  return {
    branch: configuredBranch || productBranch || (packaged ? PHANTOMBOT_STABLE_BRANCH : 'main'),
    repositoryUrl,
    sourceOriginUrl: clean(installStamp?.sourceOrigin)
  }
}

/**
 * Add a process-scoped git `url.*.insteadOf` rule. This lets the existing,
 * heavily-tested `hermes update` implementation keep using the logical remote
 * name `origin` while PhantomBot resolves that name to its product repository.
 * The checkout's git config is never mutated and the rule disappears with the
 * updater process.
 */
export function gitUrlRewriteEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  { fromUrl, toUrl }: { fromUrl?: string | null; toUrl?: string | null }
): NodeJS.ProcessEnv {
  const source = clean(fromUrl)
  const target = clean(toUrl)

  if (!source || !target || comparableRepository(source) === comparableRepository(target)) {
    return {}
  }

  const parsedCount = Number.parseInt(String(baseEnv.GIT_CONFIG_COUNT || '0'), 10)
  const count = Number.isInteger(parsedCount) && parsedCount >= 0 ? parsedCount : 0

  return {
    GIT_CONFIG_COUNT: String(count + 1),
    [`GIT_CONFIG_KEY_${count}`]: `url.${target}.insteadOf`,
    [`GIT_CONFIG_VALUE_${count}`]: source
  }
}

export function healedProductBranch({
  branch,
  productRepository,
  remoteBranchExists
}: {
  branch: string
  productRepository: boolean
  remoteBranchExists: boolean
}): string {
  if (remoteBranchExists) {
    return branch
  }

  if (productRepository && branch !== PHANTOMBOT_STABLE_BRANCH) {
    return PHANTOMBOT_STABLE_BRANCH
  }

  return 'main'
}

import path from 'node:path'

export function findAncestorSourceRoot(
  startDirectory: string,
  isSourceRoot: (candidate: string) => boolean,
  maxDepth = 8
): string | null {
  let candidate = path.resolve(startDirectory)

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    if (isSourceRoot(candidate)) {
      return candidate
    }

    const parent = path.dirname(candidate)

    if (parent === candidate) {
      break
    }

    candidate = parent
  }

  return null
}

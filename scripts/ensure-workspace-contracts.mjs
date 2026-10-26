import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  }).sort();
}
function digest(paths, base) {
  const hash = createHash('sha256');
  for (const target of paths.sort()) {
    hash.update(path.relative(base, target).replaceAll('\\', '/'));
    hash.update('\0'); hash.update(readFileSync(target)); hash.update('\0');
  }
  return hash.digest('hex');
}

/** Generated workspace packages must come from the same checkout as the server. */
export function ensureWorkspaceContracts({ repoRoot, checkOnly = false, build } = {}) {
  const repo = realpathSync(repoRoot || fileURLToPath(new URL('../', import.meta.url)));
  const packageRoot = path.join(repo, 'packages', 'contracts');
  const require = createRequire(path.join(repo, 'server', 'package.json'));
  const resolved = require.resolve('@phantomforce/contracts/package.json');
  const linked = path.join(repo, 'node_modules', '@phantomforce', 'contracts', 'package.json');
  if (realpathSync(resolved) !== realpathSync(path.join(packageRoot, 'package.json')) || realpathSync(linked) !== realpathSync(path.join(packageRoot, 'package.json'))) {
    throw new Error('Contracts resolve to another checkout. Install dependencies in this checkout with npm ci; do not share workspace node_modules junctions.');
  }
  const compiler = require.resolve('typescript/bin/tsc');
  const compilerPackage = require.resolve('typescript/package.json');
  const sourcePaths = () => [
    ...files(path.join(packageRoot, 'src')),
    path.join(packageRoot, 'package.json'), path.join(packageRoot, 'tsconfig.json'),
    path.join(repo, 'tsconfig.base.json'), compilerPackage,
  ];
  const sourceHash = digest(sourcePaths(), repo);
  const outputRoot = path.join(packageRoot, 'dist');
  const stampPath = path.join(outputRoot, '.workspace-build.json');
  const outputs = () => existsSync(outputRoot) ? files(outputRoot).filter(target => target !== stampPath && !path.basename(target).startsWith('.workspace-build')) : [];
  const outputHash = () => digest(outputs(), outputRoot);
  let stamp = null;
  try { stamp = JSON.parse(readFileSync(stampPath, 'utf8')); } catch { /* A missing or corrupt stamp requires rebuilding. */ }
  const main = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).main;
  if (stamp?.version === 1 && stamp.sourceHash === sourceHash && existsSync(path.join(packageRoot, main)) && stamp.outputHash === outputHash()) {
    return { ok: true, rebuilt: false, sourceHash, outputHash: stamp.outputHash };
  }
  if (checkOnly) throw new Error('Workspace contracts are stale or unverified. Run npm run build:contracts before starting the API.');
  if (build) build();
  else {
    const result = spawnSync(process.execPath, [compiler, '-p', path.join(packageRoot, 'tsconfig.json')], { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Contracts build failed: ${result.stderr || result.stdout}`);
  }
  if (sourceHash !== digest(sourcePaths(), repo)) throw new Error('Contract sources changed during compilation. Retry the build.');
  if (!existsSync(path.join(packageRoot, main)) || !outputs().length) throw new Error('Contracts build did not produce the package entry point.');
  stamp = { version: 1, sourceHash, outputHash: outputHash() };
  mkdirSync(outputRoot, { recursive: true });
  const temporary = `${stampPath}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(stamp, null, 2)); renameSync(temporary, stampPath);
  return { ok: true, rebuilt: true, sourceHash, outputHash: stamp.outputHash };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const rootArg = process.argv.indexOf('--repo-root');
    console.log(JSON.stringify(ensureWorkspaceContracts({ repoRoot: rootArg < 0 ? undefined : process.argv[rootArg + 1], checkOnly: process.argv.includes('--check') })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

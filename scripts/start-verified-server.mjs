import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { ensureWorkspaceContracts } from './ensure-workspace-contracts.mjs';

const repo = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
if (process.platform === 'win32' && process.env.PORT === '5190'
  && repo.toLowerCase() !== realpathSync('G:/Codex/Documents/Codex/deployments/phantomforce-live').toLowerCase()) {
  throw new Error('Production API must use the dedicated deployment checkout. Use another port for an editing preview.');
}
const contracts = ensureWorkspaceContracts({ repoRoot: repo });
const revision = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
const commit = revision.stdout?.trim();
if (revision.status !== 0 || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Cannot verify the current API source revision.');
const require = createRequire(path.join(repo, 'server/package.json'));
const loader = pathToFileURL(require.resolve('tsx')).href;
const child = spawn(process.execPath, ['--import', loader, 'src/index.ts'], {
  cwd: path.join(repo, 'server'), windowsHide: true, stdio: 'inherit',
  env: { ...process.env, PHANTOMFORCE_BUILD_COMMIT: commit, PHANTOMFORCE_CONTRACTS_HASH: contracts.sourceHash },
});
const forward = signal => { if (!child.killed) child.kill(signal); };
const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => {
  process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
  process.exitCode = code ?? (signal ? 1 : 0);
});

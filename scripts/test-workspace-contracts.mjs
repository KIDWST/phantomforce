import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, unlinkSync, rmSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureWorkspaceContracts } from './ensure-workspace-contracts.mjs';

const require = createRequire(import.meta.url);
const fixture = mkdtempSync(path.join(tmpdir(), 'pf-contract-build-'));
const pkg = path.join(fixture, 'packages/contracts');
const moduleLink = path.join(fixture, 'node_modules/@phantomforce/contracts');
let checks = 0;
const check = fn => { fn(); checks++; };
try {
  mkdirSync(path.join(pkg, 'src'), { recursive: true });
  mkdirSync(path.dirname(moduleLink), { recursive: true });
  writeFileSync(path.join(fixture, 'package.json'), '{"type":"module"}');
  writeFileSync(path.join(fixture, 'tsconfig.base.json'), '{"compilerOptions":{"target":"ES2022","module":"ESNext","skipLibCheck":true}}');
  writeFileSync(path.join(pkg, 'package.json'), '{"name":"@phantomforce/contracts","type":"module","main":"dist/index.js"}');
  writeFileSync(path.join(pkg, 'tsconfig.json'), '{"extends":"../../tsconfig.base.json","compilerOptions":{"outDir":"dist","rootDir":"src","declaration":true},"include":["src"]}');
  writeFileSync(path.join(pkg, 'src/index.ts'), 'export const crmContactId = "contact-ready";');
  symlinkSync(pkg, moduleLink, 'junction');
  symlinkSync(path.dirname(require.resolve('typescript/package.json')), path.join(fixture, 'node_modules/typescript'), 'junction');
  const run = options => ensureWorkspaceContracts({ repoRoot: fixture, ...options });
  check(() => assert.throws(() => run({ checkOnly: true }), /stale or unverified/));
  const built = run();
  check(() => assert.equal(built.rebuilt, true));
  check(() => assert.match(readFileSync(path.join(pkg, 'dist/index.js'), 'utf8'), /contact-ready/));
  check(() => assert.equal(run({ checkOnly: true }).sourceHash, built.sourceHash));
  check(() => assert.equal(run().rebuilt, false));
  writeFileSync(path.join(pkg, 'dist/index.js'), 'export const oldBuild = true;');
  check(() => assert.throws(() => run({ checkOnly: true }), /stale or unverified/));
  check(() => assert.equal(run().rebuilt, true));
  writeFileSync(path.join(pkg, 'src/index.ts'), 'export const crmContactId = "updated-contact";');
  check(() => assert.throws(() => run({ checkOnly: true }), /stale or unverified/));
  check(() => assert.notEqual(run().sourceHash, built.sourceHash));
  mkdirSync(path.join(fixture, 'server/src'), { recursive: true });
  mkdirSync(path.join(fixture, 'scripts'));
  writeFileSync(path.join(fixture, 'server/package.json'), '{"type":"module"}');
  symlinkSync(path.dirname(require.resolve('tsx/package.json')), path.join(fixture, 'node_modules/tsx'), 'junction');
  for (const name of ['start-verified-server.mjs', 'ensure-workspace-contracts.mjs']) copyFileSync(new URL(name, import.meta.url), path.join(fixture, 'scripts', name));
  const git = args => {
    const result = spawnSync('git', ['-C', fixture, ...args], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  git(['init', '--quiet']);
  git(['-c', 'user.name=Runtime fixture', '-c', 'user.email=runtime-fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', 'Runtime fixture']);
  const fixtureCommit = git(['rev-parse', 'HEAD']);
  const probeEntry = path.join(fixture, 'server/src/index.ts');
  const probeCode = 'const started: string = "fixture-started"; console.log(JSON.stringify({ started, hash: process.env.PHANTOMFORCE_CONTRACTS_HASH, commit: process.env.PHANTOMFORCE_BUILD_COMMIT }));';
  writeFileSync(probeEntry, probeCode);
  const launch = () => spawnSync(process.execPath, [path.join(fixture, 'scripts/start-verified-server.mjs')], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000,
    env: { ...process.env, PORT: '5199', PHANTOMFORCE_CONTRACTS_HASH: 'unverified', PHANTOMFORCE_BUILD_COMMIT: 'stale' },
  });
  let probe = launch();
  check(() => assert.equal(probe.status, 0, probe.stderr));
  check(() => assert.deepEqual(JSON.parse(probe.stdout), { started: 'fixture-started', hash: run({ checkOnly: true }).sourceHash, commit: fixtureCommit }));
  writeFileSync(path.join(pkg, 'dist/index.js'), 'export const stale = true;');
  probe = launch();
  check(() => assert.equal(probe.status, 0, probe.stderr));
  check(() => assert.match(readFileSync(path.join(pkg, 'dist/index.js'), 'utf8'), /updated-contact/));
  writeFileSync(probeEntry, `${probeCode}\nprocess.exitCode = 7;`);
  probe = launch();
  check(() => assert.equal(probe.status, 7, 'Supervised API exit status must reach PM2.'));
  writeFileSync(probeEntry, probeCode);
  const stamp = readFileSync(path.join(pkg, 'dist/.workspace-build.json'), 'utf8');
  writeFileSync(path.join(pkg, 'src/index.ts'), 'export const invalid: number = "text";');
  check(() => assert.throws(() => run(), /Contracts build failed/));
  check(() => assert.equal(readFileSync(path.join(pkg, 'dist/.workspace-build.json'), 'utf8'), stamp));
  probe = launch();
  check(() => assert.notEqual(probe.status, 0));
  check(() => assert.equal(probe.stdout.trim(), '', 'Invalid contracts must prevent the API entry point from executing.'));
  const other = path.join(fixture, 'different-checkout'); mkdirSync(other);
  writeFileSync(path.join(other, 'package.json'), '{"name":"@phantomforce/contracts","main":"index.js"}');
  unlinkSync(moduleLink); symlinkSync(other, moduleLink, 'junction');
  check(() => assert.throws(() => run(), /resolve to another checkout/));
  const launcher = readFileSync(new URL('../ops/admin-live/Start-Hermes.ps1', import.meta.url), 'utf8');
  check(() => assert.ok(launcher.indexOf('ensure-workspace-contracts.mjs') < launcher.indexOf('Stop-Process -Id $listenerPid'), 'Contracts must be ready before replacing the API listener.'));
  check(() => assert.match(launcher, /PHANTOMFORCE_CONTRACTS_HASH = \[string\]\$contractsState.sourceHash/));
  const sync = readFileSync(new URL('../ops/admin-live/Sync-AdminMain.ps1', import.meta.url), 'utf8');
  check(() => assert.match(sync, /ensure-workspace-contracts\.mjs.*--repo-root \$RepoRoot --check/));
  check(() => assert.match(sync, /Test-HermesRuntimeAligned -Health \$hermesHealth -Commit \$local -ContractsSourceHash/));
  if (process.platform === 'win32') {
    const helper = fileURLToPath(new URL('../ops/admin-live/hermes-runtime-state.ps1', import.meta.url)).replaceAll("'", "''");
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `& {
      . '${helper}'
      $revision = 'a' * 40; $fingerprint = 'b' * 64
      $cases = @(
        @{ health = @{commit=$revision;contractsSourceHash=$fingerprint}; commit=$revision; hash=$fingerprint; expected=$true },
        @{ health = @{commit=$revision;contractsSourceHash=$null}; commit=$revision; hash=$fingerprint; expected=$false },
        @{ health = @{commit=$revision;contractsSourceHash=('c'*64)}; commit=$revision; hash=$fingerprint; expected=$false },
        @{ health = @{commit=('c'*40);contractsSourceHash=$fingerprint}; commit=$revision; hash=$fingerprint; expected=$false },
        @{ health = @{commit='unknown';contractsSourceHash=$fingerprint}; commit='unknown'; hash=$fingerprint; expected=$false },
        @{ health = @{commit=$revision;contractsSourceHash=''}; commit=$revision; hash=''; expected=$false },
        @{ health = $null; commit=$revision; hash=$fingerprint; expected=$false }
      )
      foreach ($case in $cases) {
        $actual = Test-HermesRuntimeAligned -Health $case.health -Commit $case.commit -ContractsSourceHash $case.hash
        if ($actual -ne $case.expected) { throw 'Hermes runtime decision was incorrect.' }
      }
      Write-Output $cases.Count
    }`], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    check(() => assert.equal(result.status, 0, result.stderr));
    check(() => assert.equal(result.stdout.trim(), '7'));
  }
  console.log(`Workspace contracts: ${checks} checks passed (real compilation, supervised entry, same-commit runtime repair, cache drift, failure preservation and cross-checkout rejection).`);
} finally {
  // Only the disposable mkdtemp fixture created above; junction targets are not traversed.
  rmSync(fixture, { recursive: true, force: true });
}

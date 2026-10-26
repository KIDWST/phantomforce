import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, unlinkSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
  const stamp = readFileSync(path.join(pkg, 'dist/.workspace-build.json'), 'utf8');
  writeFileSync(path.join(pkg, 'src/index.ts'), 'export const invalid: number = "text";');
  check(() => assert.throws(() => run(), /Contracts build failed/));
  check(() => assert.equal(readFileSync(path.join(pkg, 'dist/.workspace-build.json'), 'utf8'), stamp));
  const other = path.join(fixture, 'different-checkout'); mkdirSync(other);
  writeFileSync(path.join(other, 'package.json'), '{"name":"@phantomforce/contracts","main":"index.js"}');
  unlinkSync(moduleLink); symlinkSync(other, moduleLink, 'junction');
  check(() => assert.throws(() => run(), /resolve to another checkout/));
  const launcher = readFileSync(new URL('../ops/admin-live/Start-Hermes.ps1', import.meta.url), 'utf8');
  check(() => assert.ok(launcher.indexOf('ensure-workspace-contracts.mjs') < launcher.indexOf('Stop-Process -Id $listenerPid'), 'Contracts must be ready before replacing the API listener.'));
  check(() => assert.match(launcher, /PHANTOMFORCE_CONTRACTS_HASH = \[string\]\$contractsState.sourceHash/));
  console.log(`Workspace contracts: ${checks} checks passed (real compilation, cache, source/output drift, failure preservation and cross-checkout rejection).`);
} finally {
  // Only the disposable mkdtemp fixture created above; junction targets are not traversed.
  rmSync(fixture, { recursive: true, force: true });
}

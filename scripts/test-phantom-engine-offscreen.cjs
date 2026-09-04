const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

(async () => {
  const { chromium } = require(process.env.PHANTOM_PLAYWRIGHT || 'C:/Users/jorda/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const repo = path.resolve(__dirname, '..');
  const realCatalog = process.argv.includes('--catalog');
  assert(!(realCatalog && process.argv.includes('--live')), 'Catalog verification must not edit real projects');
  const base = process.env.PHANTOM_ENGINE_TEST_OUTPUT || 'G:/Codex/artifacts/phantom-engine/2026-09-03';
  await fs.mkdir(base, { recursive: true });
  const proof = await fs.mkdtemp(path.join(base, 'native-proof-'));
  const project = path.join(proof, 'workspace/app/games/operator-fixture');
  const data = path.join(proof, 'profile');
  await fs.mkdir(project, { recursive: true }); await fs.mkdir(data);
  await fs.writeFile(path.join(project, 'index.html'), '<!doctype html><html><head><title>Engine QA Fixture</title></head><body><h1>Engine QA Fixture</h1></body></html>');
  await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'native-engine-fixture', type: 'module' }));
  await fs.writeFile(path.join(project, 'game.js'), 'export const damage = (hp, amount) => hp + amount;\n');
  await fs.writeFile(path.join(project, 'game.test.js'), "import { test } from 'node:test';import assert from 'node:assert/strict';import { damage } from './game.js';test('damage clamps',()=>{assert.equal(damage(10,3),7);assert.equal(damage(10,20),0)});\n");
  const server = require('fastify')();
  const { registerPhantomPlayEngineRoutes } = await import(pathToFileURL(path.join(repo, 'server/dist/phantomplay-engine-routes.js')));
  server.get('/health', async () => ({ ok: true }));
  server.get('/api/phantomplay/ai-models', async () => ({ ok: true, configured: true, models: [{ id: '', name: 'Codex default' }] }));
  registerPhantomPlayEngineRoutes(server, { localAllowed: () => true, credential: async () => null });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const api = process.env.PHANTOM_ENGINE_TEST_API || 'http://127.0.0.1:' + server.server.address().port;
  await fs.writeFile(path.join(data, 'studio-settings.json'), JSON.stringify({ default_view: 'engine', ai_provider: 'codex', ai_model: '', api_origin: api }));
  const exe = process.env.PHANTOM_ENGINE_TEST_EXE || path.join(repo, 'packages/phantomplay-dioxus-shell/target/dx/PhantomPlay/bundle/windows/PhantomPlay.exe');
  const port = 19543;
  const child = spawn(exe, ['--offscreen-test'], { windowsHide: true, stdio: 'ignore', env: { ...process.env,
    PHANTOMPLAY_DATA_ROOT: data, PHANTOMPLAY_WEBVIEW_DATA_DIR: path.join(proof, 'webview'),
    PHANTOMPLAY_LIVE_ROOT: realCatalog ? '' : path.join(proof, 'workspace'),
    PHANTOMPLAY_DEVELOPMENT_ROOT: realCatalog ? repo : path.join(proof, 'workspace'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + port,
  } });
  let browser;
  try {
    let endpoint;
    for (let i = 0; i < 60; i++) {
      try { endpoint = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json(); break; } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    assert(endpoint, 'Hidden WebView2 debugging endpoint did not start');
    browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
    const context = browser.contexts()[0];
    let page;
    for (let i = 0; i < 30; i++) {
      page = context.pages().find(p => !p.url().startsWith('devtools:'));
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert(page);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.locator('.pe-engine-shell').waitFor({ timeout: 30_000 });
    await page.getByText('Choose the game Phantom should edit.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'SELECT A GAME', exact: true }).waitFor();
    await page.getByRole('button', { name: 'CREATE / IMPORT GAME', exact: true }).waitFor();
    await page.screenshot({ path: path.join(proof, 'engine-select-game.png') });
    if (realCatalog) {
      assert(await page.locator('.project-row').count() >= 20, 'Default installed catalog is missing');
      const catalog = await page.locator('.project-list').innerText();
      assert.match(catalog, /Shadowbearer/i);
      assert.match(catalog, /PhantomStrike/i);
    }
    await page.locator('.project-row').first().click();
    await page.getByText('PHANTOM WILL EDIT', { exact: true }).waitFor();
    if (!realCatalog) await page.locator('.pe-active-project strong').filter({ hasText: /Fixture|operator/i }).waitFor();
    await page.locator('.pe-mission-composer textarea').fill('Fix game.js so damage subtracts from health and clamps to zero. Keep game.test.js unchanged. Run node --test and report the result.');
    await page.getByRole('button', { name: 'BUILD IT', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.pe-run-agent').disabled);
    const nav = await page.locator('.view-switcher').boundingBox();
    const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert(nav.x > size.width / 2, 'Play/Engine must be in the corner');
    await page.screenshot({ path: path.join(proof, 'engine-ready.png') });
    if (process.argv.includes('--live')) {
      await page.getByRole('button', { name: 'BUILD IT', exact: true }).click();
      await page.getByRole('button', { name: 'STOP WORKER', exact: true }).waitFor({ timeout: 30_000 });
      await page.screenshot({ path: path.join(proof, 'engine-working.png') });
      await page.waitForFunction(() => !document.querySelector('.pe-run-agent').disabled, undefined, { timeout: 360_000 });
      const error = await page.locator('.pe-operator-error').allTextContents();
      assert.equal(error.length, 0, error.join('\n'));
      await page.locator('.pe-run-receipt details summary').click();
      await page.screenshot({ path: path.join(proof, 'engine-result.png') });
      execFileSync(process.execPath, ['--test', 'game.test.js'], { cwd: project, stdio: 'pipe', windowsHide: true });
      assert.match(await page.locator('.pe-run-receipt').innerText(), /game.js/);
    }
    await page.getByRole('button', { name: 'CONNECTIONS', exact: true }).click();
    await page.getByText('PHANTOMPLAY CONTROL CENTER', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(proof, 'engine-connections.png') });
    assert.equal(errors.length, 0, errors.join('\n'));
    await fs.writeFile(path.join(proof, 'verification.json'), JSON.stringify({ exe, api, offscreen: true, realCatalog, liveExecution: process.argv.includes('--live'), project: realCatalog ? null : project, nav, size, errors }, null, 2));
    console.log('PASS: native hidden WebView UI, corner navigation, project selection, command composer, Connections' + (process.argv.includes('--live') ? ', real execution and independently passing tests' : '') + '. Evidence: ' + proof);
  } finally {
    if (browser) await browser.close();
    if (child.pid) { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {} }
    await server.close();
  }
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });

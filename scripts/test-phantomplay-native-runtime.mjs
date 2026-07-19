import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appEngine = readFileSync(new URL("../app/js/phantomplay.js", import.meta.url), "utf8");
const serverEngine = readFileSync(new URL("../server/src/phantom-ai/phantomplay.ts", import.meta.url), "utf8");
const desktopMain = readFileSync(new URL("../packages/phantomforce-desktop/main.js", import.meta.url), "utf8");
const desktopPreload = readFileSync(new URL("../packages/phantomforce-desktop/preload.js", import.meta.url), "utf8");
const desktopPolicy = readFileSync(new URL("../packages/phantomforce-desktop/runtime-policy.js", import.meta.url), "utf8");
const policyManifest = JSON.parse(readFileSync(new URL("../app/phantomplay-engine-policy.json", import.meta.url), "utf8"));

assert.equal(policyManifest.version, "3.0-native-live", "Policy manifest must identify the native-live engine version.");
assert.equal(policyManifest.delivery.serverEditableCatalog, true, "Catalog must remain server-editable after packaging.");
assert.equal(policyManifest.delivery.requiresRedownloadForContentChanges, false, "Users must not need a redownload for game/content changes.");
assert(policyManifest.allowedGameRuntimeTypes.includes("webassembly"), "Native-live engine must allow WASM games.");
assert(policyManifest.allowedGameRuntimeTypes.includes("godot-web"), "Native-live engine must allow Godot web exports.");
assert(policyManifest.blockedGameRuntimeTypes.includes("windows-exe"), "Desktop packaging must still reject arbitrary executable games.");
assert(policyManifest.limits.nativeApprovedBundleBytes >= 524_288_000, "Packaged runtime must support larger approved game bundles.");

assert.match(serverEngine, /version:\s*"3\.0-native-live"/u, "Server PhantomPlay engine must publish native-live version.");
assert.match(serverEngine, /nativeRuntime:[\s\S]*requiresRedownloadForContentChanges:\s*false/u, "Server engine must advertise live server updates.");
assert.match(serverEngine, /allowedRuntimeTypes:[\s\S]*"webassembly"[\s\S]*"godot-web"/u, "Server engine must advertise bigger browser-first runtime lanes.");
assert.match(appEngine, /version:\s*"3\.0-native-live"/u, "Client PhantomPlay engine must publish native-live version.");
assert.match(appEngine, /globalThis\.phantomDesktop/u, "Client must read the packaged desktop bridge when available.");
assert.match(appEngine, /bridgeAvailable:\s*Boolean\(native\?\.available\)/u, "Client engine payload must report whether the native bridge is available.");

assert.match(desktopPolicy, /defaultLiveUrl:\s*"https:\/\/admin\.phantomforce\.online\/app\/"/u, "Desktop shell must load the live admin app by default.");
assert.match(desktopPolicy, /requiresRedownloadForContentChanges:\s*false/u, "Desktop runtime policy must preserve server-editable updates.");
assert.match(desktopPolicy, /maxNativeApprovedBundleBytes:\s*524_288_000/u, "Desktop runtime policy must support larger approved games.");
assert.match(desktopPolicy, /blockedTypes:[\s\S]*"windows-exe"/u, "Desktop policy must block arbitrary executable games.");
assert.match(desktopMain, /contextIsolation:\s*true[\s\S]*nodeIntegration:\s*false[\s\S]*sandbox:\s*true/u, "Desktop shell must keep web content isolated.");
assert.match(desktopMain, /loadURL\(liveUrl\)/u, "Desktop shell must load the live app URL.");
assert.match(desktopMain, /loadFile\(join\(here,[\s\S]*"app",\s*"index\.html"\)\)/u, "Desktop shell must have a local app fallback.");
assert.match(desktopPreload, /contextBridge\.exposeInMainWorld\("phantomDesktop"/u, "Desktop preload must expose a narrow Phantom desktop bridge.");
assert.match(desktopPreload, /sendSync\("phantom:runtime-sync"\)/u, "Desktop runtime bridge must be synchronously available to the game engine payload.");
assert.match(desktopMain, /ipcMain\.on\("phantom:runtime-sync"/u, "Desktop shell must answer the synchronous runtime bridge request.");

console.log("PhantomPlay native-live desktop runtime checks passed.");

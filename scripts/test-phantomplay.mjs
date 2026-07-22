import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const main = read("../app/js/main.js");
const module = read("../app/js/phantomplay.js");
const v2Module = read("../app/js/phantomplay-v2.js");
const index = read("../app/index.html");
const css = read("../app/phantomplay.css");
const v2Css = read("../app/phantomplay-v2.css");
const staticServer = read("../ops/admin-live/admin-static-server.mjs");
const gameSlugs = ["neon-drift", "signal-match", "focus-stack", "word-weld", "reflex-grid", "rift-frenzy", "serpent-surge", "pixel-bloom", "type-storm", "im-baked", "phantom-strike"];
const games = gameSlugs.map((name) => read(`../app/games/${name}.html`));
const neonDrift = games[gameSlugs.indexOf("neon-drift")];
const phantomRumble = read("../app/games/phantom-rumble.html");
const cubeTown = read("../app/games/cubetown/cubetown.js");
const cubeTownIndex = read("../app/games/cubetown/index.html");
const flagshipCatalog = read("../server/src/phantom-ai/phantomplay-flagship.ts");
const serverCatalog = read("../server/src/phantom-ai/phantomplay.ts");
const serverV2Catalog = read("../server/src/phantom-ai/phantomplay-v2.ts");
const serverIndex = read("../server/src/index.ts");
const kingdomBreakers = read("../app/games/kingdom-breakers.html");
const kingdomBreakersScript = kingdomBreakers.match(/<script>([\s\S]*)<\/script>/u)?.[1] || "";
const crownCircuit = read("../app/games/crown-circuit.html");
const crownCircuitScript = crownCircuit.match(/<script>([\s\S]*)<\/script>/u)?.[1] || "";
const skyguardArena = read("../app/games/skyguard-arena/game.js");
const vespergateGame = read("../app/games/vespergate/game.js");
const vespergateRooms = read("../app/games/vespergate/rooms.js");
const vespergateEngine = read("../app/games/vespergate/engine.js");
const vespergateIndex = read("../app/games/vespergate/index.html");
const coverArt = [
  "beat-strike",
  "cubetown",
  "keyboardist-on-tour",
  "kingdom-breakers",
  "phantom-ages",
  "phantom-grand-prix",
  "skyguard-arena",
  "tidefront-tactics",
].map((slug) => read(`../app/assets/phantomplay/${slug}-cover.svg`)).join("\n");
const tidefrontTactics = read("../app/games/tidefront-tactics.html");
const appFiles = [index, main, module, v2Module, ...games];
const kidsOnlyGameIds = [
  "signal-match", "focus-stack", "reflex-grid", "penalty-kick", "rift-frenzy", "serpent-surge",
  "color-rush", "tile-flow", "tower-tactics", "breath-pacer", "court-vision", "pixel-bloom",
  "circuit-serpent", "echo-sequence", "signal-sweeper", "neon-breaker", "type-storm", "logic-lights",
  "sudoku-signal",
];

assert.match(main, /id:\s*"phantomplay"[\s\S]*label:\s*"PhantomPlay"/u, "PhantomPlay must be in the native navigation.");
assert.match(main, /renderPhantomPlay/u, "The workspace must use the PhantomPlay renderer.");
assert.match(read("../app/js/customization.js"), /canAccessConfiguredModule[\s\S]*module\.id !== "phantomplay"[\s\S]*selected_members/u, "PhantomPlay nav access must be controlled by the workspace module configuration.");
assert.match(main, /sessionId:\s*kind === "admin" \? "admin-jordan" : "client-sports-demo"/u, "Local UI tests must obtain a real protected demo session when the local backend is available.");
assert.match(index, /phantomplay\.css\?v=phantom-live-/u, "The dedicated PhantomPlay stylesheet must be loaded.");
assert.match(index, /phantomplay-v2\.css\?v=phantom-live-/u, "The PhantomPlay V2 stylesheet must be loaded.");
assert.match(module, /tab:\s*"library"/u, "Default PhantomPlay must open straight to the game library.");
assert.match(module, /const mobilePlaySurface/u, "Default PhantomPlay must detect mobile play surfaces.");
assert.match(module, /const controlsCopy[\s\S]*mobilePlaySurface\(\) \? ""/u, "Default PhantomPlay must hide redundant controls copy on touch-first play surfaces.");
assert.match(v2Module, /const mobilePlaySurface/u, "PhantomPlay V2 must detect mobile play surfaces.");
assert.match(v2Module, /const controlsCopy[\s\S]*mobilePlaySurface\(\) \? ""/u, "PhantomPlay V2 must hide redundant controls copy on touch-first play surfaces.");
assert.doesNotMatch(module, /touch-drag|touch pressure|mobile touch controls/u, "Catalog/player copy must not print obvious touch instructions.");
assert.doesNotMatch(v2Module, /touch-drag|touch pressure|mobile touch controls/u, "V2 catalog/player copy must not print obvious touch instructions.");
assert.match(module, /const GAME_SORTS = \["All", "Solo", "Multiplayer", "Kids"/u, "Default PhantomPlay must keep Kids as a sort chip.");
assert.match(module, /const tabs = \[\["library", "Games"\], \["together", "Multiplayer"\], \["favorites", "Saved"\]/u, "Default PhantomPlay tabs must start with Games, Multiplayer, and Saved.");
assert.match(module, /function sortGames\(games, sort = ui\.category\)[\s\S]*sort === "Kids"[\s\S]*kidsPick/u, "Default PhantomPlay must sort kids-only games through the sorter.");
assert.match(module, /KIDS_ONLY_GAME_IDS[\s\S]*signal-match[\s\S]*logic-lights[\s\S]*sudoku-signal/u, "Default PhantomPlay must keep the requested kids-only game list.");
for (const gameId of kidsOnlyGameIds) {
  assert.match(module, new RegExp(JSON.stringify(gameId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"), `Default PhantomPlay must include ${gameId} in the kids-only ID set.`);
  assert.match(v2Module, new RegExp(JSON.stringify(gameId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"), `PhantomPlay V2 must include ${gameId} in the kids-only ID set.`);
}
assert.match(module, /return generalPlayGames\(games\)/u, "Default PhantomPlay must hide kids-only games from normal catalog views.");
assert.match(module, /function fallbackLeaderboards\(snapshot = ui\.snapshot\)[\s\S]*generalPlayGames\(Array\.isArray\(snapshot\?\.catalog\)/u, "Default PhantomPlay leaderboards must not surface kids-only games outside Kids.");
assert.match(module, /function renderFavorites\(\)[\s\S]*generalPlayGames\(ui\.snapshot\.catalog\)/u, "Default PhantomPlay Saved tab must not re-surface kids-only games outside Kids.");
assert.match(module, /const classroomGames = generalPlayGames\(ui\.snapshot\.catalog\)\.filter/u, "Default PhantomPlay private room picker must not leak kids-only games.");
assert.match(module, /return sortGames\(ui\.snapshot\.catalog, "All"\)/u, "Default PhantomPlay must render the full general catalog without search/filter chrome.");
assert.doesNotMatch(module, /data-pp-search|Search games, modes, categories, creators/u, "Default PhantomPlay must not restore the redundant game search bar.");
assert.doesNotMatch(module, /renderToddlerSpace|pp-shell-toddler|pp-toddler-space|data-pp-toddler-play/u, "Default PhantomPlay must not keep a separate Toddler Space page.");
assert.match(module, /class="pp-game-art" style="--pp-game-art:url\('/u, "Default PhantomPlay cards must expose their art to the CSS backdrop.");
assert.match(css, /\.pp-library\{padding-top:10px\}/u, "Default PhantomPlay must keep the condensed game-first library spacing.");
assert.match(css, /\.pp-game-art::before\{[\s\S]*?background-image:var\(--pp-game-art\)[\s\S]*?filter:blur/u, "Default PhantomPlay cards must use a premium blurred art backdrop instead of empty black bands.");
assert.match(css, /\.pp-game-art img\{[\s\S]*?object-fit:contain[\s\S]*?transform:none/u, "Default PhantomPlay card thumbnails must show the full image, not zoom-crop it.");
assert.match(css, /@media\(min-width:768px\)\{[\s\S]*?\.pp-game-grid-full \.pp-game\{[\s\S]*?grid-template-columns:minmax\(210px,\.38fr\) minmax\(0,1fr\)/u, "Desktop PhantomPlay library cards must use a stable split art/details layout.");
assert.doesNotMatch(css, /Toddler Space|pp-toddler-space|pp-shell-toddler/u, "Default PhantomPlay stylesheet must not preserve a separate Toddler Space destination.");
assert.match(v2Module, /tab:\s*"solo"/u, "PhantomPlay V2 must open straight to games, not a marketing/home screen.");
assert.match(v2Module, /const GAME_SORTS = \["All", "Solo", "Multiplayer", "Kids"/u, "Kids must be a sort chip, not a separate destination.");
assert.match(v2Module, /const tabs = \[\["solo", "Games"\], \["friends", "Multiplayer"\], \["library", "Library"\]/u, "V2 top tabs must start with Games, Multiplayer, and Library.");
assert.match(v2Module, /function sortGames\(games, sort = ui\.category\)[\s\S]*sort === "Kids"[\s\S]*kidsPick/u, "V2 must sort kids-only games through the sorter.");
assert.match(v2Module, /KIDS_ONLY_GAME_IDS[\s\S]*signal-match[\s\S]*logic-lights[\s\S]*sudoku-signal/u, "V2 must keep the requested kids-only game list.");
assert.match(v2Module, /return generalPlayGames\(games\)/u, "V2 must hide kids-only games from normal catalog views.");
assert.match(v2Module, /const builtIns = generalPlayGames\(ui\.snapshot\.catalog\)\.filter/u, "V2 workspace policy and leaderboard selectors must not leak kids-only games.");
assert.match(v2Module, /return sortGames\(ui\.snapshot\.catalog\)\.filter/u, "V2 library search must reuse the same sort pipeline as the Games tab.");
assert.doesNotMatch(v2Module, /renderToddlerSpace|pp2-shell-toddler|pp2-toddler-space/u, "V2 must not bring back a separate Toddler Space page.");
assert.match(v2Css, /\.pp2-play-header/u, "V2 game-first landing header must be styled.");
assert.match(v2Css, /\.pp2-cats button\.is-active/u, "V2 sort chips must be visibly styled.");
assert.doesNotMatch(v2Css, /Toddler Space|pp2-toddler-space|pp2-shell-toddler/u, "V2 stylesheet must not preserve a separate Toddler Space destination.");
assert.match(serverCatalog, /function isKidsLaneGame\(game: PhantomPlayGame\): boolean[\s\S]*PHANTOMPLAY_KIDS_ONLY_GAME_IDS/u, "Server catalog must have one kids-lane detector.");
assert.match(serverCatalog, /function kidsLaneGame\(game: PhantomPlayGame\)[\s\S]*category: "Kids"[\s\S]*featured: false/u, "Server catalog must remap kids-only games into the Kids lane.");
assert.match(serverCatalog, /function phantomLeaderboards\(store: PhantomPlayStore, catalog: PhantomPlayGame\[\], actorId: string\)[\s\S]*visibleCatalog = catalog\.filter\(\(game\) => !isKidsLaneGame\(game\)\)/u, "Server leaderboards must not surface kids-only games outside Kids.");
assert.match(serverV2Catalog, /isKidsLaneGame,[\s\S]*kidsLaneGame,/u, "V2 server must use the shared kids-lane detector instead of inventing a second list.");
assert.match(serverV2Catalog, /function fullCatalog[\s\S]*\.map\(kidsLaneGame\)/u, "V2 server must remap kids-only titles into the Kids category at the catalog source.");
assert.match(serverV2Catalog, /const discoveryCatalog = catalog\.filter\(\(game\) => !isKidsLaneGame\(game\)\)/u, "V2 discovery must exclude kids-only games from general rows.");
assert.match(serverV2Catalog, /topRated: discoveryCatalog\.map/u, "V2 top-rated discovery must use the general-only catalog.");
assert.match(serverV2Catalog, /hiddenGems: discoveryCatalog\.map/u, "V2 hidden-gem discovery must use the general-only catalog.");
assert.match(serverV2Catalog, /related: \(isKidsLaneGame\(game\) \? catalog\.filter\(isKidsLaneGame\) : catalog\.filter\(\(item\) => !isKidsLaneGame\(item\)\)\)/u, "V2 related games must keep kids-only related titles inside Kids context only.");
assert.match(serverV2Catalog, /const game = visibleCatalogFor\(store, v1, tenantId, actorId\)\.find\(\(item\) => item\.id === gameId\)/u, "V2 leaderboard endpoint must respect the viewer's visible catalog before returning scores.");
assert.match(module, /sandbox="allow-scripts allow-pointer-lock"/u, "Games must launch in an opaque-origin sandbox with scripts and pointer lock only.");
assert.doesNotMatch(module, /allow-same-origin|allow-forms|allow-popups/u, "The player must not grant origin, form, or popup powers.");
assert.match(module, /event\.source !== frame\.contentWindow/u, "Game messages must be bound to the active frame.");
assert.match(module, /data\.source !== "phantomplay-game"/u, "Game messages must use the PhantomPlay protocol marker.");
assert.doesNotMatch(module + v2Module, /Sign in to play|Backend session required|backend_session_required/u, "PhantomPlay must not show a sign-in/session gate inside an already signed-in workspace.");
assert.match(module + v2Module, /local_play_fallback/u, "PhantomPlay fallback snapshots must allow signed-in workspace users to launch built-in games locally while sync is offline.");
assert.match(module + v2Module, /function canLaunchGames[\s\S]*hasWorkspaceSession/u, "PhantomPlay launch gating must treat an existing workspace session as enough for local built-in play.");
assert.match(module + v2Module, /Local Play mode/u, "PhantomPlay offline copy must present backend loss as sync degradation, not a sign-in failure.");
assert.match(module + v2Module, /!\s*ui\.offline && ui\.error/u, "PhantomPlay must not stack a raw backend error banner over playable local mode.");
assert.match(module, /if \(error\?\.status === 401 \|\| error\?\.status === 403\)[\s\S]*ui\.snapshot = normalizeSnapshot\(offlineState\(\)\);[\s\S]*ui\.offline = true;[\s\S]*Local built-in games are still available/u, "Classic PhantomPlay must keep local built-in games available during auth/sync trouble.");
assert.doesNotMatch(module, /ui\.notice = "Cloud sync is offline/u, "Classic PhantomPlay must not duplicate offline sync copy inside the Creator support notice banner.");
assert.match(v2Module, /if \(error\?\.status === 401 \|\| error\?\.status === 403\)[\s\S]*ui\.snapshot = normalizeSnapshot\(offlineState\(\)\);[\s\S]*ui\.offline = true;[\s\S]*Local built-in games are still available/u, "V2 PhantomPlay must keep local built-in games available during auth/sync trouble.");
assert.match(module + v2Module, /!\s*ui\.offline && ui\.error \? `<div class="pp2?-banner is-error|!\s*ui\.offline && ui\.error \? `<div class="pp-banner is-error/u, "PhantomPlay must still show launch/session errors when play is genuinely blocked.");
assert.match(serverIndex, /app\.get\("\/api\/phantomplay"[\s\S]*try \{[\s\S]*getPhantomPlaySnapshot[\s\S]*catch \(error\)[\s\S]*sync_unavailable/u, "The PhantomPlay snapshot route must fail soft instead of returning raw Internal Server Error.");
assert.match(module, /No games ready/u, "The condensed library must retain a useful empty state.");
assert.match(module, /not a marketplace/u, "PhantomPlay must be positioned as a sandbox, not a marketplace.");
assert.match(module, /Play together with friends in this workspace\./u, "PhantomPlay must expose the private multiplayer room surface.");
assert.match(module, /Start a private room/u, "PhantomPlay must expose private room creation.");
assert.match(module, /No public discovery/u, "Private rooms must avoid public discovery.");
assert.match(module, /same workspace/u, "Private rooms must be scoped to the signed-in workspace.");
assert.match(module, /No direct inbound device ports/u, "Wireless play must not require exposing player devices.");
assert.match(module, /Classroom mode only allows Everyone-rated games/u, "School rooms must have an Everyone-rated content boundary.");
assert.match(module, /\/api\/phantomplay\/rooms/u, "The play-together UI must use the authenticated PhantomPlay room API.");
assert.match(module, /Edit build/u, "Builders must be able to revise builds.");
assert.match(module, /function developerDirectory/u, "The Dev Rooms tab must be backed by a developer directory derived from catalog data.");
assert.match(module, /Dev score/u, "Developer profiles must expose a visible Dev score.");
assert.match(module, /data-pp-open-dev/u, "Developer cards must open profile views.");
assert.match(module, /data-pp-support-dev/u, "Developer profiles must allow local support marks.");
assert.match(module, /data-pp-donate-dev/u, "Developer profiles must allow local collaboration intent without starting payments.");
assert.match(module, /data-pp-save-dev-note/u, "Developer profiles must support private dev notes.");
const renderDeveloperSource = module.match(/function renderDeveloper\(\) \{([\s\S]*?)\nfunction renderAdmin/u)?.[1] || "";
assert.ok(renderDeveloperSource, "renderDeveloper must exist.");
assert.doesNotMatch(renderDeveloperSource, /data-pp-submit-form|New submission|DEVELOPER DISTRIBUTION|marketplace|storefront/u, "The Dev Rooms tab must render the sandbox directory/profile flow, not the old submission form or marketplace copy.");
assert.match(module, /Request changes/u, "Admin moderation controls must exist.");
assert.match(module, /data-pp-favorite/u, "Favorites must be interactive.");
assert.match(module, /data-pp-player-pause/u, "The player must expose pause and resume controls.");
assert.match(module, /data-pp-player-restart/u, "The player must expose a restart control.");
assert.match(module, /data-pp-player-close/u, "The player must expose close controls.");
assert.match(module, /postToGame\("exit"/u, "Closing the player must notify the game before teardown.");
assert.match(module, /document\.exitFullscreen/u, "Closing the player must escape fullscreen mode.");
assert.match(module, /PHANTOMPLAY_ENGINE/u, "The player must publish an engine capability profile.");
assert.match(module, /saveStateBytes:\s*262144/u, "The engine must support larger save-state payloads for bigger games.");
assert.match(module, /largeMap:\s*\{/u, "The engine must advertise large-map support.");
assert.match(module, /screenFlow:\s*\["title", "loadout", "match", "results"\]/u, "The engine must advertise the complete game screen flow.");
assert.match(module, /updateChannel:\s*\{\s*kind:\s*"web_build",\s*checkSeconds:\s*60,\s*reinstallRequired:\s*false\s*\}/u, "Web game updates must stay reinstall-free and build-driven.");
assert.match(module, /desktop_player/u, "The engine must advertise a downloadable large-asset player profile.");
assert.match(module, /developer_full/u, "The engine must advertise a full developer install profile.");
assert.match(module, /cloudStreamingFromJordan:\s*false/u, "The engine must not imply Jordan-hosted cloud game streaming.");
assert.match(module, /engine:\s*engineFor/u, "Game settings must include engine capabilities.");
assert.match(module, /frame\.focus/u, "The active game frame must receive keyboard focus.");
for (const slug of gameSlugs) {
  assert.match(module, new RegExp(`id:\\s*"${slug}"`, "u"), `${slug} must be registered in the frontend built-in catalog.`);
  assert.match(module, new RegExp(`/app/games/${slug}\\.html`, "u"), `${slug} must have a playable launch URL.`);
}
assert.match(css, /@media\s*\(max-width:\s*767px\)/u, "Phone-specific responsive layout must exist.");
assert.match(css, /html\[data-org-color-mode="dark"\] \.pp-game-art img\{[\s\S]*?object-fit:contain[\s\S]*?transform:none/u, "Dark-mode PhantomPlay thumbnails must show the full game image instead of zoom-cropping it.");
assert.match(css, /html\[data-org-color-mode="light"\] \.pp-game-art img\{[\s\S]*?object-fit:contain[\s\S]*?transform:none/u, "Light-mode PhantomPlay thumbnails must also show the full game image instead of zoom-cropping it.");
assert.match(css, /\.pp-game-grid:not\(\.pp-game-grid-full\) \.pp-game-art img\{[\s\S]*?object-fit:contain[\s\S]*?transform:none/u, "Compact PhantomPlay rows must not override thumbnails back to cropped art.");
assert.doesNotMatch(coverArt, /cover placeholder|PhantomPlay cover placeholder/u, "Shipped PhantomPlay cover SVGs must not expose placeholder copy.");
assert.match(css, /@media\(max-width:767px\)[\s\S]*?\.pp-game-body>p\{[\s\S]*?-webkit-line-clamp:3/u, "Phone game cards must clamp copy instead of forcing broken oversized cards.");
assert.match(css, /@media\(max-width:767px\)[\s\S]*?\.pp-game\{[\s\S]*?grid-template-columns:1fr/u, "Phone game cards must stack artwork over copy instead of creating skinny text columns.");
assert.match(css, /@media\(max-width:767px\)[\s\S]*?\.pp-game-art\{[\s\S]*?aspect-ratio:16\/9/u, "Phone game art must keep a stable widescreen stage.");
assert.match(v2Css, /\.pp2-shell\{--pp2-bg:#050a10[\s\S]*?--pp2-panel:rgba\(6,13,20,\.94\)/u, "PhantomPlay V2 must default to a real dark theme.");
assert.match(v2Css, /html\[data-org-color-mode="light"\] \.pp2-shell/u, "PhantomPlay V2 must keep light mode explicit and separate.");
assert.match(v2Css, /\.pp2-art img\{[\s\S]*?object-fit:contain/u, "PhantomPlay V2 thumbnails must show full art instead of zoom-cropping covers.");
assert.match(css, /\.pp-dev-list/u, "Developer directory cards must be styled.");
assert.match(css, /\.pp-dev-profile/u, "Developer profile views must be styled.");
assert.match(css, /\.pp-dev-notes/u, "Developer notes must be styled.");
assert.match(css, /\.pp-player-exit/u, "The player needs a stage-level exit control over the game iframe.");
assert.match(css, /workspace-page:has\(\.pp-player\)[^{]*\.workspace-page-body\{[^}]*transform:none!important/u, "The game player must escape the animated page containing block.");
assert.match(css, /@media\(max-width:767px\)[\s\S]*\.pp-player\{[\s\S]*grid-template-rows:auto minmax\(0,1fr\)/u, "Phone player chrome must leave the game as the main row.");
assert.match(css, /@media\(max-width:767px\)[\s\S]*\.pp-player>footer\{[\s\S]*display:none/u, "Phone player sessions must hide the footer while a game is open.");
assert.match(staticServer, /urlPath\.startsWith\("\/api\/phantomplay"\)/u, "The live admin server must proxy PhantomPlay API routes.");
assert.match(cubeTown, /const GRID = 17/u, "CubeTown must stay expanded beyond the original small grid.");
assert.match(cubeTown, /const NPC_DEFS = \[[\s\S]*Ori the Archivist/u, "CubeTown must include the larger resident cast.");
assert.match(cubeTown, /const TRIAL_DEFS = \[[\s\S]*Spire Heart Trial/u, "CubeTown must include shrine trials for the adventure playthrough.");
assert.match(cubeTown, /function openGate\(\)/u, "CubeTown must include the Prism Gate finale.");
assert.match(cubeTownIndex, /data-ct-open="questlog"/u, "CubeTown must expose a Quest Log for the larger playthrough.");
assert.match(cubeTownIndex, /data-ct-panel="trial"/u, "CubeTown must expose a playable shrine trial panel.");
assert.match(flagshipCatalog, /id:\s*"cubetown"[\s\S]*version:\s*"1\.3\.0"/u, "CubeTown catalog metadata must advertise the expanded version.");

const buildIds = new Set(appFiles.flatMap((source) => source.match(/phantom-live-\d{8}-\d+/gu) || []));
assert.equal(buildIds.size, 1, `The PhantomPlay module graph must use one build ID, found: ${[...buildIds].join(", ")}`);
assert.doesNotMatch(module + v2Module, /id:\s*`offline-\$\{Date\.now\(\)\}`|offlinePlay\(/u, "PhantomPlay must not create local-only play sessions; launches require the backend play-session route.");
assert.match(module + v2Module, /\/api\/phantomplay\/plays/u, "PhantomPlay launches must call the backend play-session route.");

for (const game of games) {
  assert.match(game, /Content-Security-Policy/u, "Every built-in game must set a CSP.");
  assert.match(game, /connect-src 'none'/u, "Built-in games must block network access.");
  assert.match(game, /source:'phantomplay-game'/u, "Built-in games must use the host protocol.");
  assert.doesNotMatch(game, /https?:\/\//u, "Built-in games must not call external services.");
  assert.doesNotMatch(game, /font-size:clamp\([^;]*vw/u, "Game type must not scale directly with viewport width.");
  assert.match(game, /event\.data\.type==='pause'/u, "Every built-in game must respond to host pause controls.");
  assert.match(game, /event\.data\.type==='exit'/u, "Every built-in game must respond to host exit controls.");
  assert.match(game, /event\.data\.type==='restart'/u, "Every built-in game must respond to host restart controls.");
  const inlineScript = game.match(/<script>([\s\S]*?)<\/script>/u)?.[1] || "";
  assert.doesNotThrow(() => new Function(inlineScript), "Every built-in game script must parse.");
  assert.match(game, /data-score/u, "Every built-in game must expose a visible score HUD.");
  assert.match(game, /host\([^;]*\{score/u, "Every built-in game must report score updates to PhantomPlay.");
}

assert.match(games[0], /\.start\[hidden\][^{]*\{display:none\}/u, "Neon Drift's start overlay must actually leave the play field.");
assert.match(neonDrift, /invuln/u, "Neon Drift must give the ship a short grace window after damage.");
assert.match(neonDrift, /maxSpeed=\.0032/u, "Neon Drift ship speed must stay tuned for fast arcade responsiveness.");
assert.match(neonDrift, /accel=\.000055\*W/u, "Neon Drift needs punchier acceleration.");
assert.match(neonDrift, /drag=Math\.pow\(\.91,dt\/16\)/u, "Neon Drift must keep enough glide to feel fast.");
assert.match(neonDrift, /player\.vx\+=\(tx-player\.x\)\*\.00054\*W/u, "Neon Drift touch-drag must chase faster on mobile.");
assert.match(neonDrift, /c\.addEventListener\('pointerdown'[\s\S]*touchMove\(event\)/u, "Neon Drift must steer directly from the play field on touch screens.");
assert.doesNotMatch(neonDrift, /data-touch|class="touch"|class="pad"|DRAG TO FLY|drag to move|Drag to move|Touch and drag on mobile|touch-drag/u, "Neon Drift mobile controls must not render duplicate touch pads or obvious touch instructions.");
assert.match(neonDrift, /Math\.max\(130,390-wave\*18\)/u, "Neon Drift waves should spawn quickly enough to stay exciting.");
assert.match(neonDrift, /t\*\.000055/u, "Neon Drift background motion should feel fast enough.");
assert.match(neonDrift, /e\.y>1\.12\)\{e\.dead=true\}/u, "Escaped enemies should leave the field without damaging the player.");
assert.doesNotMatch(neonDrift, /e\.y>1\.08\)\{e\.dead=true;damage\(\)\}/u, "Escaped enemies must not cause invisible hull damage.");
assert.doesNotMatch(games[2], /function size\(\)\{[^}]*reset\(\)/u, "Focus Stack must not erase a run when the mobile viewport resizes.");
assert.match(games[gameSlugs.indexOf("word-weld")], /Daily Weld|Buddy Duel|pf\.wordweld|function grade\(word\)|dayKey/u, "Word Weld must be the daily Wordle-inspired puzzle with buddy-duel support.");
assert.match(games[gameSlugs.indexOf("type-storm")], /vertical word-rain|stormAlpha|letters=w\.text\.toUpperCase\(\)\.split|w\.height/u, "Type Storm must render as vertical falling word rain, not a flat old typing list.");
assert.match(games[gameSlugs.indexOf("pixel-bloom")], /no timer|no pressure|source:'phantomplay-game'/u, "Pixel Bloom must remain a gentle toddler-friendly built-in.");
const riftFrenzy = games[gameSlugs.indexOf("rift-frenzy")];
const riftFrenzyScript = riftFrenzy.match(/<script>([\s\S]*)<\/script>/u)?.[1] || "";
assert.match(riftFrenzy, /school-to-grow|10-second cooldown|Solo \+ bots|2 players|3 players|4 players/u, "Rift Frenzy must be the school-to-grow survival arena with solo and 1-4 player starts.");
assert.match(riftFrenzy, /const colors=\["#46ffd0","#ff4d7d","#67a7ff","#ffe066"\]/u, "Rift Frenzy must run four colored schools.");
assert.match(riftFrenzy, /function addFollower\(team,source\)[\s\S]*team\.school\.push/u, "Rift Frenzy must convert fish into school followers instead of only deleting them.");
assert.match(riftFrenzy, /absorbCooldown:10000/u, "Rift Frenzy absorb must use the exact 10-second cooldown.");
assert.match(riftFrenzy, /function absorbSchool\(team\)[\s\S]*team\.absorbCd=CONFIG\.absorbCooldown/u, "Rift Frenzy must turn carried schools into permanent growth.");
assert.match(riftFrenzy, /function stealFromSchool\(thief,owner,fishIndex/u, "Rift Frenzy must support skill-based school stealing.");
assert.match(riftFrenzy, /const reefs=\[[\s\S]*const kelp=\[[\s\S]*const caves=\[[\s\S]*const currents=\[[\s\S]*const whirlpools=\[/u, "Rift Frenzy must include real map hazards and traversal zones.");
assert.match(riftFrenzy, /const .*predators=\[/u, "Rift Frenzy must include predator pressure.");
assert.match(riftFrenzy, /camera\.zoom/u, "Rift Frenzy must zoom the camera as the player grows.");
assert.match(riftFrenzy, /function eliminate\(victim,killer\)[\s\S]*alive=false/u, "Rift Frenzy must eliminate rivals instead of ending only by timer score.");
assert.match(riftFrenzy, /function thinkBot\(team\)[\s\S]*team\.ai\.absorb=true/u, "Rift Frenzy bots must understand absorb timing.");
assert.match(riftFrenzy, /human:i<humanCount/u, "Rift Frenzy solo must fill non-human schools with bots.");
assert.match(riftFrenzy, /document\.querySelectorAll\("\[data-mode-start\]"\)/u, "Rift Frenzy must expose local 1-4 player mode buttons.");
assert.match(games[gameSlugs.indexOf("rift-frenzy")], /const steer=1-Math\.pow\(\.72,dt\/16\)/u, "Rift Frenzy movement must use frame-stable steering instead of overcorrecting.");
assert.match(games[gameSlugs.indexOf("rift-frenzy")], /friction=target\.active\|\|ax\|\|ay\?1:Math\.pow\(\.9,dt\/16\)/u, "Rift Frenzy must coast cleanly instead of drifting forever.");
assert.match(games[gameSlugs.indexOf("rift-frenzy")], /team\.vx=\(team\.vx\+\(ax\/len\*speed-team\.vx\)\*steer\)\*friction/u, "Rift Frenzy horizontal control must interpolate toward input safely.");
assert.match(games[gameSlugs.indexOf("rift-frenzy")], /for\(let i=0;i<24;i\+\+\)spawnFish\(true\)/u, "Rift Frenzy must start with enough edible fish to be playable immediately.");
assert.match(games[gameSlugs.indexOf("rift-frenzy")], /target\.boost=false/u, "Rift Frenzy touch boost must release when touch ends.");
assert.doesNotThrow(() => new Function(riftFrenzyScript), "Rift Frenzy script must parse after the school-conversion rewrite.");
for (const slug of ["crown-circuit", "kingdom-breakers", "tidefront-tactics", "skyguard-arena"]) {
  assert.match(module, new RegExp(`id:\\s*"${slug}"`, "u"), `${slug} must be restored to the frontend fallback catalog.`);
  assert.match(module, new RegExp(`GAME_ART_BY_SLUG\\["${slug}"\\]`, "u"), `${slug} must use dedicated PhantomPlay game art.`);
  assert.match(flagshipCatalog, new RegExp(`id:\\s*"${slug}"`, "u"), `${slug} must be registered as a server-side flagship game.`);
}
assert.match(crownCircuit, /Solo Training \+ Room Multiplayer|Solo Training vs Bot|Crown Bot/u, "Crown Circuit must start with solo bot training, not a room-only dead end.");
assert.match(crownCircuit, /function thinkBot\(dt\)[\s\S]*laneThreat[\s\S]*deploy\('red'/u, "Crown Circuit solo mode must include a real bot that deploys against the player.");
assert.match(crownCircuit, /Start room match|Room .*you are/u, "Crown Circuit must still keep private room duel support.");
assert.match(crownCircuit, /id:\s*"obsidian"[\s\S]*Obsidian Relay/u, "Crown Circuit must include the new Obsidian Relay map.");
assert.match(crownCircuit, /id:\s*"oracle"[\s\S]*slow:\s*1\.9[\s\S]*shieldBreak/u, "Crown Circuit Oracle must be a real slowing/control troop, not just card copy.");
assert.match(crownCircuit, /id:\s*"ram"[\s\S]*towerBonus:\s*2\.65[\s\S]*buildingHunter:\s*true/u, "Crown Circuit Ram must be a real siege-tank troop.");
assert.match(crownCircuit, /const BATTLE_PLANS = \[[\s\S]*Siege Push[\s\S]*Control Lock[\s\S]*Tempo Cycle/u, "Crown Circuit must expose selectable battle plans instead of one flat deck style.");
assert.match(crownCircuit, /function troopPlanStats\(side, troop\)[\s\S]*plan\.id === "siege"[\s\S]*plan\.id === "tempo"/u, "Crown Circuit battle plans must tune real troop stats.");
assert.match(crownCircuit, /launchProjectile\(unit, target,[\s\S]*slow:\s*planTroop\.slow[\s\S]*sourceTroop:\s*planTroop/u, "Crown Circuit projectile attacks must carry plan-tuned troop-specific control effects.");
assert.match(crownCircuit, /target\.slow = Math\.max\(target\.slow, projectile\.slow\)/u, "Crown Circuit Oracle slow must actually apply to hit units.");
assert.match(crownCircuit, /\["ranger", "bombard", "sapper", "wisps", "medic", "charger", "oracle", "ram"\]/u, "Crown Circuit bot loadouts must know the new Oracle/Ram cards.");
assert.match(crownCircuit, /const MAX_ELIXIR = 10[\s\S]*const HAND_SIZE = 4[\s\S]*const DECK_SIZE = 8/u, "Crown Circuit must use an 8-card deck, four-card hand, and 10 elixir cap.");
assert.match(crownCircuit, /function cycleCard\(side, cardIndex\)[\s\S]*drawQueue\[side\][\s\S]*queue\.push\(used\)/u, "Crown Circuit must cycle played cards back through the draw queue.");
assert.match(crownCircuit, /selectedTroops\.length !== DECK_SIZE[\s\S]*eight-card loadout/u, "Crown Circuit boot checks must validate the 8-card deck instead of crashing on the old 4-card assumption.");
assert.doesNotThrow(() => new Function(crownCircuitScript), "Crown Circuit script must parse.");
assert.doesNotThrow(() => new Function(skyguardArena), "Skyguard Arena script must parse.");
assert.match(skyguardArena, /id:\s*"neontangle"[\s\S]*Neon Tangle[\s\S]*Braided relay race/u, "Skyguard Arena must include the new Neon Tangle map.");
assert.match(skyguardArena, /routes:\s*\[\s*\[\[\.02,\.53\][\s\S]*\]\s*\],[\s\S]*slots:/u, "Skyguard Cloudbreak must use one big winding route instead of three split lanes.");
assert.match(skyguardArena, /function triggerRelaySurge\(\)[\s\S]*surge:\s*true/u, "Skyguard Neon Tangle must have a distinct relay surge event.");
assert.match(skyguardArena, /currentMap\(\)\.id === "neontangle"[\s\S]*triggerRelaySurge\(\)/u, "Skyguard Neon Tangle hazard clock must trigger the relay surge.");
assert.match(skyguardArena, /effect\.type === "relay" && effect\.surge[\s\S]*dealDamage\(enemy, 18[\s\S]*enemy\.slowUntil/u, "Skyguard Neon Tangle relay surge must damage and slow clustered enemies.");
assert.match(skyguardArena, /function seedOpeningDefenses\(\)[\s\S]*makeSentinel\(defId, pick\.point, 0, true\)/u, "Skyguard Arena must auto-seed starter sentries so round one cannot begin naked.");
assert.match(skyguardArena, /function tryPlaceAt\(point\)[\s\S]*buildBlockReason\(point\)[\s\S]*makeSentinel\(def\.id, point/u, "Skyguard Arena must support free off-road Sentinel placement.");
assert.match(skyguardArena, /const PATH_KEYS = \["power", "reach", "tech"\][\s\S]*function upgradePathSelected\(pathId\)/u, "Skyguard Arena must expose three BTD-style Sentinel upgrade paths.");
assert.match(skyguardArena, /function applySentinelPathStats\(stats, sentinel\)[\s\S]*tech >= 3 \? 1 : 0/u, "Skyguard Tech path must unlock a real chain effect at max tech.");
assert.match(skyguardArena, /count:\s*1,\s*gap:\s*0,\s*formation:\s*1/u, "Skyguard campaign round one must start with a single enemy.");
assert.match(skyguardArena, /if \(n >= 3\) entries\.push\(\{ type: "skiff"/u, "Skyguard Century Watch must delay surprise air units until after the opener.");
assert.match(module, /id: "crown-circuit"[\s\S]*battle plans[\s\S]*launchUrl: "\/app\/games\/crown-circuit\.html\?v=1\.3\.3"[\s\S]*version: "1\.3\.3"/u, "Default catalog must launch and describe the upgraded Crown Circuit 1.3.3 build.");
assert.match(module, /id: "skyguard-arena"[\s\S]*three-path Sentinel upgrades[\s\S]*launchUrl: "\/app\/games\/skyguard-arena\/index\.html\?v=1\.3\.3"[\s\S]*version: "1\.3\.3"/u, "Default catalog must launch and describe the upgraded Skyguard Arena 1.3.3 build.");
assert.match(v2Module, /\["crown-circuit", "Crown Circuit", "Strategy", "\/app\/games\/crown-circuit\.html\?v=1\.3\.3"\]/u, "V2 offline catalog must launch upgraded Crown Circuit.");
assert.match(v2Module, /\["skyguard-arena", "Skyguard Arena", "Strategy", "\/app\/games\/skyguard-arena\/index\.html\?v=1\.3\.3"\]/u, "V2 offline catalog must launch upgraded Skyguard Arena.");
assert.match(v2Module, /id === "skyguard-arena" \? "1\.3\.3" : id === "crown-circuit" \? "1\.3\.3"/u, "V2 offline catalog must expose Skyguard 1.3.3 and Crown Circuit 1.3.3.");
assert.match(flagshipCatalog, /id:\s*"skyguard-arena"[\s\S]*three-path upgrades[\s\S]*version:\s*"1\.3\.3"/u, "Server flagship catalog must describe the upgraded Skyguard Arena 1.3.3 build.");
assert.match(flagshipCatalog, /id:\s*"crown-circuit"[\s\S]*battle plans[\s\S]*version:\s*"1\.3\.3"/u, "Server flagship catalog must describe the upgraded Crown Circuit 1.3.3 build.");
assert.match(tidefrontTactics, /Arrow keys to adjust angle\/power|Space to fire|Fleet Room/u, "Tidefront Tactics must remain the restored artillery battle.");
assert.match(games[gameSlugs.indexOf("serpent-surge")], /storm|boost|rival|serpent|trail/u, "Serpent Surge must play as a modern snake arena, not a static old mini-game.");
assert.match(phantomRumble, /shieldHeld|data-t="shield"|PARRY/u, "Phantom Rumble must have real guard and parry mechanics.");
assert.match(phantomRumble, /function dodge|dodgeCd|data-t="dodge"/u, "Phantom Rumble must have an active dodge verb on keyboard and touch.");
assert.match(phantomRumble, /function tryLedgeGrab|ledgeSide|LEDGE/u, "Phantom Rumble must include ledge-save recovery so close KOs stay playable.");
assert.match(phantomRumble, /ledgeCooldown:0/u, "Phantom Rumble fighters must track a ledge cooldown.");
assert.match(phantomRumble, /if\(f\.ledge>0\)\{[\s\S]*f\.ledgeCooldown=\.75[\s\S]*f\.x\+=-side\*\.02[\s\S]*return/u, "Phantom Rumble ledge jumps must push fighters away from the ledge and prevent immediate re-grabs.");
assert.match(phantomRumble, /if\(f\.ledge>0\|\|f\.ledgeCooldown>0\|\|f\.vy<0/u, "Phantom Rumble ledge grabs must respect cooldown lockout.");
assert.match(phantomRumble, /if\(f\.ledge>0\)\{[\s\S]*!f\.human[\s\S]*jump\(f\)[\s\S]*f\.ai\.jumpCd=\.55/u, "Phantom Rumble bots must auto-recover from ledge instead of looping.");
assert.match(phantomRumble, /function updateCamera|camera\.z|function sx/u, "Phantom Rumble must keep a dynamic arena camera without breaking normalized stage sizing.");
assert.match(phantomRumble, /touch-action:none|overscroll-behavior:none|env\(safe-area-inset-bottom\)/u, "Phantom Rumble must be tuned for mobile touch play.");
assert.match(kingdomBreakers, /function buildDuelLevel\(seed\)/u, "Kingdom Breakers duel mode must build a dedicated two-castle arena.");
assert.doesNotThrow(() => new Function(kingdomBreakersScript), "Kingdom Breakers script must parse after duel arena changes.");
assert.match(kingdomBreakers, /owner:'player'[\s\S]*owner:'bot'/u, "Kingdom Breakers duel mode must assign separate player and bot castle ownership.");
assert.match(kingdomBreakers, /function targetOwnerForShooter\(shooter\)/u, "Kingdom Breakers duel projectiles must resolve against the opposing castle only.");
assert.match(kingdomBreakers, /predictTrajectory\(ammoKey,ang,pw,220,'bot'\)/u, "Kingdom Breakers bot aim prediction must originate from the bot engine.");
assert.match(kingdomBreakers, /function duelWardenDown\(owner\)/u, "Kingdom Breakers duel mode must end around Warden defeat, not shared breach score.");
assert.match(kingdomBreakers, /duelWardenDown\('bot'\)[\s\S]*duelWardenDown\('player'\)/u, "Kingdom Breakers duel end checks must inspect both Wardens.");

const imBaked = games[gameSlugs.indexOf("im-baked")];
assert.match(imBaked, /Story Shift[\s\S]*Rush Counter/u, "I'm Baked must provide two real shift modes.");
assert.match(imBaked, /function makeOrder\(\)[\s\S]*function scoreCake\(\)/u, "I'm Baked must generate and score customer orders.");
assert.match(imBaked, /phase==='build'[\s\S]*phase==='bake'[\s\S]*phase==='decorate'[\s\S]*phase==='serve'/u, "I'm Baked must implement build, bake, decorate, and serve stations.");

const phantomStrike = games[gameSlugs.indexOf("phantom-strike")];
assert.match(phantomStrike, /Solo Ops[\s\S]*Local 1v1/u, "Phantom Strike must clearly distinguish bots from real local multiplayer.");
assert.match(phantomStrike, /blackridge:\{[\s\S]*ironworks:\{[\s\S]*dockyard:\{[\s\S]*bazaar:\{/u, "Phantom Strike must ship four distinct arena maps.");
assert.match(phantomStrike, /data-map="bazaar"[\s\S]*Neon Bazaar/u, "Phantom Strike must expose the new Neon Bazaar map in the UI.");
assert.match(phantomStrike, /marksman:\{name:'KRAKEN DMR'[\s\S]*damage:42/u, "Phantom Strike must include the new DMR weapon build.");
assert.match(phantomStrike, /const wk=\['smg','rifle','marksman','shotgun'\]/u, "Phantom Strike bots must use the new DMR instead of ignoring it.");
assert.match(phantomStrike, /function castRay\([\s\S]*function renderView\(/u, "Phantom Strike must use a real first-person ray-cast renderer.");
assert.match(phantomStrike, /if\(mode==='duel'\)\{renderView\(players\[0\][\s\S]*renderView\(players\[1\]/u, "Phantom Strike local duel must render genuine split-screen views.");
assert.doesNotThrow(() => new Function(vespergateGame), "Vespergate game script must parse.");
assert.doesNotThrow(() => new Function(vespergateRooms), "Vespergate room script must parse.");
assert.doesNotThrow(() => new Function(vespergateEngine), "Vespergate engine script must parse.");
assert.match(vespergateRooms, /id:\s*"hollow1"[\s\S]*Hollow Geometry/u, "Vespergate must retain the Hollow Geometry dungeon.");
assert.match(vespergateRooms, /id:\s*"ossuary1"[\s\S]*Glass Ossuary/u, "Vespergate must retain the Glass Ossuary dungeon.");
assert.match(vespergateGame, /const order = \["q_evensong", "q_glass", "q_bell", "q_lantern", "q_wolves", "q_hand"\]/u, "Vespergate progress must cover the current six-quest campaign.");
assert.match(vespergateGame, /state\.flags\.evensong = true[\s\S]*host\("complete", \{ score: state\.score, progress: 100/u, "Vespergate must report the evensong finale to PhantomPlay.");
assert.match(vespergateIndex, /data-vg-fullscreen[\s\S]*data-vg-pause/u, "Vespergate must expose in-game fullscreen and pause controls.");
assert.match(vespergateEngine, /devicePixelRatio[\s\S]*backingScale[\s\S]*VG\.renderScale/u, "Vespergate must render through a high-density backing canvas.");
assert.match(vespergateEngine, /requestFullscreen[\s\S]*fullscreenchange/u, "Vespergate must implement and synchronize fullscreen mode.");
assert.match(vespergateGame, /SOUL CHAIN[\s\S]*bestCombo/u, "Vespergate must expose Soul Chain combat scoring.");

// Dev Mode (docs/architecture/PHANTOMPLAY_DEV_MODE.md): the entry point must
// only ever render server-gated, and the preview iframe must always be as
// tightly sandboxed as the real player iframe. This is a static guardrail,
// not the actual security boundary (the server re-checks access on every
// route) — but a regression here would be the first sign the boundary is
// eroding.
assert.match(module, /game\.devModeAvailable \? `<button class="pp-devsandbox-open"/u, "The Dev Sandbox entry point must only render when the server-reported devModeAvailable flag is true.");
assert.match(module, /sandbox="allow-scripts allow-pointer-lock"[^>]*data-pp-frame/u, "The Dev Sandbox player iframe must remain opaque-origin sandboxed.");
assert.match(module, /const blob = new Blob\(\[nextSource\], \{ type: "text\/html" \}\)/u, "Dev Mode edits must apply via a local blob URL, never a same-origin write.");
assert.doesNotMatch(module, /devmode[\s\S]{0,200}(child_process|new Function|\.eval\()/iu, "The host page's Dev Mode code must never itself execute the edited source — only the sandboxed iframe does, by loading it as a document.");
assert.match(module, /data-pp-devsandbox-code-open/u, "Game cards must expose the small code icon as the direct full-source editor entry point.");
assert.match(module, /openDevWorkbench\(button\.dataset\.ppDevsandboxCodeOpen, "code"\)/u, "The small code icon must open the code/mod workbench without launching the game.");
assert.match(module, /function launchDevSandboxFromWorkbench\(\)[\s\S]*pendingDevSandboxBootState/u, "The code workbench must be able to launch the game into sandboxed Dev Mode from the prepared source.");
assert.match(module, /data-pp-devworkbench-launch/u, "The pre-launch workbench must expose a Dev Mode launch action.");
assert.match(module, /data-pp-devworkbench-save/u, "The pre-launch workbench must expose an explicit local draft save action.");
assert.match(module, /data-pp-devworkbench-close/u, "The pre-launch workbench must expose a clear close action.");
assert.match(module, /function launchDevSandboxFromWorkbench\(\)[\s\S]*new Blob\(\[nextSource\][\s\S]*ui\.devSandbox[\s\S]*launch\(gameId\)/u, "Launching from the workbench must boot the edited blob immediately instead of flashing the shipped game first.");
assert.match(v2Module, /data-pp2-devsandbox-code-open/u, "PhantomPlay v2 game cards must expose the small code icon too.");
assert.match(v2Module, /openDevWorkbench\(b\.dataset\.pp2DevsandboxCodeOpen, "code"\)/u, "PhantomPlay v2 code icon must open the workbench without launching the game.");
assert.doesNotMatch(module, /data-pp-devmode-toggle/u, "The small code icon must not be a separate Dev Mode toggle.");
assert.match(module, /section:\s*"code"/u, "Dev Mode must open directly to the full game source code.");
assert.match(module, /DEV_SANDBOX_AUTOSAVE_KEY/u, "Dev Mode must keep a local autosave draft for full-source edits.");
assert.match(module, /devSandboxAutosaveTimer = setTimeout\(snapshotDevSandboxLocalDraft, 1000\)/u, "Dev Mode edits must autosave only to the local draft while typing.");
assert.doesNotMatch(module, /setTimeout\(\(\) => persistDevSandboxOverride\(\{ silent: true \}\), 1000\)/u, "Dev Mode typing must not silently sync workspace overrides mid-gameplay.");
assert.match(module, /Save & Resync/u, "Dev Mode must require an explicit Save & Resync trigger before syncing code.");
assert.match(module, /snapshotDevSandboxLocalDraft\(\);[\s\S]*clearTimeout\(devSandboxAutosaveTimer\)/u, "Closing Dev Mode must snapshot the current source before clearing autosave timers.");
assert.match(serverCatalog, /function inlineDevModeGameAssets[\s\S]*<style data-phantomplay-dev-bundled[\s\S]*<script[\s\S]*data-phantomplay-dev-bundled/u, "Dev Mode source must inline same-folder CSS/JS so multi-file games run as a standalone editable blob.");
assert.doesNotMatch(css + v2Css, /\.pp2?-player\.is-devsandbox\{grid-template-columns:minmax\(0,1fr\) minmax/u, "Dev Mode must not squeeze the running game into a side-by-side editor.");
assert.match(css, /\.pp-devsandbox\{position:absolute[\s\S]*width:min\(760px,calc\(100% - 28px\)\)/u, "Dev Mode must render as a wide full-source drawer over the full-size game.");
assert.match(css, /\.pp-devworkbench\{position:fixed[\s\S]*width:min\(1180px,calc\(100vw - 36px\)\)/u, "The code icon must open a pre-launch full-source workbench.");
assert.match(css, /\.pp-devsandbox-minimized/u, "Dev Mode must support minimizing the code drawer while the sandboxed game keeps running.");

console.log("PhantomPlay frontend and game safety checks passed.");

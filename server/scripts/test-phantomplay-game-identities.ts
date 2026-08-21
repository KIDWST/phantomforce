import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const unrealRoot = path.join(repoRoot, "packages", "phantom-games-unreal");

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

const registry = readJson<{
  engine: string;
  project: string;
  games: Array<{
    id: string;
    genre: string;
    camera: string;
    executable: string;
    source: string;
    key_art: string;
    save_namespace: string;
    identity_invariants: string[];
  }>;
}>("docs/phantomplay-production/game-registry.json");

const expectedIds = ["phantom-ages", "phantom-legends", "phantom-strike"];
assert.match(registry.engine, /^Unreal Engine 5/);
assert.equal(registry.project, "packages/phantom-games-unreal/PhantomGames.uproject");
assert.deepEqual(registry.games.map((game) => game.id).sort(), expectedIds, "Flagship registry must contain exactly three games");
assert.equal(new Set(registry.games.map((game) => game.source)).size, 3, "Every flagship must own a distinct Unreal director");
assert.equal(new Set(registry.games.map((game) => game.save_namespace)).size, 3, "Every flagship must own a distinct save namespace");
assert.equal(new Set(registry.games.map((game) => game.key_art)).size, 3, "Every flagship must own distinct canonical key art");

for (const game of registry.games) {
  assert.ok(game.identity_invariants.length >= 3, `${game.id} needs enforceable identity invariants`);
  assert.ok(existsSync(path.join(unrealRoot, game.source)), `${game.id} Unreal source is missing`);
  assert.ok(existsSync(path.join(unrealRoot, game.key_art)), `${game.id} key art is missing`);
  assert.ok(game.save_namespace.endsWith("."), `${game.id} save namespace must be prefix-safe`);
  assert.match(game.executable, new RegExp(`Builds/Windows/${game.id}/`));
}

const project = read("packages/phantom-games-unreal/PhantomGames.uproject");
assert.match(project, /"Name": "PhantomGames"/);
assert.match(project, /"EngineAssociation": "5\.8"/);

const targetContracts: Array<[string, string]> = [
  ["PhantomStrike.Target.cs", "phantom-strike"],
  ["PhantomAges.Target.cs", "phantom-ages"],
  ["PhantomLegends.Target.cs", "phantom-legends"],
  ["Cubetown.Target.cs", "cubetown"],
];
for (const [targetFile, gameId] of targetContracts) {
  const target = read(`packages/phantom-games-unreal/Source/${targetFile}`);
  assert.ok(target.includes(`PHANTOM_DEFAULT_GAME=TEXT(\\"${gameId}\\")`), `${targetFile} must default to ${gameId}`);
}

const ids = read("packages/phantom-games-unreal/Source/PhantomGames/Private/Core/PhantomGameIds.cpp");
assert.match(ids, /TEXT\("phantom-strike"\)/);
assert.match(ids, /TEXT\("phantom-ages"\)/);
assert.match(ids, /TEXT\("phantom-legends"\)/);
assert.match(ids, /TEXT\("cubetown"\)/);
assert.match(ids, /TEXT\("phantomstrike\."\)/);
assert.match(ids, /TEXT\("phantomages\."\)/);
assert.match(ids, /TEXT\("phantomlegends\."\)/);
assert.match(ids, /TEXT\("cubetown\.echoes\."\)/);

const router = read("packages/phantom-games-unreal/Source/PhantomGames/Private/Core/PhantomRouterGameMode.cpp");
assert.match(router, /DefaultPawnClass = APhantomStrikeCharacter::StaticClass/);
assert.match(router, /DefaultPawnClass = APhantomAgesPawn::StaticClass/);
assert.match(router, /DefaultPawnClass = APhantomLegendsPawn::StaticClass/);
assert.match(router, /DefaultPawnClass = ACubetownHero::StaticClass/);
assert.match(router, /SpawnActor<APhantomStrikeDirector>/);
assert.match(router, /SpawnActor<APhantomAgesDirector>/);
assert.match(router, /SpawnActor<APhantomLegendsDirector>/);
assert.match(router, /SpawnActor<ACubetownDirector>/);
assert.match(router, /Unknown -PhantomGame identity/);

const strike = read("packages/phantom-games-unreal/Source/PhantomGames/Private/Strike/PhantomStrikeDirector.cpp");
assert.match(strike, /LineTraceSingleByChannel/);
assert.match(strike, /ApplyPointDamage/);
assert.match(strike, /Health = FMath::Max\(0\.0f, Health - Applied\)/);
assert.match(strike, /SpawnActor<APhantomStrikeEnemy>/);
assert.match(strike, /OBJECTIVE: ADVANCE TO THE BLACKRIDGE CHECKPOINT/);
assert.match(strike, /COMMAND CENTER BREACH[\s\S]*SECURE THE UPLINK/);
assert.match(strike, /OBJECTIVE: REACH MARINA EXTRACTION/);
assert.match(strike, /APhantomStrikeSquadmate[\s\S]*suppression\/readability only/);
assert.match(strike, /FlankWeight[\s\S]*ExposureRemaining[\s\S]*DecisionRemaining/);
assert.match(strike, /bTriggerHeld/);
assert.match(strike, /bAiming/);
assert.match(strike, /StrikeReloadDuration/);
assert.match(strike, /EPhantomStrikeEnemyRole::Heavy/);
assert.match(strike, /SpawnWave/);

const ages = read("packages/phantom-games-unreal/Source/PhantomGames/Private/Ages/PhantomAgesDirector.cpp");
assert.match(ages, /ProjectionMode = ECameraProjectionMode::Orthographic/);
assert.match(ages, /FixedBattlefieldCamera/);
assert.match(ages, /if \(UnitType == EPhantomAgesUnitType::Catapult\) return EnemyTower/);
assert.match(ages, /UnitType == EPhantomAgesUnitType::Springald && !It->IsSiege/);
assert.match(ages, /return Nearest \? Cast<AActor>\(Nearest\) : Cast<AActor>\(EnemyTower\)/);
assert.match(ages, /UnitType == EPhantomAgesUnitType::Catapult\) return Cast<APhantomAgesTower>\(Target\) \? Damage : 0\.0f/);
assert.match(ages, /Cast<APhantomAgesTower>\(Target\)\) return Damage \* 0\.62f/);
assert.match(ages, /const int32 FormationRank = bSiege \? 2 : \(bRanged \? 1 : 0\)/);
assert.match(ages, /TroopArmor/);
assert.match(ages, /InfantryDamage/);
assert.match(ages, /RangedDamage/);
assert.match(ages, /SiegeEngineering/);
assert.match(ages, /WarEconomy/);
assert.match(ages, /TowerPulseRemaining = 30\.0f/);
assert.match(ages, /FMath::Min\(3, Targets\.Num\(\)\)/);
assert.match(ages, /APhantomAgesProjectile/);
assert.match(ages, /SetBattleSpeed/);
assert.match(ages, /PlayerSiege/);

const legends = read("packages/phantom-games-unreal/Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp");
assert.match(legends, /StrategyBoom/);
assert.match(legends, /GetHitResultUnderCursor/);
assert.match(legends, /SetOrderLocation/);
assert.match(legends, /TrainWorker/);
assert.match(legends, /BuildDefenseTower/);
assert.match(legends, /phantomlegends\.profile/);
assert.match(legends, /SaveGameToSlot/);
assert.match(legends, /SetGatherTarget/);
assert.match(legends, /SpawnRaid/);
assert.match(legends, /RiftGate/);
assert.match(legends, /UpgradeStronghold/);

const cubetown = read("packages/phantom-games-unreal/Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp");
assert.match(cubetown, /BuildDreamWorld/);
assert.match(cubetown, /PlaceAtCursor/);
assert.match(cubetown, /ACubetownEcho/);
assert.match(cubetown, /ActivateNearbyShrine/);
assert.match(cubetown, /RiftGuardian/);
assert.match(cubetown, /cubetown\.echoes\.profile/);

const launcher = read("packages/phantomplay-dioxus-shell/src/main.rs");
assert.match(launcher, /const FLAGSHIP_UNREAL_GAME_IDS: \[&str; 3\]/);
assert.match(launcher, /const PHANTOMFORGE_UNREAL_GAME_IDS: \[&str; 4\]/);
assert.match(launcher, /"cubetown" => "Cubetown\.exe"/);
assert.match(launcher, /fn launch_unreal_game/);
assert.match(launcher, /engine: "Unreal Engine 5"/);
assert.match(launcher, /runtime\.renderer = "Unreal Engine 5"/);
assert.match(launcher, /return launch_unreal_game\(game_id\)/);
assert.match(launcher, /let spec = native_launch_spec\(game_id\)\?/);
assert.match(launcher, /engine: "Panda3D"/);
assert.match(launcher, /"Godot"/);
assert.match(launcher, /"Unity"/);
assert.match(launcher, /fn launch_declared_native_game/);
assert.match(launcher, /fn launch_unreal_project/);
assert.match(launcher, /fn launch_unity_project/);
assert.match(launcher, /fn launch_godot_project/);
assert.match(launcher, /"WebGPU"/);
assert.match(launcher, /"Canvas2D"/);
assert.doesNotMatch(launcher, /const UNITY_GAME_IDS/);
assert.doesNotMatch(launcher, /fn launch_unity_game/);
assert.doesNotMatch(launcher, /phantom-games-unity/);

const studio = read("packages/phantomplay-dioxus-shell/src/studio.rs");
assert.match(studio, /No legacy fallback was launched for this game/);
assert.match(studio, /Run opens \{\} in its own window/);
assert.match(studio, /is_godot_project_tree/);
assert.doesNotMatch(studio, /launched in Panda3D/);
assert.match(studio, /is_supported_native_project_tree/);

assert.equal(existsSync(path.join(repoRoot, "app", "games", "phantom-strike.html")), false, "Obsolete PhantomStrike web fallback must stay deleted");
assert.equal(existsSync(path.join(repoRoot, "app", "games", "phantom-strike", "native-runtime.json")), false, "Obsolete PhantomStrike Panda manifest must stay deleted");
assert.equal(existsSync(path.join(repoRoot, "app", "games", "phantom-ages", "index.html")), false, "Obsolete Phantom Ages web fallback must stay deleted");

const agesArt = path.join(unrealRoot, "SourceArt", "KeyArt", "phantom-ages-keyart.png");
const legendsArt = path.join(unrealRoot, "SourceArt", "KeyArt", "phantom-legends-keyart.png");
const strikeArt = path.join(unrealRoot, "SourceArt", "KeyArt", "phantom-strike-keyart.png");
assert.equal(new Set([sha256(agesArt), sha256(legendsArt), sha256(strikeArt)]).size, 3, "Every flagship needs distinct key art");

for (const id of expectedIds) {
  const bible = readJson<{ game_id: string; forbidden_crossovers: string[]; production_status: string }>(`docs/phantomplay-production/creative-bibles/${id}.json`);
  assert.equal(bible.game_id, id);
  assert.ok(bible.forbidden_crossovers.length >= 2);
  assert.match(bible.production_status, /Unreal/);
}

console.log("PhantomPlay identity guard passed: three Unreal flagships with multi-engine platform compatibility preserved.");

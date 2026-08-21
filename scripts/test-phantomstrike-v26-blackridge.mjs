#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const cpp = read("packages/phantom-games-unreal/Source/PhantomGames/Private/Strike/PhantomStrikeDirector.cpp");
const header = read("packages/phantom-games-unreal/Source/PhantomGames/Public/Strike/PhantomStrikeDirector.h");
const bible = read("docs/phantomplay-production/creative-bibles/phantom-strike.json");
const prompts = read("packages/phantom-games-unreal/Docs/Production/PHANTOMSTRIKE_V26_VISUAL_TARGET_PROMPTS.md");
const report = read("packages/phantom-games-unreal/Docs/Production/PHANTOMSTRIKE_V26_BLACKRIDGE_REPORT.md");
const checkpoint = read("packages/phantom-games-unreal/Docs/Production/PHANTOM_CODEX_CHECKPOINT.md");
const registry = read("docs/phantomplay-production/asset-registries/phantom-games-unreal.json");
const packager = read("packages/phantom-games-unreal/Tools/PackagePhantomStrikeV26R1.ps1");
const promoter = read("packages/phantom-games-unreal/Tools/Promote-PhantomStrikeV26R1.ps1");

for (const target of [
  "phantom-strike-v26-blackridge-gameplay-target.png",
  "phantom-strike-v26-blackridge-breach-target.png",
]) {
  assert.ok(
    existsSync(new URL(`../packages/phantom-games-unreal/SourceArt/VisualTargets/${target}`, import.meta.url)),
    `PhantomStrike V26 visual target must exist: ${target}`,
  );
  assert.match(registry, new RegExp(target.replaceAll(".", "\\."), "u"),
    `PhantomStrike V26 visual target must be registered: ${target}`);
}

assert.match(bible, /current_floor": "V26R1 Blackridge verified installed PhantomStrike release[\s\S]*V26R1 is the no-regression floor/u,
  "PhantomStrike must preserve V26R1 Blackridge as the installed no-regression floor.");
assert.match(prompts, /built-in ImageGen[\s\S]*exact scene, UI, map, character, logo, weapon, or protected game design[\s\S]*Runtime translation contract/u,
  "The V26 visual target workflow must remain reproducible and original.");

assert.doesNotMatch(cpp, /SK_(?:Rogue|Knight|Barbarian)\.SK_(?:Rogue|Knight|Barbarian)/u,
  "PhantomStrike must never resolve shared fantasy production bodies.");
assert.match(cpp, /Helix operator is the authoritative modern-military squad silhouette[\s\S]*SM_HelixRifleman/u,
  "The modern Helix operator family must be authoritative.");
assert.match(cpp, /RightTacticalForearm[\s\S]*LeftTacticalForearm[\s\S]*RightTacticalGlove[\s\S]*LeftTacticalGlove/u,
  "The first-person weapon must retain visible tactical arms and gloves.");
assert.match(header, /FVector2D WeaponInertia[\s\S]*FRotator LastViewRotation/u,
  "Weapon presentation must retain view inertia state.");
assert.match(cpp, /SpawnEjectedCasing[\s\S]*ShotImpulse[\s\S]*MuzzleBloom/u,
  "Gunfire must retain casing, recoil, and warm muzzle presentation.");
assert.match(cpp, /bDying[\s\S]*CollapseAlpha[\s\S]*SetLifeSpan\(3\.0f\)/u,
  "Operators must collapse instead of disappearing immediately.");
assert.match(cpp, /V26 sight picture[\s\S]*Compact objective card[\s\S]*TEAM %d\/2[\s\S]*SECURE THE RELAY/u,
  "The restrained Blackridge HUD must remain intact.");
assert.match(cpp, /BuildV26BlackridgeAtmosphere[\s\S]*V26InsertionDisabledCar[\s\S]*V26RelayServer[\s\S]*V26BreachLintel/u,
  "The wet-coast combat dressing and relay breach silhouettes must remain intact.");

assert.match(packager, /CandidateBuilds\\\$Revision\\phantom-strike[\s\S]*visual_profile=blackridge-grounded-combat-v26[\s\S]*installed_floor=V25R3[\s\S]*promotion=automatic_after_verified_local_gates/u,
  "V26 packaging must stay isolated and auto-promote only after verified local gates.");
assert.match(promoter, /automatic_after_verified_local_gates[\s\S]*phantomplay-phantom-strike-[\s\S]*Installed Shipping binary[\s\S]*prior install was restored/u,
  "V26 promotion must be automatic after verification, transactional, hash-checked, and recoverable.");
assert.match(report, /PROMOTED AND VERIFIED INSTALLED[\s\S]*38226D4F896569CAB17708C159A0DAFE3100526D05CE724AEF8AB6717E773E2B[\s\S]*phantomplay-phantom-strike-v25r3-cubetown-v19r1-to-v26r1/u,
  "The V26 report must preserve installed and rollback evidence.");
assert.match(checkpoint, /PhantomStrike V26R1 Blackridge installed[\s\S]*PROMOTED AND VERIFIED INSTALLED/u,
  "The shared checkpoint must retain the V26 installed disposition.");

console.log("PHANTOMSTRIKE_V26_BLACKRIDGE_PASS");

#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const cpp = read("packages/phantom-games-unreal/Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp");
const header = read("packages/phantom-games-unreal/Source/PhantomGames/Public/Cubetown/CubetownDirector.h");
const bible = read("docs/phantomplay-production/creative-bibles/cubetown.json");
const prompts = read("packages/phantom-games-unreal/Docs/Production/CUBETOWN_V19_VISUAL_TARGET_PROMPTS.md");
const report = read("packages/phantom-games-unreal/Docs/Production/CUBETOWN_V19_MAKERS_JOURNEY.md");
const packager = read("packages/phantom-games-unreal/Tools/PackageCubetownV19R1.ps1");

for (const target of [
  "cubetown-v19-maker-character-reference.png",
  "cubetown-v19-heartstone-gameplay-target.png",
]) {
  assert.ok(
    existsSync(new URL(`../packages/phantom-games-unreal/SourceArt/VisualTargets/${target}`, import.meta.url)),
    `Cubetown V19 visual target must exist: ${target}`,
  );
}

assert.match(bible, /current_floor": "V18R1 verified installed Unreal release[\s\S]*next_target": "V19 Maker's Journey review candidate — not promoted/u,
  "Cubetown must preserve the real V18R1 floor and identify the V19 successor truthfully.");
assert.match(bible, /crimson mantle[\s\S]*cyan echo rod[\s\S]*never a default pawn or permanently idling mesh/u,
  "The Maker identity and motion floor must remain explicit.");
assert.doesNotMatch(bible, /Voxel mining and placement must be immediate/u,
  "The stale voxel-first design pillar must not return.");

assert.match(cpp, /SK_Mage\.SK_Mage[\s\S]*A_Mage_Idle[\s\S]*A_Mage_Walk[\s\S]*A_Mage_Run[\s\S]*A_Mage_Attack[\s\S]*A_Mage_Hit/u,
  "The Maker must use the complete production Mage animation set.");
assert.doesNotMatch(cpp, /ConfigureProductionSkeletalCharacter\([\s\S]{0,220}SK_Rogue\.SK_Rogue[\s\S]{0,220}A_Rogue_Idle\.A_Rogue_Idle/u,
  "Cubetown must not regress to the generic Rogue hero.");
assert.match(cpp, /void ACubetownHero::UpdateMakerPresentation[\s\S]*bAirborne[\s\S]*bSprinting[\s\S]*AttackRemaining[\s\S]*DamageFlash/u,
  "Maker animation selection must react to traversal, sprint, combat, and damage.");
assert.match(cpp, /MakerEchoOrbitA[\s\S]*MakerEchoOrbitB[\s\S]*MakerEchoOrbitC[\s\S]*MakerEchoLight/u,
  "The Maker's cyan memory signature must remain visible in gameplay.");
assert.match(cpp, /MakerSatchel[\s\S]*MakerUtilityBelt[\s\S]*MakerRuneGauntlet[\s\S]*CloakMesh->SetVisibility\(true\)/u,
  "The production Maker must retain the concept's mantle, satchel, belt, and gauntlet silhouette instead of reading as a stock mesh.");
assert.match(cpp, /void ACubetownDirector::SpawnMakerArrivalTrail[\s\S]*MakerTrailLantern[\s\S]*MakerTrailGate[\s\S]*MakerTrailCrimsonTree[\s\S]*FirstEcho/u,
  "The opening world must retain its authored arrival trail and companion.");
assert.match(cpp, /FriendProductionVisual[\s\S]*SK_Rogue\.SK_Rogue[\s\S]*SK_Barbarian\.SK_Barbarian[\s\S]*SK_Mage\.SK_Mage[\s\S]*FriendWalkAnimation/u,
  "Mira, Rowan, and Pip must use distinct animated production silhouettes instead of gliding static figures.");
assert.match(cpp, /ApplyColor\(VisualModel, FLinearColor\(0\.08f, 0\.82f, 0\.78f\)\)[\s\S]*VisualModel->SetRelativeLocation/u,
  "The starting echo companion must retain its turquoise identity and living hover motion.");
assert.match(cpp, /V19 command deck[\s\S]*CREATE %s[\s\S]*REMEMBER[\s\S]*WEAVE/u,
  "The HUD must retain three readable Maker tools.");
assert.match(header, /UAnimSequence\* MakerIdleAnimation[\s\S]*UAnimSequence\* MakerWalkAnimation[\s\S]*UAnimSequence\* MakerRunAnimation/u,
  "The hero class must retain its animation controller assets.");

assert.match(prompts, /Maker character reference[\s\S]*Heartstone gameplay target[\s\S]*Runtime translation contract/u,
  "The exact visual targets and runtime translation contract must remain reproducible.");
assert.match(prompts, /do not resemble or reference Nintendo[\s\S]*no default mannequin/u,
  "The visual contract must stay original and reject generic character regression.");
assert.match(report, /Release floor: installed V18R1[\s\S]*review candidate — not promoted[\s\S]*exact literal `PROMOTE`/u,
  "The V19 report must not claim installation or promotion before review.");
assert.match(packager, /CandidateBuilds\\\$Revision\\cubetown[\s\S]*visual_profile=makers-journey-v19[\s\S]*promotion=blocked_until_explicit_human_PROMOTE/u,
  "Cubetown packaging must remain isolated and explicitly non-promoted.");

console.log("CUBETOWN_V19_MAKER_PASS");

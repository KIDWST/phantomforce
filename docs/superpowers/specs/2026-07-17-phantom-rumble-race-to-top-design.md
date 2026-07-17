# Phantom Rumble — Race to the Top — Design

## Problem

Phantom Rumble is currently one game mode (brawl: knock opponents around
until they crack against a fence). The owner wants a second mode that
feels like a genuinely different game, not "brawl but vertical": a
climbing race, up to 4 players, no health/death — players sabotage each
other to slow each other down, not to eliminate them — with a fast-paced
8-bit soundtrack. This depends on the Ninja Chicken Polish phase being done
first, since it reuses that phase's finished sprite and the consolidated
mode-menu framework (this becomes tile 6, added after that phase's 5).

## Core loop

Up to 4 players (local mix and/or via a PhantomPlay game room, reusing the
Realtime Channel + room plumbing from the other two specs — no new netcode
needed here). A vertical, procedurally-generated tower; whoever tags the
summit first wins.

- **Tower generation**: extends the existing seeded-chunk system
  (`CHUNKS`, `mulberry32`, `buildPlatforms()`) — instead of building one
  small cluster of platforms, stack a tall sequence of chunks going
  upward, deterministically from the match seed (same seed source as
  today: host-provided when available, locally-drawn cryptographic random
  otherwise). Deterministic generation means local and networked matches
  agree on the layout without transmitting the whole tower.
- **Rising hazard**: an auto-scrolling danger line climbs from below the
  bottom of the tower at a steady pace that accelerates over the course of
  the match, forcing constant upward movement. Visual theme ties to the
  existing coop setting (e.g. rising smoke/flood consistent with "the coop
  floor gives way beneath you" rather than a generic lava reskin).
- **No health, no death.** This mode has no `pct`/stocks system at all —
  it is a fully separate ruleset/code path from brawl, so it cannot affect
  or regress the Ninja Chicken Polish phase's brawl balance.
- **Sabotage**: reuses the existing light/heavy attack inputs and their
  current hitbox/reach values exactly as-is — no aim-assist, no reach
  buff for this mode. A landed hit knocks the target down. (Explicit
  design call: sabotage should require precise aim, not become spammable.)
- **Knockdown penalty**: both a landed sabotage hit and getting touched by
  the rising hazard knock the target down and slide them back down the
  tower a number of chunks — hazard contact costs more chunks than a
  sabotage hit, since getting caught by the rising floor is the bigger
  mistake. Either knockdown includes a brief stun and a short grace
  window of invulnerability afterward, so a player isn't immediately
  re-caught by the still-rising hazard the instant they recover.
- **Movement**: double jump preserved from the existing `jumps:2` system.
  No flight, no new movement modes beyond the double jump and the two
  mode-specific pickups below.
- **Win condition**: first player to touch the summit platform ends the
  match immediately. Results screen shows finish order (1st/2nd/3rd/4th
  — or "still climbing" for anyone caught by the hazard at match end),
  not KO counts.

## Mode-exclusive power-ups

A separate small pickup pool, spawned only in this mode (does not touch
the brawl-mode pickup pool from the Ninja Chicken Polish spec):

- **Grapple Dash**: a fixed-distance directional dash, usable to quickly
  gain a platform or dodge the rising hazard.
- **Shield Bubble**: temporary immunity to being knocked down by a hit.
  Does **not** protect against the rising hazard — it counters sabotage,
  not the core time-pressure mechanic.

## HUD

Replaces the brawl mode's percent/stocks fighter cards with:

- A per-player height/altitude readout (relative position up the tower).
- A shared "danger meter" showing how close the rising hazard is to the
  lowest-placed player, so everyone can see the pressure building.

## Soundtrack — procedural 8-bit chiptune

Built the same way the existing SFX are: Web Audio oscillators via the
existing `tone()`/`audio()` helpers, no external audio files (the page's
CSP already sets `media-src 'none'`, so this isn't a new constraint, just
one this mode has to respect same as everything else here).

A small step-sequencer, structured like a fast-paced 8-bit action theme
(Zelda/Mario-era feel, per the ask):

- **Melody**: arpeggiated square-wave line, the main "hook."
- **Bassline**: triangle-wave, steady rhythmic foundation.
- **Percussion**: short noise/square-wave pulses on the beat for drive.
- Loops for the duration of the match. Tempo creeps up slightly as the
  danger meter closes in, tying the music to the actual pressure of the
  mode rather than being a static loop.
- Only plays during Race to the Top matches — brawl-mode SFX/audio are
  untouched. Respects the existing persistent mute toggle
  (`pf.phantomrumble.mute`).

## Non-goals

- No new image/audio assets — tower/hazard visuals and the soundtrack are
  both procedural, consistent with the rest of the page.
- No changes to brawl mode physics, pickups, or HUD.
- No new netcode — the networked variant of this mode rides the same room
  plumbing the other two specs establish; nothing mode-specific to build
  at the transport layer.

/* PhantomForce — PhantomPlay Flagship Five.

   Five substantially deeper PhantomPlay games (real progression,
   cross-network multiplayer via the existing workspace-relay room model,
   in-app tutorials) than any of the 23 existing built-in games. Following
   the exact precedent set by ./phantomplay-v2.ts: this file owns its own
   games array and a registerPhantomPlayFlagshipGames() merge-at-startup
   function, with an explicit "no V1/V2 source edits" goal — the existing
   PHANTOMPLAY_BUILT_IN_GAMES and PHANTOMPLAY_V2_GAMES arrays are never
   mutated in place, only pushed into (array push, like V2 already does to
   V1's array). Games ship in a later step; this file just wires the
   registration plumbing so app/games/<slug>/ folders can land independently
   of the catalog/server wiring.

   Each game, once added, is expected to live entirely under its own
   app/games/<slug>/ (or app/games/<slug>.html) path per the platform's
   file-format contract — this module only ever holds catalog metadata
   (PhantomPlayGame entries), never game logic. */

import { PHANTOMPLAY_BUILT_IN_GAMES, type PhantomPlayGame } from "./phantomplay.js";

// Empty for now — the five flagship games are added here in a later step.
export const PHANTOMPLAY_FLAGSHIP_GAMES: PhantomPlayGame[] = [];

let gamesRegistered = false;
export function registerPhantomPlayFlagshipGames() {
  if (gamesRegistered) return;
  gamesRegistered = true;
  for (const game of PHANTOMPLAY_FLAGSHIP_GAMES) {
    if (!PHANTOMPLAY_BUILT_IN_GAMES.some((item) => item.id === game.id)) PHANTOMPLAY_BUILT_IN_GAMES.push(game);
  }
}

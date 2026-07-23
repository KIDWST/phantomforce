/* VESPERGATE: THE VESPER HAND — dread.js
 * The Presence system: a hidden 0..1 unease value that rises while the
 * player lingers or backtracks through non-warm biomes (dungeon, ossuary)
 * and falls in warm ones (village, vale, lake, interiors). Never rendered
 * as a number/bar — every other system (NPCs, audio, visuals, HUD) reacts
 * to it instead, so the reaction IS the only feedback the player gets.
 * Non-goal, load-bearing: nothing here can kill the player, chase the
 * player, or gate progress. Pure atmosphere on top of the existing loop.
 */
"use strict";
window.VG = window.VG || {};
(() => {
  const VG = window.VG;

  const RISE_AMBIENT = 0.006;   // per second, present in a non-warm room
  const RISE_STILL = 0.02;      // per second, extra once lingering past STILL_T
  const STILL_T = 6;            // seconds motionless before the "lingering" add kicks in
  const BACKTRACK_BUMP = 0.12;  // one-time, re-entering an already-cleared non-warm room
  const FALL_WARM = 0.045;      // per second, present in a warm room
  const QUEST_RELIEF = 0.15;    // one-time, on quest progress
  const TIERS = [0.3, 0.6, 0.85];
  const STEP_SFX_CHANCE = 0.12; // per second, gated to tier>=2 and player still

  let value = 0;
  let stillT = 0;
  let visited = new Set();
  let lastRoomId = null;
  let backtrackFlag = false;
  let lastTier = 0;

  const dread = {
    value() { return value; },
    tier() {
      if (value < TIERS[0]) return 0;
      if (value < TIERS[1]) return 1;
      if (value < TIERS[2]) return 2;
      return 3;
    },

    /* opts: { warm: bool, still: bool } — call once per simulate() frame */
    tick(dt, opts = {}) {
      const warm = opts.warm !== false;
      stillT = opts.still ? stillT + dt : 0;

      let delta = warm ? -FALL_WARM * dt : RISE_AMBIENT * dt;
      if (!warm && stillT > STILL_T) delta += RISE_STILL * dt;
      value = Math.max(0, Math.min(1, value + delta));

      const t = dread.tier();
      if (t !== lastTier) { dread._onTierChange(t, lastTier); lastTier = t; }

      if (!warm && t >= 2 && opts.still && VG.sfxDreadStep && Math.random() < STEP_SFX_CHANCE * dt) {
        VG.sfxDreadStep();
      }
      if (VG.setDreadLevel) VG.setDreadLevel(value);
    },

    /* call from loadRoom() with the destination room's id + warm flag */
    onRoomEnter(roomId, warm) {
      if (roomId === lastRoomId) return;
      lastRoomId = roomId;
      backtrackFlag = false;
      if (visited.has(roomId) && !warm) {
        value = Math.min(1, value + BACKTRACK_BUMP);
        backtrackFlag = true;
      }
      visited.add(roomId);
      stillT = 0;
    },

    /* one-shot: true exactly once per backtrack-triggering room entry */
    consumeBacktrack() {
      const b = backtrackFlag;
      backtrackFlag = false;
      return b;
    },

    notifyQuestProgress() { value = Math.max(0, value - QUEST_RELIEF); },

    _onTierChange(to, from) {
      if (to > from && VG.duckMusic) VG.duckMusic(180);
    },

    reset() {
      value = 0; stillT = 0; visited = new Set();
      lastRoomId = null; backtrackFlag = false; lastTier = 0;
      if (VG.setDreadLevel) VG.setDreadLevel(0);
    },
  };

  VG.dread = dread;
})();

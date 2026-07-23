// Phantom Chess theme — composed for PhantomScore (see ../shared/phantomScore.js).
// Source of truth is PhantomMix/GameMusic/phantom-chess/score.json (also
// exported there as theme.mid for DAW use) — keep this copy in sync by hand
// if the composition changes.
window.GAME_THEME = {
  "tempo": 76,
  "stepsPerBar": 16,
  "bars": 2,
  "defaultState": "main",
  "states": { "main": {} },
  "tracks": {
    "pad": [
      { "step": 0, "note": "A2", "dur": 32, "vel": 0.18, "voice": "pad", "opts": { "wave": "sine" } },
      { "step": 0, "note": "C3", "dur": 32, "vel": 0.15, "voice": "pad", "opts": { "wave": "sine" } },
      { "step": 0, "note": "E3", "dur": 32, "vel": 0.15, "voice": "pad", "opts": { "wave": "sine" } }
    ],
    "bass": [
      { "step": 0,  "note": "A2", "dur": 15, "vel": 0.4, "voice": "bass" },
      { "step": 16, "note": "E2", "dur": 15, "vel": 0.35, "voice": "bass" }
    ],
    "lead": [
      { "step": 0,  "note": "A3", "dur": 3, "vel": 0.55, "voice": "pluck", "opts": { "wave": "triangle" } },
      { "step": 4,  "note": "C4", "dur": 3, "vel": 0.5,  "voice": "pluck", "opts": { "wave": "triangle" } },
      { "step": 8,  "note": "E4", "dur": 3, "vel": 0.55, "voice": "pluck", "opts": { "wave": "triangle" } },
      { "step": 12, "note": "A4", "dur": 5, "vel": 0.6,  "voice": "pluck", "opts": { "wave": "triangle" } },
      { "step": 18, "note": "G4", "dur": 3, "vel": 0.5,  "voice": "pluck", "opts": { "wave": "triangle" } },
      { "step": 22, "note": "E4", "dur": 3, "vel": 0.5,  "voice": "pluck", "opts": { "wave": "triangle" } },
      { "step": 26, "note": "C4", "dur": 3, "vel": 0.45, "voice": "pluck", "opts": { "wave": "triangle" } },
      { "step": 30, "note": "A3", "dur": 2, "vel": 0.45, "voice": "pluck", "opts": { "wave": "triangle" } }
    ]
  }
};

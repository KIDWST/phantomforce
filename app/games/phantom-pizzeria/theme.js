// Phantom Pizzeria theme — composed for PhantomScore (see ../shared/phantomScore.js).
// Source of truth is PhantomMix/GameMusic/phantom-pizzeria/score.json (also
// exported there as theme.mid for DAW use) — keep this copy in sync by hand
// if the composition changes.
window.GAME_THEME = {
  "tempo": 118,
  "stepsPerBar": 16,
  "bars": 2,
  "swing": 0.15,
  "defaultState": "main",
  "states": { "main": {} },
  "tracks": {
    "bass": [
      { "step": 0,  "note": "C2", "dur": 3, "vel": 0.75, "voice": "bass" },
      { "step": 4,  "note": "E2", "dur": 3, "vel": 0.6,  "voice": "bass" },
      { "step": 8,  "note": "G2", "dur": 3, "vel": 0.7,  "voice": "bass" },
      { "step": 12, "note": "E2", "dur": 3, "vel": 0.6,  "voice": "bass" },
      { "step": 16, "note": "C2", "dur": 3, "vel": 0.75, "voice": "bass" },
      { "step": 20, "note": "E2", "dur": 3, "vel": 0.6,  "voice": "bass" },
      { "step": 24, "note": "G2", "dur": 3, "vel": 0.7,  "voice": "bass" },
      { "step": 28, "note": "E2", "dur": 3, "vel": 0.6,  "voice": "bass" }
    ],
    "lead": [
      { "step": 0,  "note": "C4", "dur": 3, "vel": 0.75, "voice": "pluck", "opts": { "wave": "triangle" } },
      { "step": 4,  "note": "E4", "dur": 3, "vel": 0.65, "voice": "pluck", "opts": { "wave": "triangle" } },
      { "step": 8,  "note": "G4", "dur": 3, "vel": 0.7,  "voice": "pluck", "opts": { "wave": "triangle" } },
      { "step": 12, "note": "E4", "dur": 3, "vel": 0.6,  "voice": "pluck", "opts": { "wave": "triangle" } },
      { "step": 16, "note": "C5", "dur": 3, "vel": 0.8,  "voice": "pluck", "opts": { "wave": "triangle" } },
      { "step": 20, "note": "G4", "dur": 3, "vel": 0.65, "voice": "pluck", "opts": { "wave": "triangle" } },
      { "step": 24, "note": "E4", "dur": 3, "vel": 0.6,  "voice": "pluck", "opts": { "wave": "triangle" } },
      { "step": 28, "note": "C4", "dur": 4, "vel": 0.7,  "voice": "pluck", "opts": { "wave": "triangle" } }
    ],
    "perc": [
      { "step": 0,  "voice": "kick", "vel": 0.85 }, { "step": 8,  "voice": "kick", "vel": 0.8 },
      { "step": 16, "voice": "kick", "vel": 0.85 }, { "step": 24, "voice": "kick", "vel": 0.8 },
      { "step": 4,  "voice": "snare", "vel": 0.7 }, { "step": 12, "voice": "snare", "vel": 0.7 },
      { "step": 20, "voice": "snare", "vel": 0.7 }, { "step": 28, "voice": "snare", "vel": 0.7 },
      { "step": 2, "voice": "hat", "vel": 0.3 }, { "step": 6, "voice": "hat", "vel": 0.3 },
      { "step": 10, "voice": "hat", "vel": 0.3 }, { "step": 14, "voice": "hat", "vel": 0.3 },
      { "step": 18, "voice": "hat", "vel": 0.3 }, { "step": 22, "voice": "hat", "vel": 0.3 },
      { "step": 26, "voice": "hat", "vel": 0.3 }, { "step": 30, "voice": "hat", "vel": 0.3 }
    ]
  }
};

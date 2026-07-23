// Phantom Ages theme — composed for PhantomScore (see ../shared/phantomScore.js).
// Source of truth is PhantomMix/GameMusic/phantom-ages/score.json (also
// exported there as theme.mid for DAW use) — keep this copy in sync by hand
// if the composition changes.
window.GAME_THEME = {
  "tempo": 84,
  "stepsPerBar": 16,
  "bars": 4,
  "defaultState": "main",
  "states": { "main": {} },
  "tracks": {
    "pad": [
      { "step": 0, "note": "D3", "dur": 64, "vel": 0.28, "voice": "pad", "opts": { "wave": "triangle", "unison": true } },
      { "step": 0, "note": "F3", "dur": 64, "vel": 0.22, "voice": "pad", "opts": { "wave": "triangle", "unison": true } },
      { "step": 0, "note": "A3", "dur": 64, "vel": 0.22, "voice": "pad", "opts": { "wave": "triangle", "unison": true } }
    ],
    "bass": [
      { "step": 0,  "note": "D2", "dur": 16, "vel": 0.7, "voice": "bass" },
      { "step": 16, "note": "A2", "dur": 16, "vel": 0.6, "voice": "bass" },
      { "step": 32, "note": "D2", "dur": 16, "vel": 0.7, "voice": "bass" },
      { "step": 48, "note": "A2", "dur": 16, "vel": 0.6, "voice": "bass" }
    ],
    "lead": [
      { "step": 0,  "note": "D4", "dur": 4, "vel": 0.65, "voice": "pluck", "opts": { "wave": "sawtooth" } },
      { "step": 4,  "note": "F4", "dur": 4, "vel": 0.6,  "voice": "pluck", "opts": { "wave": "sawtooth" } },
      { "step": 8,  "note": "A4", "dur": 4, "vel": 0.65, "voice": "pluck", "opts": { "wave": "sawtooth" } },
      { "step": 12, "note": "G4", "dur": 3, "vel": 0.55, "voice": "pluck", "opts": { "wave": "sawtooth" } },
      { "step": 16, "note": "B4", "dur": 4, "vel": 0.7,  "voice": "pluck", "opts": { "wave": "sawtooth" } },
      { "step": 20, "note": "A4", "dur": 4, "vel": 0.6,  "voice": "pluck", "opts": { "wave": "sawtooth" } },
      { "step": 24, "note": "F4", "dur": 4, "vel": 0.6,  "voice": "pluck", "opts": { "wave": "sawtooth" } },
      { "step": 28, "note": "D4", "dur": 3, "vel": 0.55, "voice": "pluck", "opts": { "wave": "sawtooth" } },
      { "step": 32, "note": "C5", "dur": 4, "vel": 0.75, "voice": "pluck", "opts": { "wave": "sawtooth" } },
      { "step": 36, "note": "A4", "dur": 4, "vel": 0.65, "voice": "pluck", "opts": { "wave": "sawtooth" } },
      { "step": 40, "note": "F4", "dur": 4, "vel": 0.6,  "voice": "pluck", "opts": { "wave": "sawtooth" } },
      { "step": 44, "note": "G4", "dur": 3, "vel": 0.55, "voice": "pluck", "opts": { "wave": "sawtooth" } },
      { "step": 48, "note": "D4", "dur": 6, "vel": 0.7,  "voice": "pluck", "opts": { "wave": "sawtooth" } },
      { "step": 56, "note": "A3", "dur": 6, "vel": 0.6,  "voice": "pluck", "opts": { "wave": "sawtooth" } }
    ],
    "perc": [
      { "step": 0,  "voice": "kick", "vel": 0.55 },
      { "step": 16, "voice": "kick", "vel": 0.5 },
      { "step": 32, "voice": "kick", "vel": 0.6 },
      { "step": 34, "voice": "snare", "vel": 0.4 },
      { "step": 48, "voice": "kick", "vel": 0.55 }
    ]
  }
};

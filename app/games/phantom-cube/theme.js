// Phantom Cube theme — composed for PhantomScore (see ../shared/phantomScore.js).
// Source of truth is PhantomMix/GameMusic/phantom-cube/score.json (also
// exported there as theme.mid for DAW use) — keep this copy in sync by hand
// if the composition changes.
window.GAME_THEME = {
  "tempo": 70,
  "stepsPerBar": 16,
  "bars": 2,
  "defaultState": "main",
  "states": { "main": {} },
  "tracks": {
    "pad": [
      { "step": 0, "note": "C3",  "dur": 32, "vel": 0.22, "voice": "pad", "opts": { "wave": "sine", "unison": true } },
      { "step": 0, "note": "E3",  "dur": 32, "vel": 0.18, "voice": "pad", "opts": { "wave": "sine", "unison": true } },
      { "step": 0, "note": "F#3", "dur": 32, "vel": 0.16, "voice": "pad", "opts": { "wave": "sine", "unison": true } }
    ],
    "lead": [
      { "step": 0,  "note": "C5",  "dur": 5, "vel": 0.35, "voice": "pluck", "opts": { "wave": "sine" } },
      { "step": 10, "note": "E5",  "dur": 5, "vel": 0.3,  "voice": "pluck", "opts": { "wave": "sine" } },
      { "step": 20, "note": "F#5", "dur": 5, "vel": 0.32, "voice": "pluck", "opts": { "wave": "sine" } },
      { "step": 28, "note": "G5",  "dur": 6, "vel": 0.3,  "voice": "pluck", "opts": { "wave": "sine" } }
    ]
  }
};

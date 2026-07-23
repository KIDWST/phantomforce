# PhantomScore format

Shared score data format for PhantomPlay game themes. One JSON object drives
two independent consumers:

1. **In-browser playback** — `app/games/shared/phantomScore.js` reads it directly
   and synthesizes it live via Web Audio (no audio files, no CSP change, works
   even under `media-src 'none'`).
2. **DAW-editable master** — `PhantomMix/GameMusic/tools/score_to_midi.py`
   converts the same JSON into a real `.mid` file. A dev opens that in any DAW
   they own (Reaper, Ableton, FL, Logic — DAW-agnostic on purpose), rewrites the
   composition freely, and hands back an updated score JSON (by hand, or via a
   future `midi_to_score.py`) to ship the change back into the game.

The JSON is the single source of truth both directions read/write — not a
proprietary DAW project file, so no dev is forced onto a specific DAW.

## Shape

```jsonc
{
  "tempo": 96,            // BPM
  "stepsPerBar": 16,       // subdivisions per 4/4 bar (16 = sixteenth notes)
  "bars": 4,               // loop length in bars (or infer from furthest event)
  "swing": 0,              // 0..1, delays every odd step by swing * stepDur
  "defaultState": "main",
  "states": {
    // per-state target gain (0..1) for each track name; a track not listed
    // for a state plays at gain 1. setState() crossfades between these.
    "main":  { "lead": 1, "bass": 1, "perc": 1, "pad": 0.6 },
    "tense": { "lead": 0.7, "bass": 1, "perc": 1.2, "pad": 0.3 }
  },
  "tracks": {
    // track name -> flat array of note events, one array per instrument bus.
    // events are sparse (only where something plays), not a dense grid.
    "lead": [
      { "step": 0,  "note": "E4", "dur": 2, "vel": 0.9, "voice": "pluck" },
      { "step": 4,  "note": "G4", "dur": 2, "vel": 0.8, "voice": "pluck" }
    ],
    "bass": [
      { "step": 0, "note": "E2", "dur": 4, "vel": 1, "voice": "bass" }
    ],
    "perc": [
      { "step": 0, "voice": "kick" },
      { "step": 8, "voice": "snare" },
      { "step": 4, "voice": "hat" }, { "step": 12, "voice": "hat" }
    ],
    "pad": [
      { "step": 0, "note": "E3", "dur": 16, "vel": 0.5, "voice": "pad", "opts": { "unison": true } }
    ]
  }
}
```

- `step` — absolute step index within the loop (0-based, `stepsPerBar` per bar).
- `note` — note-name string (`"C4"`, `"Eb3"`, `"F#5"`) or a raw Hz number.
  Percussion voices (`kick`/`snare`/`hat`) omit `note` entirely.
- `dur` — length in steps (not seconds) — tempo-relative, so patterns still
  line up if tempo changes per state.
- `voice` — which instrument palette entry renders this event; defaults to
  the track name if omitted (`VOICES` in phantomScore.js: `pluck`, `pad`,
  `bass`, `kick`, `snare`, `hat`).
- `opts` — optional per-event voice params (e.g. `{"wave":"sawtooth"}`,
  `{"unison":true}`, `{"cutoff":600}`).

Track *names* are free-form (call it `melody`/`arp`/`sub` if that fits the
game better) — `states` keys must match whatever track names you use.

## Composing a new game's score

1. Pick genre-appropriate scale/key and a tempo matching the game's pace.
2. Write 2-8 bars per mood the game actually needs states for (most games
   only need one `"main"` state — adaptive multi-state is opt-in, not
   required, see vespergate/phantom-rumble for when it's worth it).
3. Save as `PhantomMix/GameMusic/<game-slug>/score.json`.
4. Run `score_to_midi.py` to get a real `.mid` for DAW use/reference.
5. Copy the JSON (or a `<script src>` reference, for folder-based games) into
   the game's own file so `PhantomScore.create(SCORE_DATA)` can load it.

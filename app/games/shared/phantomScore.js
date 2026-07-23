// PhantomScore — shared adaptive music engine for PhantomPlay games.
//
// Generalizes the pattern independently proven in five games already
// (vespergate/engine.js adaptive drone/veil/threat layers, beat-strike's
// SynthTrack step-sequencer, phantom-dash's ChipAudio, phantom-rumble's
// raceMusicTick, cubetown's ambient soundscape): pure Web Audio oscillator/
// noise synthesis, driven by a compact note-event score, no audio files,
// no CSP change needed anywhere (works even under media-src 'none').
//
// A game's actual composition lives in a separate `<game>.score.js` file
// (or inline object for single-file games) — see app/games/shared/
// phantomScore.schema.md for the format. That same score object is what
// PhantomMix's offline pipeline converts to/from a real .mid file, so a
// dev can open a game's theme in any DAW they own and rewrite it.
//
// Usage:
//   const score = PhantomScore.create(SCORE_DATA);
//   document.addEventListener('pointerdown', () => score.start(), {once:true});
//   score.setState('combat');   // crossfades to a different mood/pattern
//   score.setVolume(0.6);
//   score.stop();
//
// Drop-in for single-file games: copy this whole IIFE body inline into a
// <script> block (this codebase's games each inline their own JS — see
// PHANTOMPLAY memory on shared/ vs per-file — this file IS the copy-paste
// source of truth, keep per-file inlined copies in sync with it by hand).
(function (global) {
  'use strict';

  const LOOKAHEAD_MS = 25;      // scheduler tick, matches existing beat-strike/phantom-dash precedent
  const SCHEDULE_AHEAD_S = 0.15; // how far into the future we queue notes each tick

  const NOTE_NAME_RE = /^([A-Ga-g])(#|b)?(-?\d+)$/;
  function noteToFreq(note) {
    if (typeof note === 'number') return note; // already a frequency in Hz
    const m = NOTE_NAME_RE.exec(String(note).trim());
    if (!m) return 220;
    const letters = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    let semitone = letters[m[1].toUpperCase()];
    if (m[2] === '#') semitone += 1;
    if (m[2] === 'b') semitone -= 1;
    const octave = parseInt(m[3], 10);
    const midi = (octave + 1) * 12 + semitone;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  let sharedNoiseBuf = null;
  function noiseBuffer(ctx) {
    if (!sharedNoiseBuf || sharedNoiseBuf.sampleRate !== ctx.sampleRate) {
      sharedNoiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
      const d = sharedNoiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return sharedNoiseBuf;
  }

  // Small reusable instrument palette. `type` selects the voice; every
  // voice takes (ctx, dest, freq, t0, durSec, vel, opts) and schedules
  // itself, returning nothing (fire-and-forget nodes, self-stopping).
  const VOICES = {
    pluck(ctx, dest, freq, t0, dur, vel, opts) {
      const o = ctx.createOscillator(); o.type = (opts && opts.wave) || 'triangle';
      o.frequency.setValueAtTime(freq, t0);
      const g = ctx.createGain();
      const peak = 0.22 * vel;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(dur * 0.9, 0.05));
      o.connect(g).connect(dest);
      o.start(t0); o.stop(t0 + dur + 0.05);
    },
    pad(ctx, dest, freq, t0, dur, vel, opts) {
      const wave = (opts && opts.wave) || 'sine';
      const detunes = opts && opts.unison ? [0, 6, -6] : [0];
      detunes.forEach((cents) => {
        const o = ctx.createOscillator(); o.type = wave;
        o.frequency.setValueAtTime(freq, t0); o.detune.setValueAtTime(cents, t0);
        const g = ctx.createGain();
        const peak = (0.14 * vel) / detunes.length;
        const attack = Math.min(0.35, dur * 0.3);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(peak, t0 + attack);
        g.gain.setValueAtTime(peak, t0 + Math.max(dur - 0.25, attack));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.25);
        o.connect(g).connect(dest);
        o.start(t0); o.stop(t0 + dur + 0.3);
      });
    },
    bass(ctx, dest, freq, t0, dur, vel, opts) {
      const o = ctx.createOscillator(); o.type = (opts && opts.wave) || 'triangle';
      o.frequency.setValueAtTime(freq, t0);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = (opts && opts.cutoff) || 900;
      const g = ctx.createGain();
      const peak = 0.26 * vel;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(dur * 0.95, 0.08));
      o.connect(f).connect(g).connect(dest);
      o.start(t0); o.stop(t0 + dur + 0.05);
    },
    kick(ctx, dest, freq, t0, dur, vel) {
      const o = ctx.createOscillator(); o.type = 'sine';
      const base = freq || 130;
      o.frequency.setValueAtTime(base, t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(base * 0.3, 32), t0 + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.32 * vel, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
      o.connect(g).connect(dest);
      o.start(t0); o.stop(t0 + 0.2);
    },
    snare(ctx, dest, freq, t0, dur, vel) {
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.22 * vel, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
      src.connect(f).connect(g).connect(dest);
      src.start(t0); src.stop(t0 + 0.12);
    },
    hat(ctx, dest, freq, t0, dur, vel) {
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx);
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.1 * vel, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.045);
      src.connect(f).connect(g).connect(dest);
      src.start(t0); src.stop(t0 + 0.06);
    },
  };

  class PhantomScore {
    constructor(data) {
      this.data = data;
      this.tempo = data.tempo || 100;
      this.stepsPerBar = data.stepsPerBar || 16;
      this.swing = data.swing || 0;
      this.tracks = data.tracks || {};
      this.states = data.states || { default: {} };
      this.ctx = null;
      this.master = null;
      this.busses = {};
      this.state = data.defaultState || 'default';
      this.started = false;
      this.muted = false;
      this.volume = 1;
      this._timer = null;
      this._nextStepTime = 0;
      this._stepIndex = 0;
      this._loopSteps = this._computeLoopLength();
    }

    _computeLoopLength() {
      let max = this.stepsPerBar * (this.data.bars || 4);
      Object.keys(this.tracks).forEach((name) => {
        const evts = this.tracks[name];
        evts.forEach((e) => { if (e.step + (e.dur || 1) > max) max = e.step + (e.dur || 1); });
      });
      return max;
    }

    _ensureCtx() {
      if (this.ctx) return this.ctx;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        this.master.connect(this.ctx.destination);
        Object.keys(this.tracks).forEach((name) => {
          const g = this.ctx.createGain();
          g.gain.value = this._targetGainFor(name, this.state);
          g.connect(this.master);
          this.busses[name] = g;
        });
      } catch (e) { this.ctx = null; }
      return this.ctx;
    }

    _targetGainFor(track, state) {
      const s = this.states[state] || {};
      if (Object.prototype.hasOwnProperty.call(s, track)) return s[track];
      return 1; // track plays at full gain unless a state explicitly ducks/mutes it
    }

    start() {
      const ctx = this._ensureCtx();
      if (!ctx || this.started) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      this.started = true;
      this._stepIndex = 0;
      this._nextStepTime = ctx.currentTime + 0.05;
      const tick = () => {
        if (!this.started) return;
        while (this._nextStepTime < this.ctx.currentTime + SCHEDULE_AHEAD_S) {
          this._scheduleStep(this._stepIndex, this._nextStepTime);
          const stepDur = (60 / this.tempo / 4) * (this.stepsPerBar / 16);
          const swungLate = this.swing && this._stepIndex % 2 === 1 ? stepDur * this.swing : 0;
          this._nextStepTime += stepDur + swungLate;
          this._stepIndex = (this._stepIndex + 1) % this._loopSteps;
        }
        this._timer = global.setTimeout(tick, LOOKAHEAD_MS);
      };
      tick();
    }

    _scheduleStep(step, t0) {
      const stepDur = 60 / this.tempo / 4;
      Object.keys(this.tracks).forEach((name) => {
        const bus = this.busses[name];
        if (!bus) return;
        this.tracks[name].forEach((evt) => {
          if (evt.step !== step) return;
          const voiceFn = VOICES[evt.voice || name];
          if (!voiceFn) return;
          const freq = evt.note != null ? noteToFreq(evt.note) : 0;
          const dur = (evt.dur || 1) * stepDur;
          voiceFn(this.ctx, bus, freq, t0, dur, evt.vel != null ? evt.vel : 0.85, evt.opts);
        });
      });
    }

    setState(name, rampSeconds) {
      this.state = name;
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const ramp = rampSeconds != null ? rampSeconds : 1.1;
      Object.keys(this.busses).forEach((track) => {
        const target = this.muted ? 0 : this._targetGainFor(track, name);
        try { this.busses[track].gain.setTargetAtTime(target, t, ramp / 3); } catch (e) {}
      });
    }

    setVolume(v) {
      this.volume = Math.max(0, Math.min(1, v));
      if (this.master && !this.muted) {
        try { this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05); } catch (e) {}
      }
    }

    mute() {
      this.muted = true;
      if (this.master) { try { this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); } catch (e) {} }
    }

    unmute() {
      this.muted = false;
      if (this.master) { try { this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05); } catch (e) {} }
    }

    stop() {
      this.started = false;
      if (this._timer) { global.clearTimeout(this._timer); this._timer = null; }
    }
  }

  const PhantomScoreNS = {
    create(data) { return new PhantomScore(data); },
    noteToFreq,
    VOICES,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PhantomScoreNS;
  if (typeof global !== 'undefined') global.PhantomScore = PhantomScoreNS;
})(typeof window !== 'undefined' ? window : globalThis);

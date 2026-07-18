// Shared WebRTC voice-session core. Reusable by both consumers: in-game
// party voice (app/js/phantomplay.js) and the standalone "mini Discord"
// workspace (app/js/voicechannels.js) — see
// docs/superpowers/specs/2026-07-17-voice-channels-design.md for the full
// design rationale. Mesh topology: every participant opens a direct
// RTCPeerConnection to every other participant. Fine for the small room
// sizes both consumers actually need (PhantomPlay private room caps,
// small community channels); not built for large rooms (see spec
// Non-goals).
//
// STUN-only ICE — a known, tracked limitation (docs/quality/QUALITY_BACKLOG.md
// Q-0020), not silently shipped as flawless: without a TURN relay, peers
// behind symmetric NAT or some CGNAT configurations can fail to connect
// directly. This module reports that honestly per-participant
// (connectionState stays "connecting"/"failed" rather than being hidden or
// faked as "connected").
//
// The server is a pure signaling relay (SDP offers/answers, ICE candidates)
// — it never touches or decodes audio. All audio flows peer-to-peer.

import { session } from "./store.js?v=phantom-live-20260718-1";

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
const STREAM_HEARTBEAT_MS = 20_000; // must match the server's ping interval
const STREAM_STALL_TIMEOUT_MS = STREAM_HEARTBEAT_MS * 2 + 8_000;
const STREAM_FAILURE_LIMIT = 3;
// Basic audio-level detection, not VAD: a rough RMS floor over each track's
// waveform, polled on a short interval. Good enough for a "someone is
// probably talking" dot, not a speech-detection model.
const SPEAKING_THRESHOLD = 0.02;
const SPEAKING_POLL_MS = 220;

function authHeaders(json = false) {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : `Voice request failed (${response.status}).`);
  return payload;
}

function rms(analyser, buffer) {
  analyser.getByteTimeDomainData(buffer);
  let sumSquares = 0;
  for (let i = 0; i < buffer.length; i++) {
    const centered = (buffer[i] - 128) / 128;
    sumSquares += centered * centered;
  }
  return Math.sqrt(sumSquares / buffer.length);
}

// One voice session — either a standalone channel's persistent voice
// session (pass channelId) or a PhantomPlay game room's ephemeral party
// voice (pass roomCode). Same class either way; this IS the shared code
// path the design spec describes.
export class VoiceCore extends EventTarget {
  constructor({ tenantId, channelId = null, roomCode = null, myLabel = "You" } = {}) {
    super();
    this.tenantId = tenantId;
    this.channelId = channelId;
    this.roomCode = roomCode;
    this.myLabel = myLabel;
    this.sessionId = null;
    this.myActorId = null;
    this.participants = [];
    this.muted = false;
    this.localStream = null;
    this.peers = new Map(); // actorId -> { pc, label, audioEl, analyser, buffer, speaking }
    this.audioCtx = null;
    this.localAnalyser = null;
    this.localBuffer = null;
    this.localSpeaking = false;
    this.speakingTimer = null;
    this.streamController = null;
    this.streamFailures = 0;
    this.streamLastSeenAt = 0;
    this.stallTimer = null;
    this.connected = false;
    this.destroyed = false;
  }

  snapshot() {
    return {
      connected: this.connected,
      muted: this.muted,
      participants: this.participants.map((p) => {
        const isMe = p.actorId === this.myActorId;
        const peer = this.peers.get(p.actorId);
        return {
          actorId: p.actorId,
          label: p.label,
          isMe,
          muted: isMe ? this.muted : !!p.muted,
          connectionState: isMe ? "connected" : (peer?.pc.connectionState || "connecting"),
          speaking: isMe ? this.localSpeaking : !!peer?.speaking,
        };
      }),
    };
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  emitState() {
    this.emit("state", this.snapshot());
  }

  async connect() {
    if (this.destroyed) return;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      this.emit("error", { message: `Microphone access was blocked or unavailable: ${error?.message || error}.` });
      return;
    }
    try {
      const body = { tenantId: this.tenantId, ...(this.channelId ? { channelId: this.channelId } : { roomCode: this.roomCode }) };
      const result = await api("/api/voice/sessions", { method: "POST", body: JSON.stringify(body) });
      this.sessionId = result.sessionId;
      this.myActorId = result.actorId;
      this.participants = Array.isArray(result.participants) ? result.participants : [];
    } catch (error) {
      this.emit("error", { message: error.message });
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
      return;
    }
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = this.audioCtx.createMediaStreamSource(this.localStream);
      this.localAnalyser = this.audioCtx.createAnalyser();
      this.localAnalyser.fftSize = 512;
      this.localBuffer = new Uint8Array(this.localAnalyser.fftSize);
      source.connect(this.localAnalyser);
    } catch { /* speaking indicator is best-effort; connection still works without it */ }
    this.connected = true;
    this.reconcilePeers();
    this.openStream();
    this.startSpeakingPoll();
    this.emitState();
  }

  reconcilePeers() {
    const liveIds = new Set(this.participants.map((p) => p.actorId));
    for (const [actorId] of this.peers) {
      if (!liveIds.has(actorId)) this.teardownPeer(actorId);
    }
    for (const participant of this.participants) {
      if (participant.actorId === this.myActorId) continue;
      if (!this.peers.has(participant.actorId)) this.ensurePeer(participant.actorId, participant.label);
    }
  }

  ensurePeer(actorId, label) {
    if (this.peers.has(actorId) || !this.myActorId) return this.peers.get(actorId);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry = { pc, label, audioEl: null, analyser: null, buffer: null, speaking: false };
    this.peers.set(actorId, entry);
    this.localStream?.getTracks().forEach((track) => pc.addTrack(track, this.localStream));
    pc.onicecandidate = (event) => {
      if (event.candidate) this.sendSignal(actorId, "ice-candidate", event.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => this.emitState();
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (!remoteStream) return;
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioEl.srcObject = remoteStream;
      entry.audioEl = audioEl;
      try {
        const remoteSource = this.audioCtx.createMediaStreamSource(remoteStream);
        entry.analyser = this.audioCtx.createAnalyser();
        entry.analyser.fftSize = 512;
        entry.buffer = new Uint8Array(entry.analyser.fftSize);
        remoteSource.connect(entry.analyser);
      } catch { /* speaking indicator best-effort */ }
    };
    // Glare avoidance for a mesh of simultaneous joins: only the
    // lexicographically-smaller actorId initiates the offer for a given
    // pair, so the pair never both send competing offers.
    if (this.myActorId < actorId) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.sendSignal(actorId, "offer", { sdp: pc.localDescription.sdp, type: pc.localDescription.type });
        } catch (error) { this.emit("error", { message: `Could not start a connection to ${label}: ${error.message}` }); }
      };
    }
    return entry;
  }

  teardownPeer(actorId) {
    const entry = this.peers.get(actorId);
    if (!entry) return;
    entry.pc.close();
    if (entry.audioEl) { entry.audioEl.srcObject = null; entry.audioEl.remove(); }
    this.peers.delete(actorId);
  }

  async handleSignal(from, kind, payload) {
    const entry = this.ensurePeer(from, this.participants.find((p) => p.actorId === from)?.label || "Participant");
    if (!entry) return;
    try {
      if (kind === "offer") {
        await entry.pc.setRemoteDescription(payload);
        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        this.sendSignal(from, "answer", { sdp: entry.pc.localDescription.sdp, type: entry.pc.localDescription.type });
      } else if (kind === "answer") {
        await entry.pc.setRemoteDescription(payload);
      } else if (kind === "ice-candidate") {
        await entry.pc.addIceCandidate(payload).catch(() => undefined);
      }
    } catch (error) {
      this.emit("error", { message: `Signaling error with ${entry.label}: ${error.message}` });
    }
  }

  sendSignal(to, kind, payload) {
    if (!this.sessionId) return;
    api(`/api/voice/sessions/${encodeURIComponent(this.sessionId)}/signal`, {
      method: "POST",
      body: JSON.stringify({ tenantId: this.tenantId, to, kind, payload }),
    }).catch((error) => this.emit("error", { message: `Could not send a signaling message: ${error.message}` }));
  }

  handlePresence(participants) {
    this.participants = Array.isArray(participants) ? participants : [];
    this.reconcilePeers();
    this.emitState();
  }

  // Mirrors app/js/phantomplay.js's openRoomStream() — same NDJSON-over-
  // fetch shape (see that function and the realtime-channel design spec for
  // why this isn't SSE/EventSource or a WebSocket), including the stall-
  // watchdog/retry-budget pattern already proven there.
  async openStream() {
    if (this.destroyed || !this.sessionId) return;
    const controller = new AbortController();
    this.streamController = controller;
    this.ensureStallWatchdog();
    try {
      const response = await fetch(`/api/voice/sessions/${encodeURIComponent(this.sessionId)}/stream`, {
        headers: authHeaders(),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(`Voice signaling stream failed (${response.status}).`);
      this.streamFailures = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (!line.trim()) continue;
          let message;
          try { message = JSON.parse(line); } catch { continue; }
          this.streamLastSeenAt = Date.now();
          if (message.type === "presence") this.handlePresence(message.participants);
          else if (message.type === "signal") this.handleSignal(message.from, message.kind, message.payload);
          // "ping" lines: no-op beyond the lastSeen touch above.
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return; // deliberate close/destroy, not a failure
      this.streamFailures += 1;
      if (this.streamFailures <= STREAM_FAILURE_LIMIT && !this.destroyed) {
        setTimeout(() => this.openStream(), 1000 * this.streamFailures);
      } else {
        this.emit("error", { message: `Voice signaling connection was lost: ${error.message}` });
      }
      return;
    }
    if (!this.destroyed) setTimeout(() => this.openStream(), 500);
  }

  ensureStallWatchdog() {
    if (this.stallTimer) return;
    this.stallTimer = setInterval(() => {
      if (!this.streamController || this.destroyed) return;
      const idleMs = Date.now() - this.streamLastSeenAt;
      if (this.streamLastSeenAt && idleMs > STREAM_STALL_TIMEOUT_MS) this.streamController.abort();
    }, 5_000);
  }

  startSpeakingPoll() {
    if (this.speakingTimer) return;
    this.speakingTimer = setInterval(() => {
      let changed = false;
      if (this.localAnalyser && this.localBuffer) {
        const speaking = !this.muted && rms(this.localAnalyser, this.localBuffer) > SPEAKING_THRESHOLD;
        if (speaking !== this.localSpeaking) { this.localSpeaking = speaking; changed = true; }
      }
      for (const entry of this.peers.values()) {
        if (!entry.analyser || !entry.buffer) continue;
        const speaking = rms(entry.analyser, entry.buffer) > SPEAKING_THRESHOLD;
        if (speaking !== entry.speaking) { entry.speaking = speaking; changed = true; }
      }
      if (changed) this.emitState();
    }, SPEAKING_POLL_MS);
  }

  setMuted(muted) {
    this.muted = !!muted;
    this.localStream?.getAudioTracks().forEach((track) => { track.enabled = !this.muted; });
    if (this.sessionId) {
      api(`/api/voice/sessions/${encodeURIComponent(this.sessionId)}/mute`, {
        method: "POST",
        body: JSON.stringify({ tenantId: this.tenantId, muted: this.muted }),
      }).catch(() => undefined);
    }
    this.emitState();
  }

  toggleMuted() {
    this.setMuted(!this.muted);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.connected = false;
    clearInterval(this.stallTimer);
    clearInterval(this.speakingTimer);
    this.streamController?.abort();
    for (const actorId of [...this.peers.keys()]) this.teardownPeer(actorId);
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.audioCtx?.close?.().catch(() => undefined);
    if (this.sessionId) {
      api(`/api/voice/sessions/${encodeURIComponent(this.sessionId)}/leave`, { method: "POST", body: JSON.stringify({ tenantId: this.tenantId }) }).catch(() => undefined);
    }
    this.emitState();
  }
}

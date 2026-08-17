import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE_HOST = String(process.env.PHANTOMFLOW_ENGINE_HOST || "127.0.0.1");
const ENGINE_PORT = Math.max(1, Math.min(65535, Number(process.env.PHANTOMFLOW_ENGINE_PORT || 8001) || 8001));
const ENGINE_BASE = `http://${ENGINE_HOST}:${ENGINE_PORT}`;
const DATA_ROOT = resolve(process.env.PHANTOMFLOW_DATA_DIR || join(process.cwd(), "storage", "phantomflow"));
const LOCAL_APP_DATA = process.env.LOCALAPPDATA || process.env.APPDATA || process.cwd();
const ENGINE_DIR = resolve(LOCAL_APP_DATA, "PhantomFlow", "Engine", "ACE-Step-1.5");
const ENGINE_STATUS_FILE = resolve(DATA_ROOT, "engine-install-status.json");
const OPS_ROOT = fileURLToPath(new URL("../../../ops/phantomflow/", import.meta.url));

export type PhantomFlowGenerationInput = {
  prompt?: unknown;
  title?: unknown;
  lyrics?: unknown;
  genre?: unknown;
  mood?: unknown;
  vocals?: unknown;
  duration?: unknown;
  bpm?: unknown;
  key?: unknown;
  energy?: unknown;
};

export type PhantomFlowTrack = {
  id: string;
  title: string;
  prompt: string;
  genre: string;
  mood: string;
  vocals: string;
  duration: number;
  bpm: number;
  key: string;
  createdAt: string;
  audioPath: string;
  audioUrl: string;
  favorite: boolean;
};

type PhantomFlowTask = {
  id: string;
  tenantId: string;
  title: string;
  prompt: string;
  genre: string;
  mood: string;
  vocals: string;
  duration: number;
  bpm: number;
  key: string;
  createdAt: string;
  status: "queued" | "running" | "completed" | "failed";
  error?: string;
  trackId?: string;
};

const tasks = new Map<string, PhantomFlowTask>();

function clean(value: unknown, max = 300) {
  return String(value ?? "").replace(/[<>\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function safeId(value: unknown, fallback = "phantomflow") {
  return clean(value, 140).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || fallback;
}

function tenantKey(value: unknown) {
  return safeId(value, "local-workspace");
}

function tenantRoot(tenantId: unknown) {
  const root = resolve(DATA_ROOT, tenantKey(tenantId));
  if (!root.startsWith(DATA_ROOT)) throw new Error("phantomflow_tenant_scope_invalid");
  mkdirSync(join(root, "tracks"), { recursive: true });
  return root;
}

function tracksFile(tenantId: unknown) {
  return join(tenantRoot(tenantId), "tracks.json");
}

function readTracks(tenantId: unknown): PhantomFlowTrack[] {
  try {
    const rows = JSON.parse(readFileSync(tracksFile(tenantId), "utf8"));
    return Array.isArray(rows) ? rows.filter((row) => row && typeof row === "object") : [];
  } catch {
    return [];
  }
}

function writeTracks(tenantId: unknown, tracks: PhantomFlowTrack[]) {
  writeFileSync(tracksFile(tenantId), JSON.stringify(tracks.slice(0, 250), null, 2), "utf8");
}

function wantsAggressiveBass(prompt: string) {
  return /\b(?:dubstep|wobble|neuro|brostep|growl bass|riddim)\b/i.test(prompt);
}

function derivedTitle(prompt: string, provided: unknown) {
  const requested = clean(provided, 90);
  if (requested) return requested;
  const words = prompt.replace(/[^a-z0-9\s'-]/gi, " ").split(/\s+/).filter((word) => word.length > 3).slice(0, 4);
  return words.length ? words.map((word) => word[0].toUpperCase() + word.slice(1)).join(" ") : "New PhantomFlow track";
}

export function buildPhantomFlowGeneration(input: PhantomFlowGenerationInput = {}) {
  const prompt = clean(input.prompt, 2600);
  if (!prompt) throw new Error("A music direction is required.");
  const lower = prompt.toLowerCase();
  const genre = clean(input.genre, 60) || (lower.includes("r&b") ? "R&B" : lower.includes("house") ? "House" : lower.includes("rock") ? "Indie rock" : lower.includes("ambient") ? "Ambient" : /hip[- ]?hop|rap|trap/.test(lower) ? "Hip-hop" : lower.includes("cinematic") ? "Cinematic" : "Alternative pop");
  const mood = clean(input.mood, 60) || (lower.includes("dark") ? "Dark" : lower.includes("dream") ? "Dreamy" : lower.includes("euphor") ? "Euphoric" : /peace|soft|calm/.test(lower) ? "Peaceful" : "Emotional");
  const vocals = clean(input.vocals, 60) || (/instrumental|no vocals/.test(lower) ? "Instrumental" : "Lead vocal");
  const instrumental = /instrumental/i.test(vocals) || /^\s*\[instrumental\]\s*$/i.test(String(input.lyrics || ""));
  const bpm = Math.round(clamp(input.bpm, 30, 300, lower.includes("slow") ? 78 : lower.includes("house") ? 124 : 104));
  const duration = Math.round(clamp(input.duration, 10, 600, 180));
  const energy = Math.round(clamp(input.energy, 1, 100, 68));
  const key = clean(input.key, 32) || (mood === "Dark" ? "F minor" : mood === "Euphoric" ? "D major" : "A minor");
  const title = derivedTitle(prompt, input.title);
  const productionDirection = [
    prompt,
    `Genre: ${genre}. Mood: ${mood}. Tempo: ${bpm} BPM. Key: ${key}. Energy: ${energy}%.`,
    `Vocal direction: ${vocals}.`,
    "Produce a complete coherent song with a strong opening, developed sections, transitions, realistic dynamics, and a finished ending.",
    "Use musical drum transients, balanced low end, useful headroom, and clear stereo placement.",
  ];
  if (!wantsAggressiveBass(prompt)) productionDirection.push("Use clean sub bass or a musical 808 appropriate to the genre. Avoid wobble, neuro, growl, metallic bass modulation, and exaggerated pumping.");
  if (instrumental) productionDirection.push("Instrumental only. Do not generate sung or spoken vocals.");
  return {
    title,
    prompt,
    genre,
    mood,
    vocals,
    duration,
    bpm,
    key,
    generation: {
      prompt: productionDirection.join(" "),
      lyrics: instrumental ? "[Instrumental]" : clean(input.lyrics, 12000),
      thinking: true,
      use_format: true,
      vocal_language: "en",
      audio_format: "mp3",
      model: "acestep-v15-turbo",
      lm_model_path: "acestep-5Hz-lm-0.6B",
      lm_backend: "pt",
      lm_temperature: 0.82,
      lm_cfg_scale: 2.5,
      lm_negative_prompt: wantsAggressiveBass(prompt) ? "NO USER INPUT" : "wobble bass, neuro bass, growling bass, metallic EDM bass, harsh bass modulation, distorted low end, fake plastic drums",
      use_cot_caption: true,
      use_cot_language: true,
      constrained_decoding: true,
      bpm,
      key_scale: key,
      time_signature: "4",
      audio_duration: duration,
      inference_steps: 8,
      batch_size: 1,
      use_random_seed: true,
      task_type: "text2music",
    },
  };
}

async function engineJson(pathname: string, options: { method?: string; body?: unknown; timeoutMs?: number } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  try {
    const response = await fetch(`${ENGINE_BASE}${pathname}`, {
      method: options.method || "GET",
      signal: controller.signal,
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const raw = await response.text();
    let payload: unknown = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = raw; }
    if (!response.ok) throw new Error(clean((payload as { detail?: unknown; error?: unknown })?.detail || (payload as { error?: unknown })?.error || "The local music engine did not accept that request.", 240));
    return payload as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

function readInstallStatus() {
  try { return JSON.parse(readFileSync(ENGINE_STATUS_FILE, "utf8")); }
  catch { return { state: "not_started", percent: 0, message: "The local music engine is not installed yet." }; }
}

export async function getPhantomFlowStatus() {
  mkdirSync(DATA_ROOT, { recursive: true });
  let health: Record<string, unknown> | null = null;
  try { health = await engineJson("/health", { timeoutMs: 1200 }); } catch {}
  const installed = existsSync(join(ENGINE_DIR, "pyproject.toml")) || existsSync(join(ENGINE_DIR, ".git"));
  return {
    online: Boolean(health),
    installed,
    state: health ? "ready" : installed ? "offline" : "not_installed",
    engine: "PhantomFlow Local Engine",
    install: readInstallStatus(),
  };
}

export function launchPhantomFlowEngine(action: "install" | "start" | "training") {
  if (process.platform !== "win32") return { ok: false, error: "phantomflow_windows_engine_required" };
  mkdirSync(DATA_ROOT, { recursive: true });
  const scriptName = action === "install" ? "Install-PhantomFlowEngine.ps1" : action === "training" ? "Start-PhantomFlowTraining.ps1" : "Start-PhantomFlowEngine.ps1";
  const script = resolve(OPS_ROOT, scriptName);
  if (!existsSync(script)) return { ok: false, error: "phantomflow_engine_script_missing" };
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
    cwd: OPS_ROOT,
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, PHANTOMFLOW_INSTALL_STATUS: ENGINE_STATUS_FILE },
  });
  child.unref();
  return { ok: true, action, pid: child.pid || null };
}

export async function createPhantomFlowTask(tenantId: unknown, input: PhantomFlowGenerationInput) {
  const plan = buildPhantomFlowGeneration(input);
  const status = await getPhantomFlowStatus();
  if (!status.online) {
    if (status.installed) launchPhantomFlowEngine("start");
    const error = new Error(status.installed ? "PhantomFlow is starting its local music engine. Try this command again when the status changes to Ready." : "PhantomFlow needs its one-time local music engine installation before it can render audio.");
    (error as Error & { code?: string; status?: typeof status }).code = status.installed ? "phantomflow_starting" : "phantomflow_not_installed";
    (error as Error & { status?: typeof status }).status = status;
    throw error;
  }
  const response = await engineJson("/release_task", { method: "POST", body: plan.generation, timeoutMs: 30000 });
  const taskId = clean((response.data as { task_id?: unknown } | undefined)?.task_id, 160);
  if (!taskId) throw new Error("PhantomFlow did not receive a render job from the local engine.");
  const task: PhantomFlowTask = {
    id: taskId,
    tenantId: tenantKey(tenantId),
    title: plan.title,
    prompt: plan.prompt,
    genre: plan.genre,
    mood: plan.mood,
    vocals: plan.vocals,
    duration: plan.duration,
    bpm: plan.bpm,
    key: plan.key,
    createdAt: new Date().toISOString(),
    status: "queued",
  };
  tasks.set(taskId, task);
  return { task, status: "queued" as const };
}

async function cacheTrack(tenantId: string, task: PhantomFlowTask, source: string, metadata: Record<string, unknown>) {
  const url = new URL(source, ENGINE_BASE);
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error("PhantomFlow finished rendering but could not save the audio file.");
  const contentType = String(response.headers.get("content-type") || "").split(";")[0];
  const fromPath = extname(url.searchParams.get("path") || url.pathname).toLowerCase();
  const byType: Record<string, string> = { "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/flac": ".flac", "audio/ogg": ".ogg", "audio/aac": ".aac" };
  const extension = [".mp3", ".wav", ".flac", ".ogg", ".opus", ".aac"].includes(fromPath) ? fromPath : byType[contentType] || ".mp3";
  const id = safeId(`${task.title}-${Date.now().toString(36)}`, `track-${Date.now().toString(36)}`);
  const fileName = `${id}${extension}`;
  const audioPath = join(tenantRoot(tenantId), "tracks", fileName);
  writeFileSync(audioPath, Buffer.from(await response.arrayBuffer()));
  const meta = metadata.metas && typeof metadata.metas === "object" ? metadata.metas as Record<string, unknown> : {};
  const track: PhantomFlowTrack = {
    id,
    title: task.title,
    prompt: task.prompt,
    genre: task.genre,
    mood: task.mood,
    vocals: task.vocals,
    duration: clamp(meta.duration, 1, 3600, task.duration),
    bpm: Math.round(clamp(meta.bpm, 30, 300, task.bpm)),
    key: clean(meta.keyscale, 32) || task.key,
    createdAt: new Date().toISOString(),
    audioPath,
    audioUrl: `/api/phantomflow/tracks/${encodeURIComponent(id)}/audio`,
    favorite: false,
  };
  const tracks = readTracks(tenantId).filter((row) => row.id !== id);
  tracks.unshift(track);
  writeTracks(tenantId, tracks);
  return track;
}

export async function readPhantomFlowTask(tenantId: unknown, taskId: unknown) {
  const id = clean(taskId, 160);
  const task = tasks.get(id);
  if (!task || task.tenantId !== tenantKey(tenantId)) return null;
  if (task.status === "completed" || task.status === "failed") return task;
  const response = await engineJson("/query_result", { method: "POST", body: { task_id_list: [id] }, timeoutMs: 30000 });
  const rows = Array.isArray(response.data) ? response.data as Array<Record<string, unknown>> : [];
  const row = rows.find((item) => clean(item.task_id, 160) === id);
  if (!row || Number(row.status) === 0) {
    task.status = "running";
    return task;
  }
  if (Number(row.status) === 2) {
    task.status = "failed";
    task.error = clean(row.error || row.result || "The local music render did not complete.", 240);
    return task;
  }
  let parsed: unknown = row.parsed_result;
  if (!parsed && row.result) {
    try { parsed = typeof row.result === "string" ? JSON.parse(row.result) : row.result; } catch { parsed = []; }
  }
  const outputs = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  const output = outputs.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).file) as Record<string, unknown> | undefined;
  if (!output?.file) {
    task.status = "failed";
    task.error = "PhantomFlow completed without an audio file.";
    return task;
  }
  const track = await cacheTrack(task.tenantId, task, String(output.file), output);
  task.status = "completed";
  task.trackId = track.id;
  return { ...task, track };
}

export function listPhantomFlowTracks(tenantId: unknown) {
  return readTracks(tenantId).map(({ audioPath: _audioPath, ...track }) => track);
}

export function phantomFlowTrackFile(tenantId: unknown, trackId: unknown) {
  const id = safeId(trackId, "");
  const track = readTracks(tenantId).find((row) => row.id === id);
  if (!track) return null;
  const target = resolve(track.audioPath);
  const allowed = resolve(tenantRoot(tenantId), "tracks");
  if (!target.startsWith(allowed) || !existsSync(target) || !statSync(target).isFile()) return null;
  return { path: target, fileName: basename(target), contentType: ({ ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".aac": "audio/aac" } as Record<string, string>)[extname(target).toLowerCase()] || "application/octet-stream" };
}

export function phantomFlowStorageDiagnostics() {
  mkdirSync(DATA_ROOT, { recursive: true });
  return { root: DATA_ROOT, tenants: readdirSync(DATA_ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length };
}

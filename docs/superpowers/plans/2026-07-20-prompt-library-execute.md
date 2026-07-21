# Prompt Library: Server Persistence + Send-to-Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Prompt Library's curated prompt set from a hardcoded client array to a global, server-persisted, admin-editable store, and add a one-click "Send" action that runs a prompt straight through the existing Phantom AI chat pipeline.

**Architecture:** A new `prompt-library-store.ts` module (mirrors `crm-pipeline-store.ts`'s checksum/lock/JSON-file pattern, but as one global document instead of per-tenant) backs four new routes on the existing Fastify app. `promptlibrary.js` fetches from those routes instead of importing a hardcoded array, gains a Send button that hands the prompt to the Phantom AI workspace via the same `workspaceStorage` intent-handoff pattern `medialab.js` already uses, and — for admins only — gains Add/Edit/Delete UI wired to the new mutating routes. `phantomai.js` gains a `consumeChatIntent()` reader (mirroring `medialab.js`'s `consumePromptIntent()`) that pre-fills and auto-submits the chat form using the exact same `handleSmartCommand`/`handleCommand` path a manually typed message already uses.

**Tech Stack:** TypeScript (Fastify server, Node `fs/promises`), vanilla JS frontend modules (no framework), `tsx` for server test scripts, sha256-checksummed JSON-file storage (no database).

## Global Constraints

- Global library (one shared curated set for the whole platform), not per-tenant. Per the approved spec.
- Admin-curated only — no user-submitted prompts in this scope.
- Plain text prompts only — no `{{variable}}` templating in this scope.
- Any user-visible admin/app change in this repo MUST ship via `npm run ship:live-admin -- --commit "..."` from `C:\Users\jorda\Documents\Codex\deployments\phantomforce-live` (per that checkout's own `CLAUDE.md`) — never a bare `git push`, and never report something as "shipped" without that command printing `LIVE ADMIN SHIP PASSED`.
- Any edit to `app/index.html`, `app/phantom.css`, or `app/js/*.js` requires the `phantom-live-YYYYMMDD-N` cache id bump — `ship:live-admin` does this automatically; do not hand-edit the id.
- Do not touch `/phantom-ai/chat`, the prompt-injection guard, or usage metering — Send must reuse that pipeline exactly as a manually typed chat message does.
- Multiple agent sessions may be editing this checkout concurrently — this is expected. Scope every `git status`/`git add` to only the files this plan touches; never stash or discard unrelated dirty files.

---

## Task 1: Backend data store — `prompt-library-store.ts`

**Files:**
- Create: `server/src/prompt-library/prompt-library-store.ts`
- Create: `server/scripts/test-prompt-library-store.ts`
- Modify: `server/package.json` (add test script)

**Interfaces:**
- Produces: `PromptLibraryEntry`, `PromptLibraryDocument` types; `SEED_PROMPTS: PromptLibraryEntry[]`; `promptLibraryRoot(override?)`, `defaultPromptLibraryDocument(actor?)`, `normalizePromptLibraryEntry(value, actor, existing?)`, `readPromptLibraryDocument(root?)`, `getPromptLibraryDocument(actor?, root?)`, `createPromptLibraryEntry({ entry, actor, root? })`, `updatePromptLibraryEntry({ id, patch, actor, root? })`, `deletePromptLibraryEntry({ id, actor, root? })`, `publicPromptLibraryDocument(document)` — all consumed by Task 2.

- [ ] **Step 1: Write the failing test**

Create `server/scripts/test-prompt-library-store.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPromptLibraryEntry,
  deletePromptLibraryEntry,
  getPromptLibraryDocument,
  publicPromptLibraryDocument,
  SEED_PROMPTS,
  updatePromptLibraryEntry,
} from "../src/prompt-library/prompt-library-store.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const tempDir = await mkdtemp(join(tmpdir(), "phantom-prompt-library-"));

try {
  const initial = await getPromptLibraryDocument("system", tempDir);
  assert(initial.prompts.length === 26, "A fresh library should contain all 26 seed prompts.");
  assert(initial.version === 1, "A fresh library should be version 1.");
  assert(initial.checksum.length === 64, "Document should carry a sha256 checksum.");
  assert(
    initial.prompts.every((p) => SEED_PROMPTS.some((seed) => seed.id === p.id)),
    "Fresh library prompts should all come from SEED_PROMPTS.",
  );

  const created = await createPromptLibraryEntry({
    entry: { cat: "hook", title: "Test prompt", platform: "Any platform", prompt: "Say hello to [name].", tags: ["test"] },
    actor: "admin-jordan",
    root: tempDir,
  });
  assert(created.result.title === "Test prompt", "Created entry should carry the given title.");
  assert(created.document.prompts.length === 27, "Library should grow by one after create.");
  assert(created.document.version === 2, "Version should increment on write.");

  const createdId = created.result.id;
  const updated = await updatePromptLibraryEntry({
    id: createdId,
    patch: { title: "Renamed test prompt" },
    actor: "admin-jordan",
    root: tempDir,
  });
  assert(updated.result.title === "Renamed test prompt", "Update should apply the patch.");
  assert(updated.result.prompt === "Say hello to [name].", "Update should preserve untouched fields.");
  assert(updated.document.version === 3, "Version should increment again on update.");

  const deleted = await deletePromptLibraryEntry({ id: createdId, actor: "admin-jordan", root: tempDir });
  assert(deleted.result?.id === createdId, "Delete should return the removed entry.");
  assert(deleted.document.prompts.length === 26, "Library should shrink back to 26 after delete.");

  const publicDoc = publicPromptLibraryDocument(deleted.document);
  assert(Array.isArray(publicDoc.prompts), "Public document should expose a prompts array.");
  assert(typeof publicDoc.checksum === "string", "Public document should expose a checksum.");

  let threw = false;
  try {
    await updatePromptLibraryEntry({ id: "does-not-exist", patch: { title: "x" }, actor: "system", root: tempDir });
  } catch {
    threw = true;
  }
  assert(threw, "Updating a missing prompt id should throw.");

  console.log(JSON.stringify({ ok: true, seedCount: SEED_PROMPTS.length }, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx tsx scripts/test-prompt-library-store.ts`
Expected: FAIL — `Cannot find module '../src/prompt-library/prompt-library-store.js'`

- [ ] **Step 3: Write the store implementation**

Create `server/src/prompt-library/prompt-library-store.ts`:

```ts
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PromptLibraryCategory = "image" | "video" | "caption" | "ad" | "hook";

export type PromptLibraryEntry = {
  id: string;
  cat: PromptLibraryCategory;
  title: string;
  platform: string;
  prompt: string;
  tags: string[];
  addedMonth: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type PromptLibraryDocument = {
  schemaVersion: 1;
  version: number;
  prompts: PromptLibraryEntry[];
  updatedAt: string;
  updatedBy: string;
  checksum: string;
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const defaultRoot = resolve(repoRoot, "server/.local/prompt-library");
const GLOBAL_LOCK_KEY = "global";
const locks = new Map<string, Promise<unknown>>();
const CATEGORIES = new Set<string>(["image", "video", "caption", "ad", "hook"]);
const SEED_TIMESTAMP = "2026-07-01T00:00:00.000Z";

export function promptLibraryRoot(override?: string) {
  return resolve(override || process.env.PHANTOMFORCE_PROMPT_LIBRARY_DIR || defaultRoot);
}

function documentPath(root?: string) {
  return resolve(promptLibraryRoot(root), "library.json");
}

function checksum(document: Omit<PromptLibraryDocument, "checksum">) {
  return createHash("sha256").update(JSON.stringify(document)).digest("hex");
}

async function withGlobalLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(GLOBAL_LOCK_KEY) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  locks.set(GLOBAL_LOCK_KEY, current);
  try {
    return await current;
  } finally {
    if (locks.get(GLOBAL_LOCK_KEY) === current) locks.delete(GLOBAL_LOCK_KEY);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, max = 240) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanPromptText(value: unknown, max = 2000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanCategory(value: unknown): PromptLibraryCategory {
  return typeof value === "string" && CATEGORIES.has(value) ? (value as PromptLibraryCategory) : "hook";
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((t) => cleanText(t, 40)).filter(Boolean).slice(0, 10);
}

function documentWithChecksum(document: Omit<PromptLibraryDocument, "checksum">): PromptLibraryDocument {
  return { ...document, checksum: checksum(document) };
}

export function normalizePromptLibraryEntry(
  value: unknown,
  actor: string,
  existing?: PromptLibraryEntry,
): PromptLibraryEntry {
  const source = isRecord(value) ? value : {};
  const now = new Date().toISOString();
  const title = cleanText(source.title ?? existing?.title, 120);
  return {
    id: cleanText(source.id ?? existing?.id, 90) || randomUUID(),
    cat: cleanCategory(source.cat ?? existing?.cat),
    title: title || "Untitled prompt",
    platform: cleanText(source.platform ?? existing?.platform, 80) || "Any platform",
    prompt: cleanPromptText(source.prompt ?? existing?.prompt),
    tags: cleanTags(source.tags ?? existing?.tags),
    addedMonth: cleanText(source.addedMonth ?? existing?.addedMonth, 10) || now.slice(0, 7),
    createdAt: cleanText(existing?.createdAt ?? (source.createdAt as string), 80) || now,
    updatedAt: now,
    updatedBy: cleanText(actor, 120) || "system",
  };
}

export const SEED_PROMPTS: PromptLibraryEntry[] = [
  { id: "img-editorial-portrait", cat: "image", title: "Editorial portrait, natural light", platform: "Midjourney / Nano Banana",
    prompt: "Portrait of a [subject], standing near a large window with soft diffused natural light, shallow depth of field, shot on an 85mm portrait lens at f/1.8, subtle skin texture, natural color grading, editorial magazine quality --ar 2:3",
    tags: ["portrait", "realistic", "editorial"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "img-studio-product", cat: "image", title: "Clean studio product shot", platform: "Midjourney / Nano Banana",
    prompt: "Studio product photo of [product] on a seamless [color] background, soft box lighting from both sides, subtle reflection below, no shadows on backdrop, sharp focus on label details, commercial e-commerce quality --ar 1:1",
    tags: ["product", "e-commerce", "studio"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "img-concept-character", cat: "image", title: "Cinematic character concept art", platform: "Midjourney",
    prompt: "Concept art of [character description] in a [setting], dramatic rim lighting, painterly digital brushwork, muted color palette with one accent color, cinematic composition, in the style of a AAA game key art --ar 16:9",
    tags: ["concept-art", "character", "cinematic"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "img-lifestyle-brand", cat: "image", title: "Moody lifestyle brand photo", platform: "Midjourney / Nano Banana",
    prompt: "Lifestyle photo of a person using [product] in a [setting], candid unposed moment, warm golden hour light, shot on 35mm film, slight grain, shallow depth of field, aspirational but authentic mood --ar 4:5",
    tags: ["lifestyle", "brand", "social"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "img-vector-icon", cat: "image", title: "Isometric vector app icon", platform: "Midjourney",
    prompt: "Isometric vector icon of [object/concept], flat design, bold clean shapes, two-tone color palette, soft drop shadow, centered on a plain background, app icon style --ar 1:1",
    tags: ["icon", "vector", "flat-design"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "img-golden-architecture", cat: "image", title: "Golden hour architecture", platform: "Midjourney / Nano Banana",
    prompt: "Modernist building exterior at golden hour, low sun angle casting long shadows, glass and concrete textures, wide angle architectural photography, dramatic sky, ultra sharp, shot on a tilt-shift lens --ar 16:9",
    tags: ["architecture", "golden-hour"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "vid-aerial-reveal", cat: "video", title: "Sweeping aerial reveal", platform: "Sora / Veo / Kling",
    prompt: "A sweeping aerial shot over a misty mountain range at golden hour, the camera slowly pushing forward and revealing a hidden valley with a winding river below, volumetric fog, warm sunlight filtering through clouds, 4K cinematic, shallow depth of field at the edges of frame.",
    tags: ["aerial", "establishing-shot", "nature"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "vid-tracking-forest", cat: "video", title: "Low tracking shot through nature", platform: "Sora / Veo / Kling",
    prompt: "A low-angle tracking shot through a dense bamboo forest, the camera gliding smoothly at waist height, dappled sunlight breaking through the canopy, a gentle breeze causing slight movement in the leaves, green and gold color palette, subtle anamorphic lens flare.",
    tags: ["tracking-shot", "nature", "cinematic"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "vid-closeup-narrative", cat: "video", title: "Narrative extreme close-up", platform: "Sora / Veo",
    prompt: "An extreme close-up of [a person], deep in thought, sitting at a café table in [a city], golden light and street life blurred in the background, cinematic 35mm film look, shallow depth of field, the camera holds still as their expression slowly shifts from worry to resolve.",
    tags: ["narrative", "close-up", "emotional"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "vid-product-hero", cat: "video", title: "Product hero reveal", platform: "Sora / Veo / Kling",
    prompt: "A hero product shot of [product] rotating slowly on a reflective dark surface, dramatic studio lighting sweeping across its surface, subtle dust particles catching the light, the camera pushes in as the product comes into full focus, commercial-grade render quality.",
    tags: ["product", "commercial", "reveal"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "vid-ugc-hook", cat: "video", title: "UGC-style talking opener", platform: "Sora / Veo / Runway",
    prompt: "A handheld selfie-style shot of a person talking directly to camera in [a casual setting], natural phone-camera framing, authentic unpolished lighting, energetic delivery, the first line is a bold claim delivered straight to the lens before the shot cuts.",
    tags: ["ugc", "talking-head", "hook"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "vid-day-in-life", cat: "video", title: "Day-in-the-life montage", platform: "Sora / Veo / Kling",
    prompt: "A fast-paced montage of [a person]'s morning routine — waking up, making coffee, opening a laptop, stepping outside — each clip 2-3 seconds, quick match cuts on movement, warm natural lighting throughout, upbeat rhythmic pacing, consistent color grade across all shots.",
    tags: ["montage", "lifestyle", "social"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "cap-instagram-hook", cat: "caption", title: "Instagram caption with a hook", platform: "Instagram",
    prompt: "Write a playful Instagram caption for [brand/topic], under 100 words, opening with a scroll-stopping first line, one clear takeaway in the middle, and a soft call-to-action at the end. Tone: [describe brand voice].",
    tags: ["instagram", "caption"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "cap-linkedin-leadership", cat: "caption", title: "LinkedIn thought-leadership post", platform: "LinkedIn",
    prompt: "Write a LinkedIn post (150-250 words) sharing one specific lesson from [experience/result]. Open with a one-line hook, tell the story in 2-3 short paragraphs, and close with a takeaway the reader can apply today. Confident, no fluff, no hashtags spam.",
    tags: ["linkedin", "thought-leadership"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "cap-tiktok-script", cat: "caption", title: "20-second TikTok spoken script", platform: "TikTok",
    prompt: "Write a 20-second spoken script for a TikTok about [topic]. Structure: a 3-word hook on screen, a 1-sentence problem, a quick demonstration or reveal, and a punchy last line that invites a comment. Casual, fast-paced, no corporate tone.",
    tags: ["tiktok", "script", "short-form"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "cap-x-post", cat: "caption", title: "Single punchy X post", platform: "X",
    prompt: "Write one X post under 280 characters about [topic]. It should make a single sharp point, use plain language, no hashtags, and end with something quotable or a light contrarian angle worth replying to.",
    tags: ["x", "twitter", "short-form"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "cap-before-after", cat: "caption", title: "Before/after transformation post", platform: "Instagram / TikTok / X",
    prompt: "Write a before/after post about [customer or product result]. Format: one-line hook, the 'before' situation in one sentence, the 'after' result in one sentence, and a single-line call-to-action. Keep every line short enough to read in under 3 seconds.",
    tags: ["transformation", "social-proof"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "cap-behind-scenes", cat: "caption", title: "Behind-the-scenes authenticity post", platform: "Instagram / TikTok",
    prompt: "Write a behind-the-scenes caption showing the real, unpolished process behind [product/result]. Conversational first-person tone, one honest detail most brands wouldn't share, ending on a question that invites replies.",
    tags: ["behind-the-scenes", "authenticity"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "ad-direct-response", cat: "ad", title: "Direct-response ad headline + body", platform: "Meta / Google Ads",
    prompt: "Write 3 direct-response ad variations for [product/offer] targeting [audience]. Each variation: one headline under 8 words leading with the biggest benefit, 2 short body lines addressing the main objection, and one clear call-to-action.",
    tags: ["ad-copy", "direct-response"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "ad-email-subject", cat: "ad", title: "Email subject line + preview set", platform: "Email",
    prompt: "Write 5 email subject lines (under 45 characters) and matching preview text (under 90 characters) for an email about [offer/topic]. Vary the angle across curiosity, urgency, benefit, and social proof.",
    tags: ["email", "subject-lines"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "ad-landing-hero", cat: "ad", title: "Landing page hero copy", platform: "Website",
    prompt: "Write landing page hero copy for [product]: a headline under 10 words stating the core outcome, a one-sentence subheadline explaining how it works, and a single primary button label. Speak to [audience] and their main pain point directly.",
    tags: ["landing-page", "hero-copy"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "ad-retarget-short", cat: "ad", title: "Retargeting ad short copy", platform: "Meta / Google Ads",
    prompt: "Write short retargeting ad copy (under 20 words) for someone who viewed [product] but didn't buy. Address the likely hesitation directly and offer one specific reason to come back now.",
    tags: ["retargeting", "ad-copy"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "hook-pattern-interrupt", cat: "hook", title: "Pattern-interrupt opening lines", platform: "Any platform",
    prompt: "Give me 10 pattern-interrupt opening lines for a video or post about [topic] — each one should make someone stop scrolling in the first 2 seconds by contradicting an assumption, asking an odd question, or stating a surprising number.",
    tags: ["hooks", "brainstorm"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "hook-trendjack", cat: "hook", title: "Trend-jacking angle finder", platform: "Any platform",
    prompt: "Here's a trend/format: [describe the trend]. Give me 5 ways [brand/topic] could authentically show up in this trend without forcing it, ranked from safest to boldest.",
    tags: ["trends", "brainstorm"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "hook-weekly-batch", cat: "hook", title: "Weekly content idea batch", platform: "Any platform",
    prompt: "Give me 7 content ideas for [brand/topic] for this week — one per day, each a different format (educational, behind-the-scenes, testimonial, trend, question, list, story) so the week feels varied, not repetitive.",
    tags: ["content-calendar", "brainstorm"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
  { id: "hook-3act-story", cat: "hook", title: "3-act story hook", platform: "Any platform",
    prompt: "Turn this result into a 3-act story hook for [topic]: Act 1 — the problem/frustration in one line, Act 2 — the turning point or attempt, Act 3 — the outcome, ending on a line that invites the reader to ask 'how'.",
    tags: ["storytelling", "hooks"], addedMonth: "2026-07", createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP, updatedBy: "system" },
];

export function defaultPromptLibraryDocument(actor = "system"): PromptLibraryDocument {
  const now = new Date().toISOString();
  return documentWithChecksum({
    schemaVersion: 1,
    version: 1,
    prompts: SEED_PROMPTS,
    updatedAt: now,
    updatedBy: actor,
  });
}

export async function readPromptLibraryDocument(root?: string): Promise<PromptLibraryDocument | null> {
  try {
    const raw = JSON.parse(await readFile(documentPath(root), "utf8")) as PromptLibraryDocument;
    return documentWithChecksum({
      schemaVersion: 1,
      version: Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1,
      prompts: Array.isArray(raw.prompts)
        ? raw.prompts.map((p) => normalizePromptLibraryEntry(p, p.updatedBy || "system", p))
        : [],
      updatedAt: cleanText(raw.updatedAt, 80) || new Date().toISOString(),
      updatedBy: cleanText(raw.updatedBy, 120) || "system",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writePromptLibraryDocumentUnlocked(document: PromptLibraryDocument, root?: string) {
  const path = documentPath(root);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
  return path;
}

export async function getPromptLibraryDocument(actor = "system", root?: string) {
  return (await readPromptLibraryDocument(root)) ?? defaultPromptLibraryDocument(actor);
}

async function mutatePromptLibraryDocument<T>(
  actor: string,
  operation: (document: PromptLibraryDocument) => T,
  root?: string,
) {
  return withGlobalLock(async () => {
    const current = await getPromptLibraryDocument(actor, root);
    const result = operation(current);
    const now = new Date().toISOString();
    const document = documentWithChecksum({
      schemaVersion: 1,
      version: current.version + 1,
      prompts: current.prompts.slice(0, 500),
      updatedAt: now,
      updatedBy: actor,
    });
    const path = await writePromptLibraryDocumentUnlocked(document, root);
    return { path, document, result };
  });
}

export async function createPromptLibraryEntry(options: { entry: unknown; actor: string; root?: string }) {
  return mutatePromptLibraryDocument(
    options.actor,
    (document) => {
      const entry = normalizePromptLibraryEntry(options.entry, options.actor);
      document.prompts.unshift(entry);
      return entry;
    },
    options.root,
  );
}

export async function updatePromptLibraryEntry(options: {
  id: string;
  patch: unknown;
  actor: string;
  root?: string;
}) {
  return mutatePromptLibraryDocument(
    options.actor,
    (document) => {
      const existing = document.prompts.find((p) => p.id === options.id);
      if (!existing) throw new Error("Prompt not found.");
      const next = normalizePromptLibraryEntry(
        { ...existing, ...(isRecord(options.patch) ? options.patch : {}) },
        options.actor,
        existing,
      );
      Object.assign(existing, next, { id: existing.id, createdAt: existing.createdAt });
      return existing;
    },
    options.root,
  );
}

export async function deletePromptLibraryEntry(options: { id: string; actor: string; root?: string }) {
  return mutatePromptLibraryDocument(
    options.actor,
    (document) => {
      const existing = document.prompts.find((p) => p.id === options.id);
      document.prompts = document.prompts.filter((p) => p.id !== options.id);
      return existing ?? null;
    },
    options.root,
  );
}

export function publicPromptLibraryDocument(document: PromptLibraryDocument) {
  return structuredClone({
    schemaVersion: document.schemaVersion,
    version: document.version,
    prompts: document.prompts,
    updatedAt: document.updatedAt,
    updatedBy: document.updatedBy,
    checksum: document.checksum,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx tsx scripts/test-prompt-library-store.ts`
Expected: PASS, prints `{ "ok": true, "seedCount": 26 }`

- [ ] **Step 5: Register the npm script**

In `server/package.json`, in the `"scripts"` block (alphabetically near the other `test:` entries), add:

```json
"test:prompt-library-store": "tsx scripts/test-prompt-library-store.ts",
```

- [ ] **Step 6: Run via the registered script**

Run: `cd server && npm run test:prompt-library-store`
Expected: PASS, same output as Step 4

- [ ] **Step 7: Commit (local, backend-only file — not yet wired to a live route)**

```bash
git add server/src/prompt-library/prompt-library-store.ts server/scripts/test-prompt-library-store.ts server/package.json
git commit -m "Add prompt-library-store: global JSON-backed, checksummed, admin-editable prompt library data layer"
```

---

## Task 2: Backend routes — `GET/POST/PUT/DELETE /prompt-library`

**Files:**
- Modify: `server/src/index.ts` (add import + 4 routes, near the other `/phantom-ai/*` routes, right after the `/phantom-ai/chat` handler)
- Create: `server/scripts/test-prompt-library-routes.ts`
- Modify: `server/package.json` (add test script)

**Interfaces:**
- Consumes: everything Task 1 exports from `./prompt-library/prompt-library-store.js`, plus existing `requireAccessSession`, `requireAdminAccessSession` (already imported in `index.ts`), and the existing `z` (zod) import already used by other route schemas in this file.
- Produces: `GET /prompt-library` → `{ ok: true, document: PublicPromptLibraryDocument }`; `POST /prompt-library` → `{ ok: true, document, entry }`; `PUT /prompt-library/:id` → `{ ok: true, document, entry }`; `DELETE /prompt-library/:id` → `{ ok: true, document, deleted }`. These response shapes are what Task 3's frontend fetch calls consume.

- [ ] **Step 1: Write the failing test**

Create `server/scripts/test-prompt-library-routes.ts`:

```ts
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";
process.env.PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false";

const { app } = await import("../src/index.js");

type LoginResponse = { ok: boolean; token: string };
type PromptEntry = { id: string; title: string; cat: string; prompt: string };
type LibraryResponse = { ok: boolean; document: { prompts: PromptEntry[]; checksum: string; version: number } };

try {
  const unauth = await app.inject({ method: "GET", url: "/prompt-library" });
  assert(unauth.statusCode === 401, "Unauthenticated list should return 401.");

  const clientLogin = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "client-chicagoshots" }),
  });
  assert(clientLogin.statusCode === 200, "Client demo login should succeed.");
  const clientToken = parseJson<LoginResponse>(clientLogin.payload).token;
  const clientHeaders = { Authorization: `Bearer ${clientToken}` };

  const clientList = await app.inject({ method: "GET", url: "/prompt-library", headers: clientHeaders });
  assert(clientList.statusCode === 200, "Any authenticated session should be able to list the library.");
  const clientListBody = parseJson<LibraryResponse>(clientList.payload);
  assert(clientListBody.document.prompts.length === 26, "Fresh library should list all 26 seed prompts.");

  const clientCreate = await app.inject({
    method: "POST",
    url: "/prompt-library",
    headers: { ...clientHeaders, "Content-Type": "application/json" },
    payload: JSON.stringify({ cat: "hook", title: "Client attempt", prompt: "Should not be allowed." }),
  });
  assert(clientCreate.statusCode === 403, "Non-admin create should return 403.");

  const adminLogin = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "admin-jordan" }),
  });
  assert(adminLogin.statusCode === 200, "Admin demo login should succeed.");
  const adminToken = parseJson<LoginResponse>(adminLogin.payload).token;
  const adminHeaders = { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" };

  const adminCreate = await app.inject({
    method: "POST",
    url: "/prompt-library",
    headers: adminHeaders,
    payload: JSON.stringify({ cat: "hook", title: "Admin test prompt", prompt: "Say hi to [name]." }),
  });
  assert(adminCreate.statusCode === 200, "Admin create should return 200.");
  const created = parseJson<{ ok: boolean; entry: PromptEntry }>(adminCreate.payload);
  assert(created.entry.title === "Admin test prompt", "Created entry should carry the given title.");

  const adminUpdate = await app.inject({
    method: "PUT",
    url: `/prompt-library/${encodeURIComponent(created.entry.id)}`,
    headers: adminHeaders,
    payload: JSON.stringify({ title: "Renamed admin test prompt" }),
  });
  assert(adminUpdate.statusCode === 200, "Admin update should return 200.");
  const updated = parseJson<{ ok: boolean; entry: PromptEntry }>(adminUpdate.payload);
  assert(updated.entry.title === "Renamed admin test prompt", "Update should apply.");

  const clientDelete = await app.inject({
    method: "DELETE",
    url: `/prompt-library/${encodeURIComponent(created.entry.id)}`,
    headers: clientHeaders,
  });
  assert(clientDelete.statusCode === 403, "Non-admin delete should return 403.");

  const adminDelete = await app.inject({
    method: "DELETE",
    url: `/prompt-library/${encodeURIComponent(created.entry.id)}`,
    headers: adminHeaders,
  });
  assert(adminDelete.statusCode === 200, "Admin delete should return 200.");

  const finalList = await app.inject({ method: "GET", url: "/prompt-library", headers: clientHeaders });
  const finalBody = parseJson<LibraryResponse>(finalList.payload);
  assert(finalBody.document.prompts.length === 26, "Library should be back to 26 prompts after cleanup.");

  console.log(JSON.stringify({ ok: true, finalCount: finalBody.document.prompts.length }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx tsx scripts/test-prompt-library-routes.ts`
Expected: FAIL — 404s on `/prompt-library` (routes don't exist yet)

- [ ] **Step 3: Add the import**

In `server/src/index.ts`, immediately after the existing `crm-pipeline-store.js` import block (the one ending `} from "./crm/crm-pipeline-store.js";`), add:

```ts
import {
  createPromptLibraryEntry,
  deletePromptLibraryEntry,
  getPromptLibraryDocument,
  publicPromptLibraryDocument,
  updatePromptLibraryEntry,
} from "./prompt-library/prompt-library-store.js";
```

- [ ] **Step 4: Add the routes**

In `server/src/index.ts`, find the closing `});` of the `app.post("/phantom-ai/chat", ...)` handler (the one that begins `app.post("/phantom-ai/chat", async (request, reply) => {` and validates via `requireAccessSession`). Immediately after that handler's closing `});`, insert:

```ts
const PromptLibraryEntrySchema = z.object({
  cat: z.enum(["image", "video", "caption", "ad", "hook"]).optional(),
  title: z.string().trim().min(1).max(120),
  platform: z.string().trim().max(80).optional(),
  prompt: z.string().trim().min(1).max(2000),
  tags: z.array(z.string().trim().max(40)).max(10).optional(),
});
const PromptLibraryPatchSchema = PromptLibraryEntrySchema.partial();

app.get("/prompt-library", async (request, reply) => {
  const session = requireAccessSession(request, reply);
  if (!session) return reply;
  const document = await getPromptLibraryDocument(session.name || session.sessionId || "system");
  return { ok: true, document: publicPromptLibraryDocument(document) };
});

app.post("/prompt-library", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const parsed = PromptLibraryEntrySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  }
  const actor = session.name || session.sessionId || "admin";
  const { document, result } = await createPromptLibraryEntry({ entry: parsed.data, actor });
  return { ok: true, document: publicPromptLibraryDocument(document), entry: result };
});

app.put("/prompt-library/:id", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const { id } = request.params as { id: string };
  const parsed = PromptLibraryPatchSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
  }
  const actor = session.name || session.sessionId || "admin";
  try {
    const { document, result } = await updatePromptLibraryEntry({ id, patch: parsed.data, actor });
    return { ok: true, document: publicPromptLibraryDocument(document), entry: result };
  } catch {
    return reply.code(404).send({ ok: false, error: "Prompt not found." });
  }
});

app.delete("/prompt-library/:id", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;
  const { id } = request.params as { id: string };
  const actor = session.name || session.sessionId || "admin";
  const { document, result } = await deletePromptLibraryEntry({ id, actor });
  return { ok: true, document: publicPromptLibraryDocument(document), deleted: result };
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx tsx scripts/test-prompt-library-routes.ts`
Expected: PASS, prints `{ "ok": true, "finalCount": 26 }`

- [ ] **Step 6: Register the npm script**

In `server/package.json`, add:

```json
"test:prompt-library-routes": "tsx scripts/test-prompt-library-routes.ts",
```

- [ ] **Step 7: Run via the registered script and typecheck**

Run: `cd server && npm run test:prompt-library-routes && npm run build --if-present`
Expected: test PASS; typecheck/build (if a build script exists in `server/package.json`) completes with no new errors

- [ ] **Step 8: Ship**

This changes a live server route (`server/src/index.ts`), so it must go out through the mandatory gate rather than a bare commit:

```bash
cd C:\Users\jorda\Documents\Codex\deployments\phantomforce-live
npm run ship:live-admin -- --commit "Add server-persisted, admin-editable Prompt Library routes"
```

Expected: prints `LIVE ADMIN SHIP PASSED`. If it does not, report the exact failing step — do not report this as shipped.

---

## Task 3: Frontend — `promptlibrary.js` fetches from the server, adds Send + admin Add/Edit/Delete

**Files:**
- Modify: `app/js/promptlibrary.js`

**Interfaces:**
- Consumes: `GET/POST/PUT/DELETE /prompt-library` from Task 2; `session` export from `./store.js` (for `authHeaders`, matching the pattern in `orgs.js`/`vacation.js`/`phantomstore.js`); `opts.openWorkspace` and `opts.notify` (already passed into `renderPromptLibrary` from `main.js`'s `mediaOpts()`); `isAdmin` export from `./store.js`.
- Produces: writes `{ prompt, autoSend: true }` to a new `workspaceStorage` key `pf.phantomai.chatIntent.v1` — this is what Task 4's `consumeChatIntent()` reads.

This task is UI-heavy (no server round-trip to unit-test meaningfully beyond what Task 2 already covers), so verification here is manual per the Global Constraints — launch the dev server and click through it, per Step 5.

- [ ] **Step 1: Replace the hardcoded seed with a server fetch**

In `app/js/promptlibrary.js`, replace the import line and remove the `PROMPT_SEED` constant (the entire `export const PROMPT_SEED = [...]` block, now that Task 1/2 own that data), replacing them with:

```js
import { isAdmin, session, workspaceStorageGetItem, workspaceStorageSetItem } from "./store.js?v=phantom-live-20260719-68";

const LIB_KEY = "pf.promptlibrary.v1";
const MEDIA_INTENT_KEY = "pf.medialab.promptIntent.v1";
const CHAT_INTENT_KEY = "pf.phantomai.chatIntent.v1";

function authHeaders(json = false) {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new Error(typeof payload?.error === "string" ? payload.error : `Prompt Library request failed (${response.status}).`);
  }
  return payload;
}

let serverPrompts = null;
let serverError = false;
let loadPromise = null;

function ensureServerPromptsLoaded(onReady) {
  if (serverPrompts !== null || serverError) return;
  if (!loadPromise) {
    loadPromise = api("/prompt-library")
      .then((data) => { serverPrompts = Array.isArray(data.document?.prompts) ? data.document.prompts : []; })
      .catch(() => { serverError = true; })
      .finally(() => { loadPromise = null; onReady(); });
  }
}
```

(`PROMPT_CATEGORIES` and `LIBRARY_UPDATES` stay exactly as they are today.)

- [ ] **Step 2: Update `allPrompts` and `renderPromptLibrary` to use server data with loading/error states**

Replace the `allPrompts` function and the top of `renderPromptLibrary`:

```js
function allPrompts(state) {
  return [...(serverPrompts || []), ...state.custom];
}

export function renderPromptLibrary(el, opts = {}) {
  const esc = opts.esc || ((s) => String(s));
  const state = loadLibrary();

  if (serverPrompts === null && !serverError) {
    ensureServerPromptsLoaded(() => renderPromptLibrary(el, opts));
    el.innerHTML = `<div class="pl"><p class="pl-empty">Loading Prompt Library…</p></div>`;
    return;
  }
  if (serverError) {
    el.innerHTML = `<div class="pl"><p class="pl-empty">Couldn't load the Prompt Library. <button class="btn btn-ghost" data-pl-retry type="button">Retry</button></p></div>`;
    el.querySelector("[data-pl-retry]")?.addEventListener("click", () => {
      serverError = false;
      renderPromptLibrary(el, opts);
    });
    return;
  }

  const prompts = allPrompts(state).filter((p) => matches(p, state));
  const update = latestUpdate();
  const counts = { all: allPrompts(state).length };
  PROMPT_CATEGORIES.forEach((c) => { counts[c.id] = allPrompts(state).filter((p) => p.cat === c.id).length; });
```

The rest of `renderPromptLibrary`'s template (from `el.innerHTML = \`` onward) is unchanged.

- [ ] **Step 3: Add editing/admin-add state, the Send button, and admin edit/delete actions to `promptCard`**

Update the module-level `pl` state object:

```js
const pl = { cat: "all", q: "", filter: "all", showAdd: false, whatsNew: false, copiedId: "", editingId: "", showAdminAdd: false };
```

In `promptCard`, add a Send action and, for admins, Edit/Delete-from-library actions (leave the existing personal `isMine`/Delete/Star behavior untouched):

```js
function promptCard(p, state, esc) {
  const isStar = state.starred.includes(p.id);
  const isMine = state.custom.some((c) => c.id === p.id);
  const catDef = PROMPT_CATEGORIES.find((c) => c.id === p.cat);
  const canSendToMedia = p.cat === "image" || p.cat === "video";
  const canAdminEdit = isAdmin() && !isMine;

  if (canAdminEdit && pl.editingId === p.id) {
    return adminEditForm(p, esc);
  }

  return `
    <article class="pl-card" data-pl-card="${p.id}">
      <div class="pl-card-top">
        <span class="pl-card-cat">${svgIc(catDef?.icon || "spark")} ${esc(catDef?.label || p.cat)}</span>
        <button class="pl-star ${isStar ? "is-on" : ""}" data-pl-star="${p.id}" title="${isStar ? "Unsave" : "Save"}" type="button">${svgIc(isStar ? "starFilled" : "star")}</button>
      </div>
      <h4>${esc(p.title)}</h4>
      ${p.platform ? `<p class="pl-card-platform">${esc(p.platform)}</p>` : ""}
      <p class="pl-card-prompt">${esc(p.prompt)}</p>
      <div class="pl-card-actions">
        <button class="pl-action" data-pl-copy="${p.id}" type="button">${svgIc("copy")} ${pl.copiedId === p.id ? "Copied" : "Copy"}</button>
        <button class="pl-action" data-pl-send="${p.id}" type="button">${svgIc("arrow")} Send</button>
        ${canSendToMedia ? `<button class="pl-action" data-pl-use="${p.id}" type="button">${svgIc("arrow")} Use in Media Lab</button>` : ""}
        ${isMine ? `<button class="pl-action pl-action-danger" data-pl-delete="${p.id}" type="button">${svgIc("trash")} Delete</button>` : ""}
        ${canAdminEdit ? `<button class="pl-action" data-pl-admin-edit="${p.id}" type="button">Edit</button>` : ""}
        ${canAdminEdit ? `<button class="pl-action pl-action-danger" data-pl-admin-delete="${p.id}" type="button">${svgIc("trash")} Delete from library</button>` : ""}
      </div>
    </article>`;
}
```

- [ ] **Step 4: Render the inline admin edit form and the admin "Add to Prompt Library" form**

Add these two new render functions (near `promptCard`):

```js
function adminEditForm(p, esc) {
  return `
    <article class="pl-card pl-card-editing" data-pl-card="${p.id}">
      <form class="pl-admin-edit-form" data-pl-admin-edit-form="${p.id}">
        <div class="pl-add-row">
          <input type="text" data-pl-admin-edit-title value="${esc(p.title)}" required />
          <select data-pl-admin-edit-cat>${PROMPT_CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === p.cat ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select>
        </div>
        <input type="text" data-pl-admin-edit-platform value="${esc(p.platform || "")}" placeholder="Platform (optional)" />
        <textarea data-pl-admin-edit-prompt rows="3" required>${esc(p.prompt)}</textarea>
        <input type="text" data-pl-admin-edit-tags value="${esc((p.tags || []).join(", "))}" placeholder="Tags, comma separated (optional)" />
        <div class="pl-add-actions">
          <button type="button" class="btn btn-ghost" data-pl-admin-edit-cancel>Cancel</button>
          <button type="submit" class="btn btn-primary">Save changes</button>
        </div>
      </form>
    </article>`;
}

function adminAddForm(esc) {
  return `
    <form class="pl-admin-edit-form" data-pl-admin-add-form>
      <div class="pl-add-row">
        <input type="text" data-pl-admin-add-title placeholder="Title" required />
        <select data-pl-admin-add-cat>${PROMPT_CATEGORIES.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("")}</select>
      </div>
      <input type="text" data-pl-admin-add-platform placeholder="Platform (optional)" />
      <textarea data-pl-admin-add-prompt rows="3" placeholder="The full prompt text…" required></textarea>
      <input type="text" data-pl-admin-add-tags placeholder="Tags, comma separated (optional)" />
      <div class="pl-add-actions">
        <button type="button" class="btn btn-ghost" data-pl-admin-add-cancel>Cancel</button>
        <button type="submit" class="btn btn-primary">${svgIc("plus")} Add to library</button>
      </div>
    </form>`;
}
```

In the `pl-toolbar` section of `renderPromptLibrary`'s template, add an admin-only button next to the existing "Add prompt" button:

```js
        ${isAdmin() ? `<button class="btn btn-ghost pl-add-btn" data-pl-admin-add-open type="button">${svgIc("plus")} Add to library</button>` : ""}
```

And immediately after the existing `${pl.showAdd ? ... }` form block in that same template, add:

```js
      ${isAdmin() && pl.showAdminAdd ? adminAddForm(esc) : ""}
```

- [ ] **Step 5: Wire the Send, admin edit/delete, edit-form, and admin-add-form handlers in `wirePromptLibrary`**

Add alongside the existing `data-pl-use` handler:

```js
  el.querySelectorAll("[data-pl-send]").forEach((b) => b.onclick = () => {
    const id = b.dataset.plSend;
    const p = allPrompts(state).find((x) => x.id === id);
    if (!p) return;
    try { workspaceStorageSetItem(CHAT_INTENT_KEY, JSON.stringify({ prompt: p.prompt, autoSend: true, at: p.id })); } catch {}
    opts.notify?.("Prompt Library", `Sent "${p.title}" to Phantom AI.`);
    opts.openWorkspace?.("phantomai");
  });

  el.querySelectorAll("[data-pl-admin-delete]").forEach((b) => b.onclick = async () => {
    const id = b.dataset.plAdminDelete;
    if (!confirm("Delete this prompt from the shared library for every user? This can't be undone.")) return;
    try {
      const data = await api(`/prompt-library/${encodeURIComponent(id)}`, { method: "DELETE" });
      serverPrompts = data.document.prompts;
      opts.notify?.("Prompt Library", "Deleted from the shared library.");
      rerender();
    } catch (error) {
      opts.notify?.("Prompt Library", error.message || "Delete failed.");
    }
  });

  el.querySelectorAll("[data-pl-admin-edit]").forEach((b) => b.onclick = () => {
    pl.editingId = b.dataset.plAdminEdit;
    rerender();
  });

  el.querySelectorAll("[data-pl-admin-edit-cancel]").forEach((b) => b.onclick = () => {
    pl.editingId = "";
    rerender();
  });

  el.querySelectorAll("[data-pl-admin-edit-form]").forEach((form) => form.onsubmit = async (e) => {
    e.preventDefault();
    const id = form.dataset.plAdminEditForm;
    const title = form.querySelector("[data-pl-admin-edit-title]").value.trim();
    const cat = form.querySelector("[data-pl-admin-edit-cat]").value;
    const platform = form.querySelector("[data-pl-admin-edit-platform]").value.trim();
    const prompt = form.querySelector("[data-pl-admin-edit-prompt]").value.trim();
    const tags = form.querySelector("[data-pl-admin-edit-tags]").value.split(",").map((t) => t.trim()).filter(Boolean);
    if (!title || !prompt) return;
    try {
      const data = await api(`/prompt-library/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ title, cat, platform, prompt, tags }),
      });
      serverPrompts = data.document.prompts;
      pl.editingId = "";
      opts.notify?.("Prompt Library", `Saved changes to "${title}".`);
      rerender();
    } catch (error) {
      opts.notify?.("Prompt Library", error.message || "Save failed.");
    }
  });

  el.querySelector("[data-pl-admin-add-open]")?.addEventListener("click", () => { pl.showAdminAdd = true; rerender(); });
  el.querySelector("[data-pl-admin-add-cancel]")?.addEventListener("click", () => { pl.showAdminAdd = false; rerender(); });

  const adminAddFormEl = el.querySelector("[data-pl-admin-add-form]");
  if (adminAddFormEl) adminAddFormEl.onsubmit = async (e) => {
    e.preventDefault();
    const title = adminAddFormEl.querySelector("[data-pl-admin-add-title]").value.trim();
    const cat = adminAddFormEl.querySelector("[data-pl-admin-add-cat]").value;
    const platform = adminAddFormEl.querySelector("[data-pl-admin-add-platform]").value.trim();
    const prompt = adminAddFormEl.querySelector("[data-pl-admin-add-prompt]").value.trim();
    const tags = adminAddFormEl.querySelector("[data-pl-admin-add-tags]").value.split(",").map((t) => t.trim()).filter(Boolean);
    if (!title || !prompt) return;
    try {
      const data = await api("/prompt-library", { method: "POST", body: JSON.stringify({ title, cat, platform, prompt, tags }) });
      serverPrompts = data.document.prompts;
      pl.showAdminAdd = false;
      opts.notify?.("Prompt Library", `Added "${title}" to the shared library.`);
      rerender();
    } catch (error) {
      opts.notify?.("Prompt Library", error.message || "Add failed.");
    }
  };
```

- [ ] **Step 6: Manual verification**

Start the dev server per this repo's usual local run (the two static/API ports noted in project memory: `127.0.0.1:5177` static, `127.0.0.1:5190` API). In a browser:
1. Open the Prompt Library card — confirm it shows a brief "Loading…" state then the 26 prompts (proves the `GET /prompt-library` round-trip works, replacing the old hardcoded render).
2. Click **Send** on any prompt — confirm it navigates to the Phantom AI workspace (this will only fully work once Task 4 is done; until then, expect the navigation to happen but the chat input to NOT auto-fill/auto-send yet — note this and continue, Task 4 completes the loop).
3. As an admin session: confirm "Add to library" appears in the toolbar and, on submit, a new card appears immediately; confirm **Edit** on an existing card shows the inline form pre-filled with its current values and Save updates the card; confirm **Delete from library** shows a confirm dialog and removes the card on confirm.
4. As a non-admin session, confirm "Add to library", Edit, and "Delete from library" do NOT appear anywhere (only Copy/Send/Use in Media Lab/Save/the existing personal Add-prompt flow).

- [ ] **Step 7: Ship**

```bash
cd C:\Users\jorda\Documents\Codex\deployments\phantomforce-live
npm run ship:live-admin -- --commit "Prompt Library: fetch from server, add Send-to-Phantom-AI and admin edit/delete"
```

Expected: `LIVE ADMIN SHIP PASSED`.

---

## Task 4: Frontend — `phantomai.js` consumes the chat intent and auto-sends

**Files:**
- Modify: `app/js/phantomai.js`

**Interfaces:**
- Consumes: `pf.phantomai.chatIntent.v1` written by Task 3; `workspaceStorageGetItem`/`workspaceStorageRemoveItem` (need to add these to `phantomai.js`'s existing `store.js` import, which currently only imports `isOwnerOperator, rememberConversation`).

- [ ] **Step 1: Add the storage import and intent key**

In `app/js/phantomai.js`, change:

```js
import { isOwnerOperator, rememberConversation } from "./store.js?v=phantom-live-20260719-68";
```

to:

```js
import { isOwnerOperator, rememberConversation, workspaceStorageGetItem, workspaceStorageRemoveItem } from "./store.js?v=phantom-live-20260719-68";
```

And add, near the top-level consts (after `const chatHistory = [];`):

```js
const CHAT_INTENT_KEY = "pf.phantomai.chatIntent.v1";
```

- [ ] **Step 2: Add `consumeChatIntent`, called after the chat tab is mounted**

Add this new function after `mountChatTab` (before `mountMemoryTab`):

```js
function consumeChatIntent() {
  let intent = null;
  try { intent = JSON.parse(workspaceStorageGetItem(CHAT_INTENT_KEY) || "null"); } catch {}
  if (!intent || !intent.prompt) return;
  try { workspaceStorageRemoveItem(CHAT_INTENT_KEY); } catch {}
  const mount = pane("chat")?.querySelector("[data-phantomai-chat-mount]");
  const form = mount?.querySelector("[data-phantomai-chat-form]");
  const input = mount?.querySelector("[data-phantomai-chat-input]");
  if (!form || !input) return;
  input.value = intent.prompt;
  if (intent.autoSend) form.requestSubmit();
}
```

- [ ] **Step 3: Call it whenever the chat tab activates**

In `activatePhantomAiTab`, change:

```js
  if (tab === "chat") mountChatTab();
```

to:

```js
  if (tab === "chat") { mountChatTab(); consumeChatIntent(); }
```

- [ ] **Step 4: Ensure the chat tab is active on a fresh Phantom AI mount**

Find the end of `mountPhantomAI` (after the `memoryTabBtn` block already read at line 148-150) and confirm it calls `activatePhantomAiTab("chat")` (or whatever its existing default-tab logic is) — if it already does, no change needed here since Step 3's edit means that call now also triggers `consumeChatIntent()`. If `mountPhantomAI` does NOT already activate a default tab (verify by reading the rest of the function beyond line 150 before editing), add `activatePhantomAiTab("chat");` at the end of `mountPhantomAI`, matching the tab-activation calling convention already used elsewhere in that function.

- [ ] **Step 5: Manual verification (completes Task 3's loop)**

With the dev server running:
1. Go to Prompt Library, click **Send** on a caption or hook prompt.
2. Confirm the page navigates to Phantom AI, the chat tab is active, the input auto-fills with the prompt text, the form auto-submits, and a reply appears in the chat log exactly as if it had been typed and sent manually.
3. Confirm the guard still applies: manually type an obvious injection-style test string (e.g. one already used in the guard's own test suite) directly into chat and confirm it's still blocked — proving Send didn't bypass `screenText`.
4. Repeat the Send flow with the Phantom AI tab already open on "memory" or "activity" — confirm it switches to "chat" and still auto-sends.

- [ ] **Step 6: Ship**

```bash
cd C:\Users\jorda\Documents\Codex\deployments\phantomforce-live
npm run ship:live-admin -- --commit "Phantom AI: consume Prompt Library Send intent and auto-submit"
```

Expected: `LIVE ADMIN SHIP PASSED`.

---

## Explicitly out of scope (queued separately, per the approved spec)

Per-tenant libraries, user-submitted prompts, `{{variable}}` templating, the Automations-integrated scraping module, the local chat UI overhaul, the agent-orchestration audit, and the consent-gated synthetic-media (face-swap) feature are all queued as future specs, not part of this plan.

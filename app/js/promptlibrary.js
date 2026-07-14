/* PhantomForce — Prompt Library: a curated, monthly-refreshed set of real
   working prompts for image, video, captions, ad copy, and content hooks,
   plus a place to save your own for quick reuse. Pure local data — nothing
   here is generated or faked; the curated set is written and refreshed by
   the PhantomForce team, and "Use in Media Lab" only ever hands a prompt
   string to the Shot Builder, never runs anything on its own. */

import { workspaceStorageGetItem, workspaceStorageSetItem } from "./store.js?v=phantom-live-20260714-253";

const LIB_KEY = "pf.promptlibrary.v1";
const MEDIA_INTENT_KEY = "pf.medialab.promptIntent.v1";

export const PROMPT_CATEGORIES = [
  { id: "image", label: "Image", icon: "image" },
  { id: "video", label: "Video", icon: "film" },
  { id: "caption", label: "Captions & posts", icon: "chat" },
  { id: "ad", label: "Ad & sales copy", icon: "spark" },
  { id: "hook", label: "Hooks & ideas", icon: "bolt" },
];

/* One entry per monthly refresh. Add a new entry (and new prompts tagged
   with that month) each month — never remove old ones, just append. */
export const LIBRARY_UPDATES = [
  { month: "2026-07", label: "July 2026", note: "Initial launch — 26 prompts across image, video, captions, ad copy, and hooks." },
];

export const PROMPT_SEED = [
  // ---- Image ----
  { id: "img-editorial-portrait", cat: "image", title: "Editorial portrait, natural light", platform: "Midjourney / Nano Banana",
    prompt: "Portrait of a [subject], standing near a large window with soft diffused natural light, shallow depth of field, shot on an 85mm portrait lens at f/1.8, subtle skin texture, natural color grading, editorial magazine quality --ar 2:3",
    tags: ["portrait", "realistic", "editorial"], addedMonth: "2026-07" },
  { id: "img-studio-product", cat: "image", title: "Clean studio product shot", platform: "Midjourney / Nano Banana",
    prompt: "Studio product photo of [product] on a seamless [color] background, soft box lighting from both sides, subtle reflection below, no shadows on backdrop, sharp focus on label details, commercial e-commerce quality --ar 1:1",
    tags: ["product", "e-commerce", "studio"], addedMonth: "2026-07" },
  { id: "img-concept-character", cat: "image", title: "Cinematic character concept art", platform: "Midjourney",
    prompt: "Concept art of [character description] in a [setting], dramatic rim lighting, painterly digital brushwork, muted color palette with one accent color, cinematic composition, in the style of a AAA game key art --ar 16:9",
    tags: ["concept-art", "character", "cinematic"], addedMonth: "2026-07" },
  { id: "img-lifestyle-brand", cat: "image", title: "Moody lifestyle brand photo", platform: "Midjourney / Nano Banana",
    prompt: "Lifestyle photo of a person using [product] in a [setting], candid unposed moment, warm golden hour light, shot on 35mm film, slight grain, shallow depth of field, aspirational but authentic mood --ar 4:5",
    tags: ["lifestyle", "brand", "social"], addedMonth: "2026-07" },
  { id: "img-vector-icon", cat: "image", title: "Isometric vector app icon", platform: "Midjourney",
    prompt: "Isometric vector icon of [object/concept], flat design, bold clean shapes, two-tone color palette, soft drop shadow, centered on a plain background, app icon style --ar 1:1",
    tags: ["icon", "vector", "flat-design"], addedMonth: "2026-07" },
  { id: "img-golden-architecture", cat: "image", title: "Golden hour architecture", platform: "Midjourney / Nano Banana",
    prompt: "Modernist building exterior at golden hour, low sun angle casting long shadows, glass and concrete textures, wide angle architectural photography, dramatic sky, ultra sharp, shot on a tilt-shift lens --ar 16:9",
    tags: ["architecture", "golden-hour"], addedMonth: "2026-07" },

  // ---- Video ----
  { id: "vid-aerial-reveal", cat: "video", title: "Sweeping aerial reveal", platform: "Sora / Veo / Kling",
    prompt: "A sweeping aerial shot over a misty mountain range at golden hour, the camera slowly pushing forward and revealing a hidden valley with a winding river below, volumetric fog, warm sunlight filtering through clouds, 4K cinematic, shallow depth of field at the edges of frame.",
    tags: ["aerial", "establishing-shot", "nature"], addedMonth: "2026-07" },
  { id: "vid-tracking-forest", cat: "video", title: "Low tracking shot through nature", platform: "Sora / Veo / Kling",
    prompt: "A low-angle tracking shot through a dense bamboo forest, the camera gliding smoothly at waist height, dappled sunlight breaking through the canopy, a gentle breeze causing slight movement in the leaves, green and gold color palette, subtle anamorphic lens flare.",
    tags: ["tracking-shot", "nature", "cinematic"], addedMonth: "2026-07" },
  { id: "vid-closeup-narrative", cat: "video", title: "Narrative extreme close-up", platform: "Sora / Veo",
    prompt: "An extreme close-up of [a person], deep in thought, sitting at a café table in [a city], golden light and street life blurred in the background, cinematic 35mm film look, shallow depth of field, the camera holds still as their expression slowly shifts from worry to resolve.",
    tags: ["narrative", "close-up", "emotional"], addedMonth: "2026-07" },
  { id: "vid-product-hero", cat: "video", title: "Product hero reveal", platform: "Sora / Veo / Kling",
    prompt: "A hero product shot of [product] rotating slowly on a reflective dark surface, dramatic studio lighting sweeping across its surface, subtle dust particles catching the light, the camera pushes in as the product comes into full focus, commercial-grade render quality.",
    tags: ["product", "commercial", "reveal"], addedMonth: "2026-07" },
  { id: "vid-ugc-hook", cat: "video", title: "UGC-style talking opener", platform: "Sora / Veo / Runway",
    prompt: "A handheld selfie-style shot of a person talking directly to camera in [a casual setting], natural phone-camera framing, authentic unpolished lighting, energetic delivery, the first line is a bold claim delivered straight to the lens before the shot cuts.",
    tags: ["ugc", "talking-head", "hook"], addedMonth: "2026-07" },
  { id: "vid-day-in-life", cat: "video", title: "Day-in-the-life montage", platform: "Sora / Veo / Kling",
    prompt: "A fast-paced montage of [a person]'s morning routine — waking up, making coffee, opening a laptop, stepping outside — each clip 2-3 seconds, quick match cuts on movement, warm natural lighting throughout, upbeat rhythmic pacing, consistent color grade across all shots.",
    tags: ["montage", "lifestyle", "social"], addedMonth: "2026-07" },

  // ---- Captions & posts ----
  { id: "cap-instagram-hook", cat: "caption", title: "Instagram caption with a hook", platform: "Instagram",
    prompt: "Write a playful Instagram caption for [brand/topic], under 100 words, opening with a scroll-stopping first line, one clear takeaway in the middle, and a soft call-to-action at the end. Tone: [describe brand voice].",
    tags: ["instagram", "caption"], addedMonth: "2026-07" },
  { id: "cap-linkedin-leadership", cat: "caption", title: "LinkedIn thought-leadership post", platform: "LinkedIn",
    prompt: "Write a LinkedIn post (150-250 words) sharing one specific lesson from [experience/result]. Open with a one-line hook, tell the story in 2-3 short paragraphs, and close with a takeaway the reader can apply today. Confident, no fluff, no hashtags spam.",
    tags: ["linkedin", "thought-leadership"], addedMonth: "2026-07" },
  { id: "cap-tiktok-script", cat: "caption", title: "20-second TikTok spoken script", platform: "TikTok",
    prompt: "Write a 20-second spoken script for a TikTok about [topic]. Structure: a 3-word hook on screen, a 1-sentence problem, a quick demonstration or reveal, and a punchy last line that invites a comment. Casual, fast-paced, no corporate tone.",
    tags: ["tiktok", "script", "short-form"], addedMonth: "2026-07" },
  { id: "cap-x-post", cat: "caption", title: "Single punchy X post", platform: "X",
    prompt: "Write one X post under 280 characters about [topic]. It should make a single sharp point, use plain language, no hashtags, and end with something quotable or a light contrarian angle worth replying to.",
    tags: ["x", "twitter", "short-form"], addedMonth: "2026-07" },
  { id: "cap-before-after", cat: "caption", title: "Before/after transformation post", platform: "Instagram / TikTok / X",
    prompt: "Write a before/after post about [customer or product result]. Format: one-line hook, the 'before' situation in one sentence, the 'after' result in one sentence, and a single-line call-to-action. Keep every line short enough to read in under 3 seconds.",
    tags: ["transformation", "social-proof"], addedMonth: "2026-07" },
  { id: "cap-behind-scenes", cat: "caption", title: "Behind-the-scenes authenticity post", platform: "Instagram / TikTok",
    prompt: "Write a behind-the-scenes caption showing the real, unpolished process behind [product/result]. Conversational first-person tone, one honest detail most brands wouldn't share, ending on a question that invites replies.",
    tags: ["behind-the-scenes", "authenticity"], addedMonth: "2026-07" },

  // ---- Ad & sales copy ----
  { id: "ad-direct-response", cat: "ad", title: "Direct-response ad headline + body", platform: "Meta / Google Ads",
    prompt: "Write 3 direct-response ad variations for [product/offer] targeting [audience]. Each variation: one headline under 8 words leading with the biggest benefit, 2 short body lines addressing the main objection, and one clear call-to-action.",
    tags: ["ad-copy", "direct-response"], addedMonth: "2026-07" },
  { id: "ad-email-subject", cat: "ad", title: "Email subject line + preview set", platform: "Email",
    prompt: "Write 5 email subject lines (under 45 characters) and matching preview text (under 90 characters) for an email about [offer/topic]. Vary the angle across curiosity, urgency, benefit, and social proof.",
    tags: ["email", "subject-lines"], addedMonth: "2026-07" },
  { id: "ad-landing-hero", cat: "ad", title: "Landing page hero copy", platform: "Website",
    prompt: "Write landing page hero copy for [product]: a headline under 10 words stating the core outcome, a one-sentence subheadline explaining how it works, and a single primary button label. Speak to [audience] and their main pain point directly.",
    tags: ["landing-page", "hero-copy"], addedMonth: "2026-07" },
  { id: "ad-retarget-short", cat: "ad", title: "Retargeting ad short copy", platform: "Meta / Google Ads",
    prompt: "Write short retargeting ad copy (under 20 words) for someone who viewed [product] but didn't buy. Address the likely hesitation directly and offer one specific reason to come back now.",
    tags: ["retargeting", "ad-copy"], addedMonth: "2026-07" },

  // ---- Hooks & ideas ----
  { id: "hook-pattern-interrupt", cat: "hook", title: "Pattern-interrupt opening lines", platform: "Any platform",
    prompt: "Give me 10 pattern-interrupt opening lines for a video or post about [topic] — each one should make someone stop scrolling in the first 2 seconds by contradicting an assumption, asking an odd question, or stating a surprising number.",
    tags: ["hooks", "brainstorm"], addedMonth: "2026-07" },
  { id: "hook-trendjack", cat: "hook", title: "Trend-jacking angle finder", platform: "Any platform",
    prompt: "Here's a trend/format: [describe the trend]. Give me 5 ways [brand/topic] could authentically show up in this trend without forcing it, ranked from safest to boldest.",
    tags: ["trends", "brainstorm"], addedMonth: "2026-07" },
  { id: "hook-weekly-batch", cat: "hook", title: "Weekly content idea batch", platform: "Any platform",
    prompt: "Give me 7 content ideas for [brand/topic] for this week — one per day, each a different format (educational, behind-the-scenes, testimonial, trend, question, list, story) so the week feels varied, not repetitive.",
    tags: ["content-calendar", "brainstorm"], addedMonth: "2026-07" },
  { id: "hook-3act-story", cat: "hook", title: "3-act story hook", platform: "Any platform",
    prompt: "Turn this result into a 3-act story hook for [topic]: Act 1 — the problem/frustration in one line, Act 2 — the turning point or attempt, Act 3 — the outcome, ending on a line that invites the reader to ask 'how'.",
    tags: ["storytelling", "hooks"], addedMonth: "2026-07" },
];

function loadLibrary() {
  let saved = null;
  try { saved = JSON.parse(workspaceStorageGetItem(LIB_KEY) || "null"); } catch {}
  return {
    custom: Array.isArray(saved?.custom) ? saved.custom : [],
    starred: Array.isArray(saved?.starred) ? saved.starred : [],
    ...saved,
  };
}
function saveLibrary(state) {
  try { workspaceStorageSetItem(LIB_KEY, JSON.stringify(state)); } catch {}
}

function svgIc(k) {
  const P = {
    image: `<rect x="1.5" y="2.5" width="13" height="11" rx="1.4"/><circle cx="5.4" cy="6.2" r="1.3"/><path d="M2 12l4-4 2.5 2.5L12 7l2 2"/>`,
    film: `<rect x="1.5" y="3" width="13" height="10" rx="1.2"/><path d="M1.5 6h13M1.5 10h13M5 3v3M5 10v3M11 3v3M11 10v3"/>`,
    chat: `<path d="M2 3h12v8H7l-3 3v-3H2z"/>`,
    spark: `<path d="M8 1.5l1.4 4.1 4.1 1.4-4.1 1.4L8 12.5l-1.4-4.1-4.1-1.4 4.1-1.4z"/>`,
    bolt: `<path d="M8.5 1.5L3 9h4l-1 5.5L13 7H9z"/>`,
    search: `<circle cx="7" cy="7" r="4.5"/><path d="M10.3 10.3L14 14"/>`,
    star: `<path d="M8 1.8l1.8 3.9 4.2.5-3.1 3 .8 4.3L8 11.4 4.3 13.5l.8-4.3-3.1-3 4.2-.5z"/>`,
    starFilled: `<path d="M8 1.8l1.8 3.9 4.2.5-3.1 3 .8 4.3L8 11.4 4.3 13.5l.8-4.3-3.1-3 4.2-.5z" fill="currentColor"/>`,
    copy: `<rect x="5.5" y="5.5" width="8" height="9" rx="1"/><path d="M3.5 10.5V2.5h8"/>`,
    plus: `<path d="M8 3v10M3 8h10"/>`,
    trash: `<path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8.6a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.6"/>`,
    arrow: `<path d="M3 8h9M8.5 4.5L12 8l-3.5 3.5"/>`,
    check: `<path d="M3 8.5l3 3 7-7"/>`,
    close: `<path d="M4 4l8 8M12 4l-8 8"/>`,
  };
  return `<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k] || ""}</svg>`;
}

const pl = { cat: "all", q: "", filter: "all", showAdd: false, whatsNew: false, copiedId: "" };

function allPrompts(state) {
  return [...PROMPT_SEED, ...state.custom];
}
function matches(p, state) {
  if (pl.cat !== "all" && p.cat !== pl.cat) return false;
  if (pl.filter === "starred" && !state.starred.includes(p.id)) return false;
  if (pl.filter === "mine" && !state.custom.some((c) => c.id === p.id)) return false;
  if (pl.q) {
    const hay = `${p.title} ${p.prompt} ${(p.tags || []).join(" ")} ${p.platform || ""}`.toLowerCase();
    if (!hay.includes(pl.q.toLowerCase())) return false;
  }
  return true;
}
function latestUpdate() {
  return LIBRARY_UPDATES[LIBRARY_UPDATES.length - 1];
}

export function renderPromptLibrary(el, opts = {}) {
  const esc = opts.esc || ((s) => String(s));
  const state = loadLibrary();
  const prompts = allPrompts(state).filter((p) => matches(p, state));
  const update = latestUpdate();
  const counts = { all: allPrompts(state).length };
  PROMPT_CATEGORIES.forEach((c) => { counts[c.id] = allPrompts(state).filter((p) => p.cat === c.id).length; });

  el.innerHTML = `
    <div class="pl">
      <section class="pl-head">
        <div>
          <p class="pl-eyebrow">Prompt Library</p>
          <h3>Ready-to-use prompts, saved for quick reuse.</h3>
          <p class="pl-sub">Curated across image, video, captions, ad copy, and content hooks — refreshed monthly. <b>Updated ${esc(update.label)}.</b></p>
        </div>
        <button class="pl-whats-new" data-pl-whats-new type="button">${svgIc("spark")} What's new ${pl.whatsNew ? svgIc("close") : svgIc("arrow")}</button>
      </section>
      ${pl.whatsNew ? `
      <section class="pl-updates">
        ${LIBRARY_UPDATES.slice().reverse().map((u) => `<div class="pl-update-row"><b>${esc(u.label)}</b><span>${esc(u.note)}</span></div>`).join("")}
      </section>` : ""}

      <section class="pl-toolbar">
        <div class="pl-search"><span>${svgIc("search")}</span><input type="text" data-pl-search placeholder="Search prompts, tags, platforms…" value="${esc(pl.q)}" /></div>
        <div class="pl-filters">
          <button class="pl-filter ${pl.filter === "all" ? "is-on" : ""}" data-pl-filter="all" type="button">All</button>
          <button class="pl-filter ${pl.filter === "starred" ? "is-on" : ""}" data-pl-filter="starred" type="button">${svgIc("star")} Saved</button>
          <button class="pl-filter ${pl.filter === "mine" ? "is-on" : ""}" data-pl-filter="mine" type="button">Mine</button>
        </div>
        <button class="btn btn-primary pl-add-btn" data-pl-add-open type="button">${svgIc("plus")} Add prompt</button>
      </section>

      <nav class="pl-cats" role="tablist" aria-label="Prompt categories">
        <button class="pl-cat ${pl.cat === "all" ? "is-on" : ""}" data-pl-cat="all" type="button">All <i>${counts.all}</i></button>
        ${PROMPT_CATEGORIES.map((c) => `<button class="pl-cat ${pl.cat === c.id ? "is-on" : ""}" data-pl-cat="${c.id}" type="button">${svgIc(c.icon)} ${esc(c.label)} <i>${counts[c.id] || 0}</i></button>`).join("")}
      </nav>

      ${pl.showAdd ? `
      <form class="pl-add-form" data-pl-add-form>
        <div class="pl-add-row">
          <input type="text" data-pl-add-title placeholder="Title" required />
          <select data-pl-add-cat>${PROMPT_CATEGORIES.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("")}</select>
        </div>
        <textarea data-pl-add-prompt rows="3" placeholder="The full prompt text…" required></textarea>
        <input type="text" data-pl-add-tags placeholder="Tags, comma separated (optional)" />
        <div class="pl-add-actions">
          <button type="button" class="btn btn-ghost" data-pl-add-cancel>Cancel</button>
          <button type="submit" class="btn btn-primary">${svgIc("plus")} Save prompt</button>
        </div>
      </form>` : ""}

      <div class="pl-grid">
        ${prompts.length ? prompts.map((p) => promptCard(p, state, esc)).join("") : `<p class="pl-empty">No prompts match — try a different search or category.</p>`}
      </div>
    </div>`;

  wirePromptLibrary(el, state, opts);
}

function promptCard(p, state, esc) {
  const isStar = state.starred.includes(p.id);
  const isMine = state.custom.some((c) => c.id === p.id);
  const catDef = PROMPT_CATEGORIES.find((c) => c.id === p.cat);
  const canSendToMedia = p.cat === "image" || p.cat === "video";
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
        ${canSendToMedia ? `<button class="pl-action" data-pl-use="${p.id}" type="button">${svgIc("arrow")} Use in Media Lab</button>` : ""}
        ${isMine ? `<button class="pl-action pl-action-danger" data-pl-delete="${p.id}" type="button">${svgIc("trash")} Delete</button>` : ""}
      </div>
    </article>`;
}

function wirePromptLibrary(el, state, opts) {
  const rerender = () => renderPromptLibrary(el, opts);

  el.querySelector("[data-pl-whats-new]")?.addEventListener("click", () => { pl.whatsNew = !pl.whatsNew; rerender(); });

  const search = el.querySelector("[data-pl-search]");
  if (search) {
    search.oninput = () => { pl.q = search.value; };
    search.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); rerender(); } };
    search.onblur = () => rerender();
  }

  el.querySelectorAll("[data-pl-filter]").forEach((b) => b.onclick = () => { pl.filter = b.dataset.plFilter; rerender(); });
  el.querySelectorAll("[data-pl-cat]").forEach((b) => b.onclick = () => { pl.cat = b.dataset.plCat; rerender(); });

  el.querySelector("[data-pl-add-open]")?.addEventListener("click", () => { pl.showAdd = true; rerender(); });
  el.querySelector("[data-pl-add-cancel]")?.addEventListener("click", () => { pl.showAdd = false; rerender(); });
  const addForm = el.querySelector("[data-pl-add-form]");
  if (addForm) addForm.onsubmit = (e) => {
    e.preventDefault();
    const title = addForm.querySelector("[data-pl-add-title]").value.trim();
    const cat = addForm.querySelector("[data-pl-add-cat]").value;
    const prompt = addForm.querySelector("[data-pl-add-prompt]").value.trim();
    const tags = addForm.querySelector("[data-pl-add-tags]").value.split(",").map((t) => t.trim()).filter(Boolean);
    if (!title || !prompt) return;
    const id = `custom-${Date.now()}`;
    state.custom = [{ id, cat, title, prompt, tags, platform: "Your prompt", addedMonth: latestUpdate().month, custom: true }, ...state.custom];
    pl.showAdd = false;
    saveLibrary(state);
    opts.notify?.("Prompt Library", `Saved "${title}" to your prompts.`);
    rerender();
  };

  el.querySelectorAll("[data-pl-star]").forEach((b) => b.onclick = () => {
    const id = b.dataset.plStar;
    state.starred = state.starred.includes(id) ? state.starred.filter((x) => x !== id) : [...state.starred, id];
    saveLibrary(state);
    rerender();
  });

  el.querySelectorAll("[data-pl-delete]").forEach((b) => b.onclick = () => {
    const id = b.dataset.plDelete;
    state.custom = state.custom.filter((c) => c.id !== id);
    state.starred = state.starred.filter((x) => x !== id);
    saveLibrary(state);
    rerender();
  });

  el.querySelectorAll("[data-pl-copy]").forEach((b) => b.onclick = async () => {
    const id = b.dataset.plCopy;
    const p = allPrompts(state).find((x) => x.id === id);
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p.prompt);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = p.prompt; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch {}
      ta.remove();
    }
    pl.copiedId = id;
    rerender();
    setTimeout(() => { if (pl.copiedId === id) { pl.copiedId = ""; rerender(); } }, 1600);
  });

  el.querySelectorAll("[data-pl-use]").forEach((b) => b.onclick = () => {
    const id = b.dataset.plUse;
    const p = allPrompts(state).find((x) => x.id === id);
    if (!p) return;
    try { workspaceStorageSetItem(MEDIA_INTENT_KEY, JSON.stringify({ prompt: p.prompt, modality: p.cat === "video" ? "video" : "image", at: p.id })); } catch {}
    opts.notify?.("Prompt Library", `Sent "${p.title}" to the Media Lab Shot Builder.`);
    opts.openWorkspace?.("media");
  });
}

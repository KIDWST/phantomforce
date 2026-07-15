/* PhantomForce — Clients AI task interface.

   Classifies a plain-language request typed against ONE client card (e.g.
   "make this client a promo reel for Instagram") and maps it to a real,
   already-existing backend action instead of leaving it as a dead text box:

     - media_job        -> a Media Lab job. This module never generates media
                            itself; it builds a draft asset record for
                            registerContentAsset() (contenthub.js, already
                            exported) so a titled, prompt-tagged placeholder
                            appears in the Content Hub library, then the
                            caller deep-links to Media Lab to actually produce
                            it.
     - content_publish  -> a publish/schedule request. This module builds an
                            approval draft for queueWorkspaceApproval()
                            (workspaces.js), the same approval-gated path
                            every other publish action in PhantomForce uses.
                            Nothing ever goes live from this module directly.
     - unsupported/empty -> no confident match; the caller should explain
                            what IS supported instead of pretending to act.

   This file only classifies and builds plain draft objects. It does not
   import contenthub.js or approvalpipeline.js itself, so it stays a pure,
   dependency-free mapping layer the Clients workspace wires up to the real
   APIs living in those other modules. */

const clean = (value = "") => String(value || "").replace(/\s+/g, " ").trim();

export const CLIENT_TASK_INTENTS = Object.freeze({
  MEDIA_JOB: "media_job",
  CONTENT_PUBLISH: "content_publish",
  UNSUPPORTED: "unsupported",
  EMPTY: "empty",
});

/* Documents every intent this interface can act on today. Rendered as
   helper text in the Clients page so the box never reads as a black hole. */
export const SUPPORTED_CLIENT_TASK_INTENTS = Object.freeze([
  {
    id: CLIENT_TASK_INTENTS.MEDIA_JOB,
    label: "Media Lab job",
    example: "Make this client a promo reel for Instagram",
    result: "Queues a titled, prompt-tagged placeholder in the Content Hub asset library (tagged to this client) and opens Media Lab so you can generate it.",
  },
  {
    id: CLIENT_TASK_INTENTS.CONTENT_PUBLISH,
    label: "Content Hub publish / schedule",
    example: "Post their new reel to Instagram and TikTok this week",
    result: "Creates an Approval Queue request for this client — nothing publishes without your sign-off, matching every other publish action in PhantomForce.",
  },
]);

const PLATFORM_PATTERNS = [
  ["instagram", /\b(instagram|\big\b|insta)\b/i],
  ["tiktok", /\b(tiktok|tik ?tok)\b/i],
  ["youtube", /\b(youtube|\byt\b|shorts?)\b/i],
  ["facebook", /\b(facebook|\bfb\b)\b/i],
  ["x", /\b(twitter|\bx\b)\b/i],
  ["linkedin", /\b(linkedin)\b/i],
  ["pinterest", /\b(pinterest|\bpin\b)\b/i],
];

const VIDEO_FORMAT = /\b(reel|video|short|clip|promo|commercial|trailer|highlight reel)\b/i;
const IMAGE_FORMAT = /\b(photo|image|graphic|flyer|poster|thumbnail|banner|cover|logo)\b/i;
const CAROUSEL_FORMAT = /\b(carousel|slideshow|slides?)\b/i;
const STORY_FORMAT = /\b(story|stories)\b/i;

const MEDIA_VERB = /\b(make|create|build|generate|produce|design|shoot|cut|whip up|put together|draft|render)\b/i;
const MEDIA_NOUN = /\b(reel|video|short|clip|promo|commercial|ad|graphic|flyer|poster|thumbnail|photo|image|banner|story|stories|cover|carousel|slideshow)\b/i;

const PUBLISH_VERB = /\b(publish|post|schedule|share|put out|drop|release|send out|queue up|queue|go live|push out)\b/i;
const PUBLISH_NOUN = /\b(post|reel|video|content|update|announcement|campaign|story|carousel|it|that|this|them)\b/i;

function detectPlatforms(text) {
  return PLATFORM_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([id]) => id);
}

function detectFormat(text) {
  if (VIDEO_FORMAT.test(text)) {
    if (/\breels?\b/i.test(text)) return "reel";
    if (/\bshorts?\b/i.test(text)) return "short";
    return "video";
  }
  if (CAROUSEL_FORMAT.test(text)) return "carousel";
  if (STORY_FORMAT.test(text)) return "story";
  if (IMAGE_FORMAT.test(text)) return "image";
  return "video";
}

/* Classifies one client-scoped task prompt. Publish/schedule phrasing is
   checked first because "post the promo reel" names both a publish verb
   and a media noun — the intent is to ship an existing/implied asset, not
   to create one. */
export function classifyClientTaskIntent(raw = "") {
  const text = clean(raw);
  if (!text) return { intent: CLIENT_TASK_INTENTS.EMPTY, confidence: 0.95, prompt: "" };
  if (PUBLISH_VERB.test(text) && (PUBLISH_NOUN.test(text) || MEDIA_NOUN.test(text))) {
    return {
      intent: CLIENT_TASK_INTENTS.CONTENT_PUBLISH,
      confidence: 0.88,
      platforms: detectPlatforms(text),
      format: detectFormat(text),
      prompt: text,
    };
  }
  if (MEDIA_VERB.test(text) && MEDIA_NOUN.test(text)) {
    return {
      intent: CLIENT_TASK_INTENTS.MEDIA_JOB,
      confidence: 0.86,
      platforms: detectPlatforms(text),
      format: detectFormat(text),
      prompt: text,
    };
  }
  return { intent: CLIENT_TASK_INTENTS.UNSUPPORTED, confidence: 0.4, prompt: text };
}

/* Draft shape accepted by contenthub.js's exported registerContentAsset().
   url stays "" on purpose: this interface hands off the JOB, it does not
   fabricate media. Content Hub already renders url-less assets as a
   graceful "preview unavailable" card (same path used for pruned/older
   assets), so this shows up as a real, visible, titled placeholder. */
export function buildClientMediaAssetDraft(lead, analysis) {
  const clientName = lead?.company || lead?.name || "Client";
  const platformNote = analysis.platforms?.length ? ` · ${analysis.platforms.join(", ")}` : "";
  return {
    type: analysis.format === "image" ? "image" : "video",
    title: `${clientName} — ${analysis.format}${platformNote}`.slice(0, 90),
    prompt: analysis.prompt,
    source: "Clients AI",
    aspect: analysis.format === "story" || analysis.format === "reel" ? "9:16" : "1:1",
    batchLabel: "Queued for Media Lab",
    url: "",
    saved: false,
  };
}

/* Draft shape accepted by workspaces.js's queueWorkspaceApproval(), the
   same approval-gated path Review Desk already uses for "queue-publish". */
export function buildClientApprovalDraft(lead, analysis) {
  const clientName = lead?.company || lead?.name || "Client";
  const platformNote = analysis.platforms?.length ? analysis.platforms.join(", ") : "the client's connected channels";
  return {
    ws: lead?.ws,
    type: "publish-client-content",
    title: `Publish for ${clientName}`,
    detail: `Requested from Clients AI: "${analysis.prompt}". Target: ${platformNote}.`,
    ref: lead?.id || "",
    requestedBy: "Clients AI",
  };
}

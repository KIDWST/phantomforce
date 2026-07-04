/* PhantomForce Phantom — the Phantom AI command engine.
   Turns plain business language into routed actions and real artifacts
   (drafts in the store), never chat-only answers when an action fits.
   Runs fully locally: no provider calls, no sends. */

import {
  store, uid, visible, currentWs, isAdmin, pushActivity, moneyView, todaysPlan,
  PACKAGES, RETAINERS, fmtMoney, statusLabel, daysUntil, executionMode,
} from "./store.js?v=phantom-admin-slash-commands-20260704-01";
import { makeImageArtifact } from "./media-image.js?v=phantom-admin-slash-commands-20260704-01";

const DAY = 86400000;
const days = (n) => new Date(Date.now() + n * DAY).toISOString();

/* Pull a subject out of phrases like "draft a proposal for Sarah's gym". */
function subjectOf(text) {
  const m = text.match(/\b(?:for|to|about|called|named)\s+(.{2,60})$/i);
  if (!m) return null;
  return m[1].replace(/[.?!]\s*$/, "").replace(/^(the|a|an)\s+/i, "").trim();
}
const title = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function cleanDriveFilename(name = "") {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
  if (!cleaned) return "phantom-note.txt";
  return /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.txt`;
}

function cleanDriveContent(content = "") {
  const cleaned = content
    .replace(/^(?:contents?|content|says?|saying|with)\s+/i, "")
    .replace(/[.?!]\s*$/g, "")
    .trim();
  return cleaned || "Draft file prepared by PhantomForce.";
}

function extractDriveFileIntent(text) {
  const s = text.toLowerCase();
  const mentionsDrive = /\b(google\s+drive|gdrive|drive)\b/.test(s);
  const action = /\b(create|make|write|save|add|put|upload|draft)\b/.test(s);
  const fileish = /\b(file|txt|text file|doc|document|note)\b/.test(s) || /\b[a-z0-9][a-z0-9_.-]{0,80}\.(txt|md|csv|json|docx?)\b/i.test(text);
  if (!mentionsDrive || !action || !fileish) return null;

  const bareFilenameMatches = [...text.matchAll(/\b([a-z0-9][a-z0-9_.-]{0,80}\.(?:txt|md|csv|json|docx?))\b/gi)];
  const filenameMatch =
    text.match(/[`'"]([^`'"]+\.(?:txt|md|csv|json|docx?))[`'"]/i) ||
    bareFilenameMatches.at(-1);
  const namedMatch = text.match(/\b(?:called|named|as)\s+[`'"]?([^`'"]{2,80}?)(?:[`'"]|\s+(?:with|that|and|in|on)\b|$)/i);
  const filename = cleanDriveFilename(filenameMatch?.[1] || namedMatch?.[1] || "phantom-note.txt");

  const quotedContent =
    text.match(/\b(?:contents?|content|says?|saying|with)\s+[`'"]([^`'"]{1,500})[`'"]/i) ||
    text.match(/\b(?:write|save|put)\s+[`'"]([^`'"]{1,500})[`'"]\s+(?:in|to|as|on)\b/i);
  const tailContent = text.match(/\b(?:contents?|content|says?|saying|with)\s+(.{1,300})$/i);
  const content = cleanDriveContent(quotedContent?.[1] || tailContent?.[1] || "");

  return { filename, content };
}

function card(kicker, name, body, actions = [], meta = "", image = null) {
  return { kicker, title: name, body, actions, meta, image };
}
const openAction = (label, ws) => ({ label, open: ws });

function readableTaskTitle(text = "") {
  const clean = text
    .replace(/\s+/g, " ")
    .replace(/[.?!]\s*$/g, "")
    .trim();
  if (!clean) return "New Phantom task";
  const trimmed = clean.length > 72 ? `${clean.slice(0, 69).trim()}...` : clean;
  return trimmed.replace(/^\w/, (c) => c.toUpperCase());
}

function inferWorkLane(text = "") {
  const s = text.toLowerCase();
  if (/security|scan|breach|malware|phish|password|protect|hack|threat|leak|risk/.test(s)) return { lane: "Protect", open: "protect" };
  if (/replace human|operator mode|control (my )?(pc|computer)|use (my )?(pc|computer)|desktop|click|type|inspect (my )?(pc|computer)|analy[sz]e (my )?(pc|computer)/.test(s)) return { lane: "Phantom Operator", open: "adminos" };
  if (/build|code|app|dashboard|automation|workflow|script|fix|implement|repo|website|web app/.test(s)) return { lane: "Builder", open: "sites" };
  if (/proposal|quote|pricing|estimate|offer/.test(s)) return { lane: "Proposal Forge", open: "proposals" };
  if (/lead|prospect|follow|crm|client|customer/.test(s)) return { lane: "Follow-Up Desk", open: "leads" };
  if (/image|photo|graphic|thumbnail|poster|flyer|visual|creative|video|reel|content|caption|shoot|media|post|youtube|instagram|facebook|tiktok/.test(s)) return { lane: "Media Lab", open: "media" };
  if (/site|website|store|shop|page|landing|checkout|product/.test(s)) return { lane: "Site & Store Studio", open: "sites" };
  if (/book|appointment|schedule|calendar|meeting|call/.test(s)) return { lane: "Bookings", open: "bookings" };
  if (/review|testimonial|stars|reputation/.test(s)) return { lane: "Review Studio", open: "reviews" };
  if (/money|revenue|invoice|payment|pipeline|cash/.test(s)) return { lane: "Money", open: "money" };
  if (/drive|doc|document|file|note|sheet|folder/.test(s)) return { lane: "Drive workspace", open: "adminos" };
  return { lane: "Phantom", open: "adminos" };
}

function createWorkItem(text) {
  const route = inferWorkLane(text);
  const item = {
    id: uid("task"),
    ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(),
    title: readableTaskTitle(text),
    request: text,
    lane: route.lane,
    open: route.open,
    status: "working",
    mode: executionMode.get(),
    source: "Phantom command",
    next: "Phantom picked the route and started the first useful internal work item.",
    createdAt: new Date().toISOString(),
  };
  store.state.tasks ||= [];
  store.state.tasks.unshift(item);
  store.state.tasks = store.state.tasks.slice(0, 80);
  pushActivity(route.lane, `started: ${item.title}.`, item.ws);
  store.save();
  return item;
}

function createOperatorWorkItem(text) {
  const item = createWorkItem(text);
  item.lane = "Phantom Operator";
  item.open = "adminos";
  item.operatorMode = true;
  item.next = "Analyze the local context, prepare the execution steps, then run through the admin operator lane when enabled.";
  store.save();
  return item;
}

/* ---------------- artifact builders ---------------- */
function createLead(subject) {
  const name = subject ? title(subject) : "New lead";
  const lead = {
    id: uid("lead"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(),
    name, company: name, source: "Phantom AI command", status: "new", value: 750,
    next: "Qualify: what do they need, by when, and what's it worth?",
    due: days(1), owner: "Lead Hunter", notes: "Captured from a command. Add details, then convert to a proposal.", proposalId: null,
  };
  store.state.leads.unshift(lead);
  pushActivity("Lead Hunter", `captured a new lead: ${name}.`, lead.ws);
  store.save();
  return lead;
}

function createProposal(subject) {
  const client = subject ? title(subject) : "New client";
  const pkg = PACKAGES[1];
  const p = {
    id: uid("prop"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(),
    client, contact: client, pkg: pkg.id, price: pkg.price, retainer: "keeper", status: "draft",
    pain: "Describe the pain in one sentence — the proposal leads with it.",
    scope: ["Site or page build scoped to the outcome", "Lead capture wired to Follow-Up Desk", "Review engine setup", "30-day post-launch watch"],
    timeline: "2 weeks build, launch week 3", updated: new Date().toISOString(),
  };
  store.state.proposals.unshift(p);
  pushActivity("Proposal Forge", `opened a ${pkg.name} draft for ${client}.`, p.ws);
  store.save();
  return p;
}

function mediaKindFromText(text = "") {
  const s = text.toLowerCase();
  if (/image|photo|graphic|thumbnail|poster|flyer|visual|ad creative|design/.test(s)) return "image";
  if (/analy[sz]e|score|review|audit/.test(s)) return "analyze";
  return "video";
}

function createMediaBrief(subject, kind = "video") {
  const t = subject ? title(subject) : "New creative";
  const isImage = kind === "image";
  const isAnalyze = kind === "analyze";
  const prompt = isImage
    ? `${t}. Premium social-ready image. Clean subject, strong lighting, sharp composition, no text baked into image.`
    : "";
  const asset = isImage ? makeImageArtifact(prompt, `${t} — image`) : null;
  const m = {
    id: uid("med"), ws: currentWs() === "phantomforce" ? "chicagoshots" : currentWs(),
    title: `${t} — ${isImage ? "image draft" : isAnalyze ? "creative analysis" : "video brief"}`,
    type: isImage ? "Generated image draft" : isAnalyze ? "Creative analysis" : "Video generation brief",
    modality: kind,
    status: isImage ? "image-ready" : "draft",
    angle: isImage
      ? "One strong visual, clean subject, clear offer, premium brand feel."
      : isAnalyze
        ? "Analyze the source, identify the strongest hook, and turn it into a better creative direction."
        : "Hook in 2 seconds, one idea, end on the offer.",
    shots: isImage
      ? ["Hero subject", "Brand color direction", "Offer-safe text zone", "Platform crop", "Thumbnail variant"]
      : isAnalyze
        ? ["Hook strength", "Pacing", "Visual clarity", "Offer clarity", "Recommended next edit"]
        : ["Opening hook shot", "Detail pass", "People / reaction", "Offer card", "Logo sting"],
    caption: isImage
      ? `${t} — draft visual prompt and caption.`
      : isAnalyze
        ? `${t} — analysis notes and next-edit direction.`
        : `${t} — draft caption. Punch it up before approval.`,
    proof: null,
    asset,
    prompt,
    generationProvider: "Media Lab",
    updated: new Date().toISOString(),
  };
  store.state.media.unshift(m);
  pushActivity("Media Factory", `${isImage ? "generated image draft" : "drafted a brief"}: ${m.title}.`, m.ws);
  store.save();
  return m;
}

function createBuildPlan(subject, text) {
  const t = subject ? title(subject) : readableTaskTitle(text);
  const item = createWorkItem(text);
  item.lane = "Builder";
  item.open = "sites";
  item.title = `${t} — build plan`;
  item.next = "Draft the structure, files, data model, UI flow, and first implementation steps.";
  item.buildPlan = {
    kind: /dashboard/.test(text.toLowerCase()) ? "dashboard" : /app|web app/.test(text.toLowerCase()) ? "app" : "website/system",
    stages: ["plan", "draft UI", "wire data", "test", "ship when approved"],
  };
  store.save();
  return item;
}

function createPageDraft(subject, kind) {
  const t = subject ? title(subject) : "New build";
  const s = {
    id: uid("site"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(),
    title: `${t} — ${kind.toLowerCase()}`, kind, status: "draft",
    sections: kind === "Store"
      ? ["Storefront hero", "Product grid", "Offer section", "Checkout — payment connector not wired yet"]
      : ["Hero with one clear promise", "Proof / reviews section", "Offer + pricing", "Call-to-action receipt lane"],
    url: null, updated: new Date().toISOString(),
  };
  store.state.sites.unshift(s);
  pushActivity("Site Builder", `drafted ${s.title}.`, s.ws);
  store.save();
  return s;
}

function createReviewRequest(subject) {
  const client = subject ? title(subject) : "Recent client";
  const r = {
    id: uid("rev"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(),
    client, status: "draft", channel: "Google",
    draft: `${client.split(" ")[0]} — loved working on this with you. If it moved the needle, a short review helps the next owner find us. Two sentences is plenty — link below.`,
    link: "review-link-ready", received: null, quote: null,
  };
  store.state.reviews.unshift(r);
  pushActivity("Review Desk", `drafted a review request for ${client}.`, r.ws);
  store.save();
  return r;
}

function createBooking(subject) {
  const client = subject ? title(subject) : "New appointment";
  const b = {
    id: uid("bk"), ws: currentWs() === "phantomforce" ? "phantomforce" : currentWs(),
    client, type: "Discovery call", when: days(2), duration: 30, status: "draft",
    copy: `${client.split(" ")[0]} — grabbing 30 minutes to walk through what this would look like. What works this week?`,
    location: "Phone",
  };
  store.state.bookings.unshift(b);
  pushActivity("Booking Coordinator", `drafted an appointment with ${client}.`, b.ws);
  store.save();
  return b;
}

/* ---------------- the router ---------------- */
export function handleCommand(raw) {
  const text = (raw || "").trim();
  const s = text.toLowerCase();
  const subject = subjectOf(text);
  const admin = isAdmin();

  if (/^(hey|hi|hello|yo|sup|gm|gn|good morning|good afternoon|good evening|what'?s up|wassup|you there|u there)[\s.!?]*$/.test(s)) {
    return {
      say: admin ? "Hey Jordan. What do you want handled?" : "Hey. What do you need?",
      cards: [],
      open: null,
      skipBrain: true,
    };
  }

  if (admin && /\b(read.?only|unleash(?:ed)?|can you change|can phantom change|what can you actually do|ability|powerful|make.*business|zero to amazing)\b/.test(s)) {
    const auto = executionMode.get() === "auto";
    return {
      say: `Phantom is in Full Effect. ${auto ? "Auto is on: safe internal workspace work can happen immediately." : "Review is on: outward or destructive work moves through the receipt lane."} Tell me the outcome and I will route it.`,
      cards: [
        card(
          "Full Effect model",
          auto ? "Auto for safe internal work" : "Review for controlled execution",
          "Plans, leads, proposals, site/store drafts, media briefs, security notes, and memory lookups stay inside Phantom. Outward-facing moves use the right execution path with receipts.",
          [
            openAction("Open Control", "adminos"),
            openAction("Open Review", "approvals"),
          ],
          "PhantomOps · memory · connectors",
        ),
        card(
          "Try it",
          "Tell Phantom an outcome",
          "Example: build a launch plan for a new plumbing company, draft the offer, create the site outline, set the follow-up workflow, and stage the approval cards.",
          [],
          "One command → artifacts → action systems",
        ),
      ],
      open: null,
      skipBrain: true,
    };
  }

  if (admin && /\b(memory|memory log|activity log|ledger|receipt|receipts|hermes|operator memory|owner memory|vault|what did you remember|show.*memory|show.*log|pull.*log)\b/.test(s)) {
    return {
      say: "Opening Control. Configure Phantom systems, memory, connectors, automations, access, and workspace boundaries here.",
      cards: [
        card(
          "Owner Memory Log",
          "Configure Phantom memory",
          "Jordan sees owner context. Client workspaces start clean and stay isolated.",
          [openAction("Open Control", "adminos")],
          executionMode.label(),
        ),
      ],
      open: "adminos",
      skipBrain: true,
    };
  }

  /* --- admin operator / "replace human" mode --- */
  if (admin && /\b(replace human|operator mode|control (my )?(pc|computer)|use (my )?(pc|computer)|desktop|click|type|inspect (my )?(pc|computer)|analy[sz]e (my )?(pc|computer)|run my computer|operate my computer)\b/.test(s)) {
    const item = createOperatorWorkItem(text);
    return {
      say: `Operator Mode is ready. I started the local work item: ${item.title}.`,
      cards: [],
      open: "adminos",
    };
  }

  /* --- admin files / Google Drive --- */
  const driveFile = extractDriveFileIntent(text);
  if (driveFile) {
    if (!admin) {
      return {
        say: "Drive file actions are admin-only. I can still draft the content here if you want it prepared for review.",
        cards: [card("Admin-only action", "Google Drive file request", "Clients never get raw Drive write controls from Phantom.", [])],
        open: null,
        skipBrain: true,
      };
    }
    const ws = currentWs() === "phantomforce" ? "phantomforce" : currentWs();
    const preview = driveFile.content.length > 180 ? `${driveFile.content.slice(0, 177)}...` : driveFile.content;
    const action = {
      id: uid("app"), ws, type: "drive-file",
      title: `Create Google Drive file: ${driveFile.filename}`,
      detail: `Prepared file contents: ${preview}`,
      ref: driveFile.filename, status: "pending", requestedBy: "Drive System", at: new Date().toISOString(),
      action: {
        provider: "google_drive",
        operation: "create_file",
        filename: driveFile.filename,
        content: driveFile.content,
        execution: "connector_required",
      },
    };
    store.state.approvals.unshift(action);
    pushActivity("Drive System", `staged ${driveFile.filename} for Google Drive approval.`, ws);
    store.save();
    return {
      say: `Prepared ${driveFile.filename}. It is waiting in Review before any Drive write.`,
      cards: [card("Drive action ready", driveFile.filename, `Contents: ${preview}`, [openAction("Open Review", "approvals")], "Drive connector required")],
      open: "approvals",
      skipBrain: true,
    };
  }

  /* --- money / pipeline --- */
  if (/pipeline|revenue|money|how much.*(made|worth|owed)|unpaid|invoice|cash/.test(s)) {
    const m = moneyView();
    return {
      say: `Pipeline is ${fmtMoney(m.pipeline)} open across ${m.open.length} proposal${m.open.length === 1 ? "" : "s"}, ${fmtMoney(m.wonValue)} won, and ${fmtMoney(m.retainerMonthly)}/mo in retainers attached.`,
      cards: [card("Money", "Pipeline snapshot",
        `${m.open.length} open · ${m.won.length} won · ${m.lost.length} lost. Highest-value open: ${m.open[0] ? `${m.open[0].client} (${fmtMoney(m.open[0].price)})` : "none"}.`,
        [openAction("Open Money", "money"), openAction("Open proposals", "proposals")])],
      open: null,
    };
  }

  /* --- proposals / quotes --- */
  if (/(proposal|quote|pricing|estimate)/.test(s)) {
    if (/(draft|build|create|make|write|new|prepare|prep)/.test(s)) {
      const p = createProposal(subject);
      return {
        say: `Proposal Forge opened a ${PACKAGES.find((x) => x.id === p.pkg).name} draft for ${p.client}. It's in the pipeline as a draft — shape the scope, then move it to send-ready.`,
        cards: [card("Proposal draft", p.client, `${fmtMoney(p.price)} · ${p.timeline}. Scope seeded with the standard Core build — edit inside the workspace.`,
          [openAction("Open in Proposal Forge", "proposals")], `Status: ${statusLabel(p.status)}`)],
        open: "proposals",
      };
    }
    return { say: "Proposal Forge is open — every quote, its status, and what it's waiting on.", cards: [], open: "proposals" };
  }

  /* --- leads / follow-up / CRM --- */
  if (/(lead|prospect|inquir|crm|follow.?up|chase)/.test(s)) {
    if (/(add|new|create|capture|save|log)/.test(s)) {
      const l = createLead(subject);
      return {
        say: `Captured. ${l.name} is in the pipeline as a new lead with Lead Hunter on qualification.`,
        cards: [card("New lead", l.name, l.next, [openAction("Open in Leads", "leads")], "Source: Phantom AI command")],
        open: "leads",
      };
    }
    const due = visible(store.state.leads).filter((l) => ["new", "follow-up"].includes(l.status) && daysUntil(l.due) <= 0);
    return {
      say: due.length
        ? `${due.length} lead${due.length === 1 ? " needs" : "s need"} a touch today. Opening the pipeline.`
        : "Pipeline is current — nothing overdue. Opening Leads.",
      cards: due.slice(0, 3).map((l) => card("Follow-up due", l.name, l.next, [openAction("Handle in Leads", "leads")], l.company)),
      open: "leads",
    };
  }

  /* --- build / app / dashboard --- */
  if (/\b(build|code|create|make|fix|implement)\b.*\b(app|dashboard|automation|workflow|script|system|web app)\b|\b(app|dashboard|automation|workflow|script)\b/.test(s)) {
    const item = createBuildPlan(subject, text);
    return {
      say: `Builder started it. I created a build plan for ${item.title}.`,
      cards: [],
      open: "adminos",
    };
  }

  /* --- media / content / image / video --- */
  if (/(image|photo|graphic|thumbnail|poster|flyer|visual|ad creative|design|video|reel|content|post|caption|shoot|media|creative|tiktok|short|youtube|instagram|facebook)/.test(s)) {
    if (/(brief|plan|draft|create|make|new|idea)/.test(s) || subject) {
      const kind = mediaKindFromText(text);
      const m = createMediaBrief(subject, kind);
      return {
        say: kind === "image"
          ? `Media Lab generated "${m.title}". Open it to crop, edit, tweak, remove background, duplicate variants, and save.`
          : `Media Lab drafted "${m.title}" — ${kind === "analyze" ? "analysis pass and next-edit direction" : "angle, shot list, and generation-ready notes"}.`,
        cards: [card(kind === "image" ? "Generated image" : "Media brief", m.title, m.angle, [openAction("Edit in Media Lab", "media")], m.type, m.asset)],
        open: "media",
      };
    }
    return { say: "Media Lab is open — briefs, shot lists, and what's ready to produce.", cards: [], open: "media" };
  }

  /* --- store --- */
  if (/(store|shop|product|catalog|merch|sell|checkout)/.test(s)) {
    if (/(build|create|draft|make|new|add)/.test(s)) {
      const d = createPageDraft(subject, "Store");
      return {
        say: `Store Builder drafted "${d.title}" — storefront, product grid, and offer sections scaffolded. Checkout shows as not wired until a payment connector exists.`,
        cards: [card("Store draft", d.title, d.sections.join(" · "), [openAction("Open in Site & Store Studio", "sites")])],
        open: "sites",
      };
    }
    return { say: "Site & Store Studio is open — drafts, products, and publish readiness.", cards: [], open: "sites" };
  }

  /* --- site / page --- */
  if (/(website|web ?page|landing|site|page)/.test(s)) {
    if (/(build|create|draft|make|new)/.test(s)) {
      const d = createPageDraft(subject, /landing/.test(s) ? "Landing page" : "Website");
      return {
        say: `Site Builder drafted "${d.title}". Publishing is ready for the proper receipt lane.`,
        cards: [card("Page draft", d.title, d.sections.join(" · "), [openAction("Open in Site & Store Studio", "sites")])],
        open: "sites",
      };
    }
    return { say: "Site & Store Studio is open.", cards: [], open: "sites" };
  }

  /* --- security --- */
  if (/(security|scan|breach|malware|phish|password|protect|hack|threat|leak|radar|bad habit|exposed)/.test(s)) {
    const sec = visible(store.state.security)[0];
    return {
      say: sec
        ? `Protection posture: ${sec.posture === "clean" ? "clean" : "needs attention"}. Last scan proof ${sec.proofId}, next scan in ${daysUntil(sec.nextScan)} days.`
        : "Opening Protect.",
      cards: sec ? [card("Security check", `Scan proof ${sec.proofId}`,
        sec.findings.map((f) => f.text).join(" "), [openAction("Open Protect", "protect")],
        `Next scan: ${daysUntil(sec.nextScan)} days`)] : [],
      open: "protect",
    };
  }

  /* --- reviews --- */
  if (/(review|testimonial|stars|reputation)/.test(s)) {
    if (/(request|ask|draft|prepare|get|new)/.test(s)) {
      const r = createReviewRequest(subject);
      return {
        say: `Review Studio drafted the request for ${r.client}. It sits in the queue until you approve it to go out.`,
        cards: [card("Review request", r.client, r.draft, [openAction("Open Review Studio", "reviews")], "Status: Draft")],
        open: "reviews",
      };
    }
    return { say: "Review Studio is open — requests, received quotes, and the publish queue.", cards: [], open: "reviews" };
  }

  /* --- bookings --- */
  if (/(book|appointment|schedule|calendar|meeting|call with)/.test(s)) {
    if (/(book|new|create|draft|set ?up|schedule)/.test(s)) {
      const b = createBooking(subject);
      return {
        say: `Booking Coordinator drafted the appointment with ${b.client}. Nothing lands on a calendar until you approve it.`,
        cards: [card("Booking draft", `${b.type} — ${b.client}`, b.copy, [openAction("Open Bookings", "bookings")], "Status: Draft")],
        open: "bookings",
      };
    }
    return { say: "Bookings is open.", cards: [], open: "bookings" };
  }

  /* --- approvals --- */
  if (/(approv|sign.?off|waiting on me|needs my eyes|my eyes|pending|queue)/.test(s)) {
    const pend = visible(store.state.approvals).filter((a) => a.status === "pending");
    return {
      say: pend.length ? `${pend.length} decision${pend.length === 1 ? "" : "s"} waiting on you. Everything else is moving.` : "Approval queue is clear.",
      cards: pend.slice(0, 3).map((a) => card("Needs your call", a.title, a.detail, [openAction("Review in Approvals", "approvals")], `Requested by ${a.requestedBy}`)),
      open: "approvals",
    };
  }

  /* --- workforce --- */
  if (/(workforce|agents?|team|who('| i)s working|workers)/.test(s)) {
    const active = store.state.agents.filter((a) => a.status === "active").length;
    return {
      say: admin
        ? `${active} of ${store.state.agents.length} Phantom systems are ready. These are app capabilities, not employees or logins. Opening the Systems Map.`
        : `${active} service systems are available in your workspace. Opening your systems view.`,
      cards: [], open: "workforce",
    };
  }

  /* --- plan / today / status --- */
  if (/(today|today'?s plan|what('| i)s next|priorit|status|morning|catch me up|summary)/.test(s)) {
    const plan = todaysPlan();
    return {
      say: plan.length ? `${plan.length} thing${plan.length === 1 ? "" : "s"} on today's plan. Top of the list below.` : "Nothing urgent. Phantom systems are standing by.",
      cards: plan.slice(0, 3).map((p) => card("Today", p.text, "", [openAction("Open", p.open)])),
      open: null,
    };
  }

  /* --- help / what can you do --- */
  if (/^(help|what can you do|what do you do|how do i use phantom|how does phantom work)[\s.!?]*$/.test(s)) {
    return {
      say: "Ask normally. If it is business work, Phantom will choose the route and start the draft, plan, workspace item, or approval path without making you pick from a menu.",
      cards: [],
      open: null,
    };
  }

  /* --- general knowledge: let the private brain answer, do not create fake app work --- */
  if (/^(who|what|when|where|why|how|which|define|explain|tell me about|tell me why|can you tell|can you explain|is |are |do |does |should |could |would )\b/.test(s) || /\?$/.test(s)) {
    return {
      say: "I’m checking that.",
      cards: [],
      open: null,
    };
  }

  /* --- universal fallback: make work instead of asking questions --- */
  const item = createWorkItem(text);
  return {
    say: `Handled. I routed this to ${item.lane} and started a work item: ${item.title}.`,
    cards: [],
    open: null,
  };
}

/* Suggestion chips under the command input. */
export function commandSuggestions() {
  return isAdmin()
    ? ["Catch me up", "What needs my eyes?", "Check my risk radar", "What's my pipeline?", "Draft a proposal for a new client", "Create a video brief for a launch"]
    : ["What's happening on my account?", "Show my deliverables", "Draft a review request", "Book a call with my team", "Check my risk radar"];
}

import { currentWs, pushActivity, store, uid, visible } from "./store.js?v=phantom-live-20260714-256";

const DAY = 86400000;
const days = (n) => new Date(Date.now() + n * DAY).toISOString();

export const PHANTOMFORCE_PROSPECT_SEGMENTS = Object.freeze([
  {
    id: "creators-media",
    title: "Creators and media businesses",
    triggers: /\b(creators?|content|media|video|photo|podcast|influencer|studio|agency)\b/i,
    value: 1800,
    why: "They need repeatable content operations, asset organization, approvals, and campaign follow-up.",
    next: "Qualify their current content bottleneck, monthly output target, and approval process.",
    safeStep: "Research public channels first, then ask what slows production down.",
  },
  {
    id: "local-service",
    title: "Local service businesses",
    triggers: /\b(business(?:es)?|small business(?:es)?|local|contractor|home service|service compan(?:y|ies)|salon|gym|clinic|restaurant|bar|venue|shop)\b/i,
    value: 2400,
    why: "They need lead capture, follow-up discipline, review flow, offers, and simple reporting.",
    next: "Identify their offer, lead source, missed follow-up risk, and busiest season.",
    safeStep: "Build a shortlist from public categories before any outreach.",
  },
  {
    id: "schools-education",
    title: "Schools and educational programs",
    triggers: /\b(schools?|education|teacher|student|classroom|club|camp|after.?school)\b/i,
    value: 2200,
    why: "They need safe student-friendly games, staff visibility, classroom controls, and approval-safe workflows.",
    next: "Map the decision maker, privacy requirements, device environment, and pilot class.",
    safeStep: "Keep it private/local until a school approves a pilot conversation.",
  },
  {
    id: "professional-services",
    title: "Professional service firms",
    triggers: /\b(professional|law|legal|accounting|bookkeeping|coach|consultant|real estate|insurance|finance)\b/i,
    value: 2000,
    why: "They need intake, trust-building content, appointment follow-up, and proof reporting.",
    next: "Qualify their intake path, referral flow, and client response time.",
    safeStep: "Collect public positioning only; do not claim a relationship.",
  },
  {
    id: "sports-clubs",
    title: "Sports teams, clubs, and trainers",
    triggers: /\b(sports?|team|club|coach|trainer|league|athlete|fitness|training)\b/i,
    value: 1600,
    why: "They need schedules, media assets, parent/player updates, sponsors, and community engagement.",
    next: "Find whether they sell memberships, camps, training, sponsors, or events.",
    safeStep: "Start with public team pages and package the workflow as a pilot.",
  },
  {
    id: "ops-heavy-teams",
    title: "Ops-heavy small teams",
    triggers: /\b(workforce|ops|operations|startup|crypto|saas|internal|team|employees?)\b/i,
    value: 2600,
    why: "They need a command center for tasks, approvals, client setup, employee work, and reporting.",
    next: "Qualify the handoff points, approval gates, and reports they currently track manually.",
    safeStep: "Frame this as an internal ops audit before suggesting software changes.",
  },
  {
    id: "warm-network",
    title: "Warm referral prospects",
    triggers: /\b(warm|referrals?|network|past clients?|existing contacts?|friends?|people\s+we\s+know)\b/i,
    value: 1400,
    why: "They already have some trust path, so PhantomForce can package a low-friction audit, setup sprint, or managed follow-up offer.",
    next: "Sort known relationships by trust level, business need, and the cleanest permission-based first ask.",
    safeStep: "Use owner-approved relationship notes only; do not scrape private contacts or imply a relationship that is not recorded.",
  },
]);

export function isCrmProspectBuildout(text = "") {
  const s = String(text || "");
  const prospectAudience = /\b(clients?|leads?|prospects?|contacts?|customers?|small business(?:es)?|business(?:es)?|creators?|schools?|education|gyms?|coaches?|trainers?|service compan(?:y|ies)|contractors?|home services?|restaurants?|bars?|venues?|clubs?|teams?|professional services?|warm prospects?)\b/i;
  const targetsCrm = /\b(crm|clients?\s+tab|client\s+tab|pipeline|clients?|client\s+base|lead\s+base|lead\s+list|contact\s+list)\b/i.test(s)
    || (prospectAudience.test(s) && /\b(phantomforce|could\s+use|would\s+use|interested|buy|hire|sell\s+to|customer|client|lead|prospect)\b/i.test(s));
  const asksToPopulate = /\b(update|fill|populate|build|load|start|create|generate|make|map|draft|list|find|add|search|discover|research|scout|source|identify)\b/i.test(s)
    || /\badd\b[\s\S]{0,90}\b(clients?|prospects?|contacts?|everyone|creators?|schools?|business(?:es)?)\b/i.test(s);
  const wantsProspects = /\b(who\s+you\s+think|interested|consider|could\s+use|could\s+buy|could\s+hire|would\s+need|sell\s+to|everyone|prospects?|contacts?|creators?|business(?:es)?|schools?|gyms?|coaches?|service compan(?:y|ies)|phantomforce|workforce)\b/i.test(s)
    || prospectAudience.test(s);
  return targetsCrm && asksToPopulate && wantsProspects;
}

export function requestedProspectSegments(text = "") {
  const s = String(text || "");
  const wantsEveryone = /\b(everyone|all|anyone|full|complete)\b/i.test(s);
  const chosen = PHANTOMFORCE_PROSPECT_SEGMENTS.filter((segment) => wantsEveryone || segment.triggers.test(s));
  return chosen.length ? chosen : PHANTOMFORCE_PROSPECT_SEGMENTS.slice(0, 4);
}

export function createCrmProspectBuildout(text) {
  const ws = currentWs() === "phantomforce" ? "phantomforce" : currentWs();
  const segments = requestedProspectSegments(text);
  store.state.leads = Array.isArray(store.state.leads) ? store.state.leads : [];
  store.state.tasks = Array.isArray(store.state.tasks) ? store.state.tasks : [];

  const existing = new Map(visible(store.state.leads).map((lead) => [String(lead.company || lead.name || "").trim().toLowerCase(), lead]));
  const created = [];
  const leads = [];
  segments.forEach((segment, index) => {
    const key = segment.title.toLowerCase();
    const existingLead = existing.get(key);
    if (existingLead) {
      leads.push(existingLead);
      return;
    }
    const lead = {
      id: uid("lead"),
      ws,
      name: segment.title,
      company: segment.title,
      source: "Phantom AI prospect map",
      status: "new",
      value: segment.value,
      next: segment.next,
      due: days(index + 1),
      owner: "Lead Hunter",
      notes: `${segment.why} Safe next step: ${segment.safeStep} No external outreach, contact details, or live relationship claims were added.`,
      proposalId: null,
      segment: segment.id,
    };
    store.state.leads.unshift(lead);
    existing.set(key, lead);
    created.push(lead);
    leads.push(lead);
  });

  const taskTitle = "Qualify PhantomForce CRM prospect map";
  const hasTask = visible(store.state.tasks).some((task) => String(task.title || "").toLowerCase() === taskTitle.toLowerCase() && task.status !== "done");
  let task = null;
  if (!hasTask) {
    task = {
      id: uid("task"),
      ws,
      title: taskTitle,
      detail: `Review ${segments.length} prospect lane${segments.length === 1 ? "" : "s"}, choose the first qualification target, and turn it into a researched lead list before any outreach.`,
      status: "new",
      priority: "high",
      source: "Phantom AI CRM buildout",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.state.tasks.unshift(task);
  }

  pushActivity("Lead Hunter", `built ${created.length || segments.length} PhantomForce CRM prospect lane${segments.length === 1 ? "" : "s"}.`, ws);
  store.save();
  return { created, leads, segments, task };
}

import { createHash } from "node:crypto";

import { redactSensitiveText } from "./hermes-ledger.js";
import { recallHermesInteractionMemory } from "./hermes-interaction-recall.js";

// ChicagoShots Ops Workflow v1 — local, dry-run, preview-only.
//
// Pipeline: lead intake -> normalized client/job record -> recommended service
// package -> task draft -> deliverables checklist -> follow-up draft ->
// approval preview. Reads Hermes interaction memory read-only for context.
//
// Hard boundaries (acceleration posture, external actions still blocked):
// - PREVIEW ONLY: builds drafts + an approval PREVIEW. Nothing is sent, queued,
//   executed, or written to a production ledger.
// - LOCAL DETERMINISTIC drafting (no provider/network call). The draft_*()
//   helpers are isolated so a gated GLM lane can be swapped in later.
// - REDACTED: free-text fields pass through redactSensitiveText (keys/tokens/
//   cards stripped). Tenant-scoped memory recall is read-only.

const MAX_TEXT = 600;
const MAX_SHORT = 160;

export type ChicagoShotsLeadInput = {
  tenant_id: string;
  actor_user_id?: string | null;
  client_name?: string;
  contact?: string;
  event_type?: string;
  date_time?: string;
  location?: string;
  requested_service?: string;
  budget_rate?: string;
  notes?: string;
  source_platform?: string;
  urgency?: string;
};

type Urgency = "high" | "medium" | "low";
type ServicePackageId =
  | "event_coverage"
  | "portrait_session"
  | "real_estate_media"
  | "sports_action"
  | "brand_content"
  | "general_inquiry";

export type ChicagoShotsLeadIntakePreview = {
  preview_id: string;
  prepared_at: string;
  draft_mode: "local_deterministic";
  normalized_lead: {
    tenant_id: string;
    client_name: string;
    contact: string;
    event_type: string;
    event_category: string;
    date_time: string;
    location: string;
    requested_service: string;
    budget_rate: string;
    source_platform: string;
    urgency: Urgency;
    notes: string;
  };
  recommended_service_package: {
    id: ServicePackageId;
    name: string;
    rationale: string;
    suggested_addons: string[];
  };
  quote_draft: {
    title: string;
    summary: string;
    line_items: string[];
    recommended_price_range: string;
    payment_terms_note: string;
    delivery_timeline: string;
    upsell_options: string[];
    assumptions: string[];
    would_send: false;
    payment_request_created: false;
    invoice_created: false;
  };
  recommended_price_range: string;
  payment_terms_note: string;
  delivery_timeline: string;
  upsell_options: string[];
  task_draft: {
    title: string;
    priority: Urgency;
    suggested_due: string;
    steps: string[];
  };
  deliverables_checklist: string[];
  follow_up_draft: {
    channel_hint: string;
    subject: string;
    body: string;
    would_send: false;
  };
  approval_preview: {
    action_type: "chicagoshots.lead.follow_up";
    status: "preview-only";
    risk_level: "low" | "medium";
    summary: string;
    requires_approval_before_send: true;
    execution_disabled: true;
    would_send: false;
  };
  memory_context_used: {
    source: "hermes_interaction_memory_store";
    recalled_count: number;
    has_memory: boolean;
    compact_memory: string;
  };
  safety_flags: {
    local_only: true;
    dry_run_only: true;
    redacted: true;
    tenant_scoped: true;
    read_only_memory: true;
    provider_called: false;
    network_call_performed: false;
    external_send: false;
    would_send: false;
    approval_executed: false;
    queue_written: false;
    production_ledger_write: false;
    raw_secret_exposed: false;
  };
};

function clean(value: string | undefined | null, max = MAX_SHORT): string {
  if (typeof value !== "string") return "";
  return redactSensitiveText(value.replace(/\s+/g, " ").trim()).slice(0, max);
}

function classifyUrgency(raw: string | undefined): Urgency {
  const v = (raw ?? "").toLowerCase();
  if (/urgent|asap|today|tomorrow|rush|high/.test(v)) return "high";
  if (/soon|this week|medium|priority/.test(v)) return "medium";
  return "low";
}

function classifyPackage(eventType: string, requestedService: string): {
  id: ServicePackageId;
  name: string;
  category: string;
  rationale: string;
  addons: string[];
  deliverables: string[];
} {
  const hay = `${eventType} ${requestedService}`.toLowerCase();
  if (/wedding|party|event|gala|concert|graduation|birthday/.test(hay)) {
    return {
      id: "event_coverage",
      name: "Event Coverage",
      category: "event",
      rationale: "Lead references an event; event coverage package fits multi-hour on-site shooting.",
      addons: ["second shooter", "same-day teaser", "printed album"],
      deliverables: ["Confirm shot list and timeline", "On-site coverage", "Cull + edit gallery", "Deliver online gallery", "Optional highlight reel"],
    };
  }
  if (/headshot|portrait|family|senior|model|profile/.test(hay)) {
    return {
      id: "portrait_session",
      name: "Portrait Session",
      category: "portrait",
      rationale: "Lead references portraits/headshots; studio or location portrait session fits.",
      addons: ["extra outfit changes", "retouch package", "rush delivery"],
      deliverables: ["Confirm look/wardrobe", "Studio/location session", "Select + retouch finals", "Deliver edited set"],
    };
  }
  if (/real estate|property|listing|airbnb|home|apartment|interior/.test(hay)) {
    return {
      id: "real_estate_media",
      name: "Real Estate Media",
      category: "real_estate",
      rationale: "Lead references property/listing media; real estate package fits HDR + walkthrough.",
      addons: ["drone exterior", "video walkthrough", "twilight set"],
      deliverables: ["Confirm property access", "HDR stills shoot", "Edit + deliver MLS-ready set", "Optional walkthrough video"],
    };
  }
  if (/sport|game|team|athlete|action|tournament|match/.test(hay)) {
    return {
      id: "sports_action",
      name: "Sports / Action",
      category: "sports",
      rationale: "Lead references sports/action; fast-shutter action coverage fits.",
      addons: ["team composites", "rush turnaround", "social-cut pack"],
      deliverables: ["Confirm event schedule", "Action coverage", "Fast cull + edit", "Deliver gallery + social cuts"],
    };
  }
  if (/brand|content|product|commercial|business|social|ad/.test(hay)) {
    return {
      id: "brand_content",
      name: "Brand / Content",
      category: "brand",
      rationale: "Lead references brand/content/product; content package fits stills + short-form.",
      addons: ["short-form video", "usage license", "monthly content retainer"],
      deliverables: ["Confirm brief + deliverable specs", "Content shoot", "Edit stills + clips", "Deliver licensed assets"],
    };
  }
  return {
    id: "general_inquiry",
    name: "General Inquiry",
    category: "general",
    rationale: "Service not clearly classified; route to a discovery call to scope the shoot.",
    addons: ["discovery call", "custom quote"],
    deliverables: ["Reply to clarify scope", "Propose package + quote", "Confirm date + deposit"],
  };
}

function quotePricingForPackage(pkg: ReturnType<typeof classifyPackage>, eventType: string): {
  recommendedPriceRange: string;
  deliveryTimeline: string;
  upsellOptions: string[];
} {
  const hay = `${eventType} ${pkg.name}`.toLowerCase();
  switch (pkg.id) {
    case "sports_action":
      return {
        recommendedPriceRange: "$750-$1,500",
        deliveryTimeline: "Proof gallery in 3-5 business days; rush social cuts in 24-48 hours if Jordan approves.",
        upsellOptions: ["rush turnaround", "social-cut pack", "team composites"],
      };
    case "event_coverage":
      return {
        recommendedPriceRange: /wedding/.test(hay) ? "$2,500-$4,500" : "$1,200-$2,500",
        deliveryTimeline: /wedding/.test(hay)
          ? "Preview set in 3-5 business days; full wedding gallery in 2-4 weeks after selections."
          : "Preview set in 3-5 business days; edited event gallery in 7-10 business days.",
        upsellOptions: ["second shooter", "same-day teaser", "highlight reel", "printed album"],
      };
    case "real_estate_media":
      return {
        recommendedPriceRange: "$500-$1,200",
        deliveryTimeline: "MLS-ready stills in 24-72 hours after the shoot; video add-ons follow after approval.",
        upsellOptions: ["video walkthrough", "drone exterior", "twilight set"],
      };
    case "brand_content":
      return {
        recommendedPriceRange: "$1,500-$3,500",
        deliveryTimeline: "First edited set in 5-7 business days; final licensed assets after client approval.",
        upsellOptions: ["short-form video", "usage license", "monthly content retainer"],
      };
    case "portrait_session":
      return {
        recommendedPriceRange: "$350-$900",
        deliveryTimeline: "Proofs in 3-5 business days; final retouched selections after client picks.",
        upsellOptions: ["extra outfit changes", "retouch package", "rush delivery"],
      };
    case "general_inquiry":
    default:
      return {
        recommendedPriceRange: "$500-$2,500 after scope confirmation",
        deliveryTimeline: "Timeline confirmed after a short discovery call and approved scope.",
        upsellOptions: ["discovery call", "custom quote", "monthly content support"],
      };
  }
}

function buildQuoteDraft(input: {
  clientName: string;
  pkg: ReturnType<typeof classifyPackage>;
  eventType: string;
  dateTime: string;
  location: string;
  budgetRate: string;
}): ChicagoShotsLeadIntakePreview["quote_draft"] {
  const quote = quotePricingForPackage(input.pkg, input.eventType);
  const client = input.clientName || "New lead";
  const scope = input.eventType || input.pkg.name;
  const lineItems = [
    `${input.pkg.name} base coverage for ${scope}`,
    `Included delivery: ${input.pkg.deliverables.join("; ")}`,
    input.dateTime ? `Requested date/time: ${input.dateTime}` : "Date/time: confirm before quoting final price",
    input.location ? `Location: ${input.location}` : "Location: confirm before quoting final price",
  ];
  if (input.budgetRate) {
    lineItems.push(`Client-stated budget/rate: ${input.budgetRate}`);
  }

  return {
    title: `${input.pkg.name} quote draft for ${client}`,
    summary: `${input.pkg.name} is the recommended starting package. Suggested range is ${quote.recommendedPriceRange}; Jordan should confirm scope before sending a final quote.`,
    line_items: lineItems,
    recommended_price_range: quote.recommendedPriceRange,
    payment_terms_note:
      "Quote draft only. Typical terms: deposit to hold the date, remaining balance before final delivery. No payment request or invoice has been created.",
    delivery_timeline: quote.deliveryTimeline,
    upsell_options: quote.upsellOptions,
    assumptions: [
      "Jordan reviews and approves any price before manual client use.",
      "Final price depends on shoot length, location, usage rights, turnaround, and add-ons.",
      "This draft does not send a message, create an invoice, or request payment.",
    ],
    would_send: false,
    payment_request_created: false,
    invoice_created: false,
  };
}

function suggestedDue(urgency: Urgency): string {
  if (urgency === "high") return "within 4 hours";
  if (urgency === "medium") return "within 24 hours";
  return "within 2 business days";
}

function draftTaskSteps(clientName: string, pkgName: string, dateTime: string): string[] {
  return [
    `Review and confirm ${clientName || "the lead"}'s request and availability`,
    `Confirm ${pkgName} scope, date/time${dateTime ? ` (${dateTime})` : ""}, and location`,
    "Prepare a quote and deposit link (manual, approval-gated)",
    "Send the follow-up reply after Jordan approves it",
  ];
}

function draftFollowUp(input: {
  clientName: string;
  pkgName: string;
  eventType: string;
  dateTime: string;
}): { subject: string; body: string } {
  const name = input.clientName || "there";
  const subject = `ChicagoShots — ${input.pkgName}${input.eventType ? ` for your ${input.eventType}` : ""}`;
  const body = [
    `Hi ${name},`,
    "",
    `Thanks for reaching out to ChicagoShots! Based on your request, a ${input.pkgName} package looks like a great fit${input.dateTime ? ` for ${input.dateTime}` : ""}.`,
    "",
    "I'd love to confirm a few details (timing, location, and the look you want) and get you a quick quote. What times work best for a short call?",
    "",
    "Talk soon,",
    "ChicagoShots",
  ].join("\n");
  return { subject, body };
}

function createPreviewId(tenantId: string, contact: string, preparedAt: string): string {
  const digest = createHash("sha256").update(`${tenantId}:${contact}:${preparedAt}`).digest("hex").slice(0, 24);
  return `chicagoshots-lead-${digest}`;
}

export async function buildChicagoShotsLeadIntakePreview(
  input: ChicagoShotsLeadInput,
  options: { storePath?: string; now?: string } = {},
): Promise<ChicagoShotsLeadIntakePreview> {
  const preparedAt = options.now ?? new Date().toISOString();
  const tenantId = clean(input.tenant_id, 120) || "chicagoshots";
  const actorUserId = input.actor_user_id?.trim() ? clean(input.actor_user_id, 120) : null;

  const clientName = clean(input.client_name);
  const contact = clean(input.contact);
  const eventType = clean(input.event_type);
  const requestedService = clean(input.requested_service);
  const urgency = classifyUrgency(input.urgency);
  const pkg = classifyPackage(eventType, requestedService);
  const dateTime = clean(input.date_time);
  const location = clean(input.location);
  const budgetRate = clean(input.budget_rate);
  const quoteDraft = buildQuoteDraft({
    clientName,
    pkg,
    eventType,
    dateTime,
    location,
    budgetRate,
  });

  // Read-only Hermes memory context (tenant + optional operator scope).
  const recall = await recallHermesInteractionMemory({
    tenantId,
    actorUserId,
    storePath: options.storePath,
    now: preparedAt,
  });

  const followUp = draftFollowUp({ clientName, pkgName: pkg.name, eventType, dateTime });

  return {
    preview_id: createPreviewId(tenantId, contact, preparedAt),
    prepared_at: preparedAt,
    draft_mode: "local_deterministic",
    normalized_lead: {
      tenant_id: tenantId,
      client_name: clientName,
      contact,
      event_type: eventType,
      event_category: pkg.category,
      date_time: dateTime,
      location,
      requested_service: requestedService,
      budget_rate: budgetRate,
      source_platform: clean(input.source_platform),
      urgency,
      notes: clean(input.notes, MAX_TEXT),
    },
    recommended_service_package: {
      id: pkg.id,
      name: pkg.name,
      rationale: pkg.rationale,
      suggested_addons: pkg.addons,
    },
    quote_draft: quoteDraft,
    recommended_price_range: quoteDraft.recommended_price_range,
    payment_terms_note: quoteDraft.payment_terms_note,
    delivery_timeline: quoteDraft.delivery_timeline,
    upsell_options: quoteDraft.upsell_options,
    task_draft: {
      title: `Follow up: ${clientName || "new lead"} — ${pkg.name}`,
      priority: urgency,
      suggested_due: suggestedDue(urgency),
      steps: draftTaskSteps(clientName, pkg.name, dateTime),
    },
    deliverables_checklist: pkg.deliverables,
    follow_up_draft: {
      channel_hint: /@/.test(contact) ? "email" : contact ? "text/dm" : "unknown",
      subject: redactSensitiveText(followUp.subject).slice(0, MAX_SHORT),
      body: redactSensitiveText(followUp.body).slice(0, MAX_TEXT),
      would_send: false,
    },
    approval_preview: {
      action_type: "chicagoshots.lead.follow_up",
      status: "preview-only",
      risk_level: urgency === "high" ? "medium" : "low",
      summary: `Draft follow-up to ${clientName || "lead"} for a ${pkg.name}. Requires Jordan approval before any send.`,
      requires_approval_before_send: true,
      execution_disabled: true,
      would_send: false,
    },
    memory_context_used: {
      source: "hermes_interaction_memory_store",
      recalled_count: recall.returned_records,
      has_memory: recall.has_memory,
      compact_memory: recall.compact_memory,
    },
    safety_flags: {
      local_only: true,
      dry_run_only: true,
      redacted: true,
      tenant_scoped: true,
      read_only_memory: true,
      provider_called: false,
      network_call_performed: false,
      external_send: false,
      would_send: false,
      approval_executed: false,
      queue_written: false,
      production_ledger_write: false,
      raw_secret_exposed: false,
    },
  };
}

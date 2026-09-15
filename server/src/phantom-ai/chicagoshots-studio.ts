import type { ChicagoShotsFollowUpCandidate } from "./chicagoshots-nexprospex-crm.js";

export type ChicagoShotsReplyDraft = {
  id: string;
  ref: string;
  contact_id: string;
  contact_name: string;
  organization: string;
  channel: "email" | "instagram" | "manual";
  destination_hint: string;
  subject: string;
  body: string;
  due_at: string;
  status: "approval_required";
  external_send: false;
};

function clean(value: unknown, max = 220) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, max);
}

function firstName(value: string) {
  return clean(value, 80).split(/\s+/u)[0] || "there";
}

function serviceLine(candidate: ChicagoShotsFollowUpCandidate) {
  const context = `${candidate.sport} ${candidate.organization}`.toLowerCase();
  if (/school|athletic|sport|football|basketball|soccer|volleyball|baseball|softball|track|club|team/u.test(context)) {
    return "game-day coverage, athlete features, recruiting edits, and season-long social content";
  }
  if (/doctor|medical|health|conference|association/u.test(context)) {
    return "conference coverage, expert interviews, podcast production, and social cutdowns";
  }
  return "event coverage, interviews, podcast production, and social-ready edits";
}

export function buildChicagoShotsReplyDraft(candidate: ChicagoShotsFollowUpCandidate): ChicagoShotsReplyDraft {
  const channel = candidate.email ? "email" : candidate.instagram ? "instagram" : "manual";
  const destination = candidate.email || candidate.instagram || "Contact details need review";
  const subject = candidate.last_subject.toLowerCase().startsWith("re:")
    ? candidate.last_subject
    : `Re: ${candidate.last_subject || `ChicagoShots for ${candidate.organization}`}`;
  const step = Math.max(1, Math.min(3, candidate.follow_up_number || 1));
  const closes = [
    "If something is coming up, send me the date and what you want captured and I can map out the right coverage.",
    "If media is on your calendar this season, I can send a simple coverage option built around the date, venue, and deliverables.",
    "I will close the loop for now. If a future event or content need comes up, ChicagoShots would be glad to help.",
  ];
  const body = `Hi ${firstName(candidate.name)},\n\nI wanted to follow up on my note about ${candidate.organization}. ChicagoShots handles ${serviceLine(candidate)} for Chicago-area organizations.\n\n${closes[step - 1]}\n\nJordan West\nChicagoShots\nhttps://chicagoshots.com`;
  return {
    id: `reply-${clean(candidate.task_id, 90)}`,
    ref: `nexprospex:${clean(candidate.task_id, 90)}`,
    contact_id: clean(candidate.contact_id, 100),
    contact_name: clean(candidate.name, 120),
    organization: clean(candidate.organization, 180),
    channel,
    destination_hint: clean(destination, 180),
    subject: clean(subject, 240),
    body,
    due_at: candidate.due_at,
    status: "approval_required",
    external_send: false,
  };
}

export function buildChicagoShotsReplyDrafts(candidates: ChicagoShotsFollowUpCandidate[], limit = 8) {
  const safeLimit = Math.max(1, Math.min(25, Math.floor(limit || 8)));
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => candidate.task_id && !seen.has(candidate.task_id) && seen.add(candidate.task_id))
    .slice(0, safeLimit)
    .map(buildChicagoShotsReplyDraft);
}

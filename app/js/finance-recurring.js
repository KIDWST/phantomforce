export const RECURRING_OCCURRENCE_CAP = 500;

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function addInterval(dateISO, rule) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  if (rule.frequency === "weekly") {
    d.setUTCDate(d.getUTCDate() + 7);
    return isoDate(d);
  }
  if (rule.frequency === "biweekly") {
    d.setUTCDate(d.getUTCDate() + 14);
    return isoDate(d);
  }
  if (rule.frequency === "monthly") {
    const anchorDay = new Date(`${rule.startDate}T00:00:00Z`).getUTCDate();
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    next.setUTCDate(Math.min(anchorDay, daysInMonth(next.getUTCFullYear(), next.getUTCMonth())));
    return isoDate(next);
  }
  d.setUTCDate(d.getUTCDate() + Math.max(1, Number(rule.intervalDays) || 1));
  return isoDate(d);
}

export function generateDueOccurrences(rule, asOfISODate) {
  if (rule.status !== "active") {
    return { occurrences: [], nextLastGeneratedDate: rule.lastGeneratedDate ?? null, capped: false };
  }
  const occurrences = [];
  let cursor = rule.lastGeneratedDate ? addInterval(rule.lastGeneratedDate, rule) : rule.startDate;
  let capped = false;
  while (cursor <= asOfISODate) {
    if (rule.endDate && cursor > rule.endDate) break;
    occurrences.push({ date: cursor });
    if (occurrences.length >= RECURRING_OCCURRENCE_CAP) {
      capped = true;
      break;
    }
    cursor = addInterval(cursor, rule);
  }
  const nextLastGeneratedDate = occurrences.length
    ? occurrences[occurrences.length - 1].date
    : (rule.lastGeneratedDate ?? null);
  return { occurrences, nextLastGeneratedDate, capped };
}

/* Presentation only: every entry still comes from the authorized catalog.
   A cleaner picker must never merge organizations or change their authority. */
const CORE_BUSINESSES = Object.freeze([
  { ids: ["phantomforce-internal", "phantomforce"], profiles: ["phantomforce"] },
  { ids: ["client-chicagoshots"], profiles: ["chicagoshots", "client-chicagoshots"] },
  { ids: ["occasionally-odd"], profiles: ["occasionallyodd", "occasionally-odd"] },
]);
const RESERVED_LEGACY = new Set(["phantomforce-owner"]);
const CORE_PROFILES = new Set(CORE_BUSINESSES.flatMap(group => group.profiles));
const normalized = value => String(value || "").trim().toLocaleLowerCase();

export const hasWorkspaceDirectoryAccess = account => account?.role === "admin"
  && (account.canManageAccess === true || account.isSuperAdmin === true);

function workspaceKind(item) {
  const text = `${item.id} ${item.name}`;
  if (RESERVED_LEGACY.has(item.id)) return "Legacy workspace";
  if (/(?:^|[\s()._-])(?:dev|development)(?:$|[\s()._-])/i.test(text)) return "Development";
  if (/(?:^|[\s()._-])(?:qa|test|recovery)(?:$|[\s()._-])/i.test(text)) return "Testing";
  if (/(?:^|[\s()._-])(?:demo|pilot)(?:$|[\s()._-])/i.test(text)) return "Demo / pilot";
  if (/(?:^|[\s()._-])customer(?:\s|\d|$)/i.test(text)) return "Customer workspace";
  return "Organization";
}

function uniqueHint(item, siblings) {
  for (const length of [8, 12, 16, item.id.length]) {
    const hint = item.id.slice(-length);
    if (!siblings.some(other => other.id !== item.id && other.id.slice(-length) === hint)) return hint;
  }
  return item.id;
}

export function filterWorkspaceDirectory(items, query = "") {
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  return items.filter(item => terms.every(term => normalized(`${item.name} ${item.id} ${item.role} ${item.kind}`).includes(term)));
}

export function workspaceDirectory({ choices = [], current = "", account = {} } = {}) {
  const seen = new Set();
  const source = choices.filter(item => typeof item?.id === "string" && item.id && !seen.has(item.id) && seen.add(item.id));
  const all = source.map(item => {
    const sameName = source.filter(other => normalized(other.name) === normalized(item.name));
    const idHint = uniqueHint(item, sameName);
    return { ...item, kind: workspaceKind(item), idHint,
      label: sameName.length > 1 ? `${item.name} · ${idHint}` : item.name };
  });
  const owner = hasWorkspaceDirectoryAccess(account);
  if (!owner) return { owner, all, primary: all, other: [], activeOther: null };

  const primary = [], selected = new Set();
  const include = item => { if (item && !selected.has(item.id)) { primary.push(item); selected.add(item.id); } };
  for (const group of CORE_BUSINESSES) {
    const exact = group.ids.map(id => all.find(item => item.id === id)).find(Boolean);
    // Explicit server profile mappings can identify a configured business whose
    // actual organization ID differs. Names and browser aliases cannot do so.
    include(exact || all.find(item => !RESERVED_LEGACY.has(item.id) && group.profiles.includes(item.businessId)));
  }
  for (const item of all) {
    if (typeof item.businessId === "string" && item.businessId && !CORE_PROFILES.has(item.businessId) && !RESERVED_LEGACY.has(item.id)) include(item);
  }
  const activeOther = !selected.has(current) ? all.find(item => item.id === current) || null : null;
  include(activeOther);
  const other = all.filter(item => !selected.has(item.id))
    .sort((left, right) => normalized(left.name).localeCompare(normalized(right.name)) || left.id.localeCompare(right.id));
  return { owner, all, primary, other, activeOther };
}

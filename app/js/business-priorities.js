// Date-only deadlines are compared as calendar dates, without UTC conversion.
export function businessDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function workPriority(record, today = businessDay()) {
  const closed = ["complete", "retired", "shipped", "cancelled"].includes(record.status);
  const raw = String(record.due || "").slice(0, 10);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00`) : null;
  const due = parsed && Number.isFinite(parsed.getTime()) && businessDay(parsed) === raw ? raw : "";
  return {
    open: !closed,
    overdue: !closed && Boolean(due) && due < today,
    today: !closed && due === today,
    review: !closed && ["review", "quality-check"].includes(record.status),
    ready: !closed && record.status === "ready",
    unscheduled: !closed && !due,
    due,
  };
}

export function compareWorkPriority(a, b, today = businessDay()) {
  const rank = (record) => {
    const p = workPriority(record, today);
    return !p.open ? 5 : p.overdue ? 0 : p.today ? 1 : p.review || p.ready ? 2 : p.due ? 3 : 4;
  };
  return rank(a) - rank(b) || (workPriority(a, today).due || "9999").localeCompare(workPriority(b, today).due || "9999") || String(a.title || a.id || "").localeCompare(String(b.title || b.id || ""));
}

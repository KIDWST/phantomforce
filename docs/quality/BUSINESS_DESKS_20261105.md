# Business desks and daily priorities

Build: phantom-live-20261105-248

The owner command center now identifies the selected company and opens its operational desk directly: PhantomForce Project desk, ChicagoShots Studio desk, or Occasionally Odd workroom. Existing owner modules, permissions and the single global navigation are preserved.

Project and studio metrics filter the actual work queue. Focus controls show all open work, overdue work, today, review, or missing dates. Dates are calendar dates; invalid dates need scheduling, and completed/retired/shipped/cancelled records cannot become overdue. Ordering prioritizes overdue work, today, review/ready, future dates, then undated work. Keyboard focus survives rerendering.

Occasionally Odd fulfillment offers All open, Overdue, Ship today, Ready to ship, and Needs a date, with a direct create-order action. Empty filtered results no longer claim every order has shipped. Existing server records and manager permissions remain authoritative.

Validation: full application build; focused business priorities, business experience, commerce renderer and business boundary suites; actual Chrome business switching and focus actions at 1440, 390 and 320 pixels. Chrome fixtures create only isolated local test records. Screenshots are captured after the entrance transition; no production owner session was used. The complete release-critical suite passed 73/73. Focused checks passed: business experience 189, commerce renderer 144, business client isolation 25, media boundaries 27, server business isolation 93, commerce domain 75, actual signed HTTP requests 55, studio lifecycle 9, and change-memory 590. The canonical clean-main preflight passed before integration. Initial CSS remains below its unchanged 1,120,000-byte budget at 1,118,149 bytes.

The commerce fixture previously crashed on unrelated nested print-tool DOM mounts. It now leaves those child mounts to their existing dedicated tests and exercises commerce directly; no production behavior was bypassed.

Undo: revert this release commit and sync the dedicated deployment. There is no database migration or external provider configuration.

# Run Event Protocol

PhantomBot keeps runtime truth in the gateway rather than deriving it from cosmetic UI state.

- Session-scoped stream events carry message deltas, lifecycle state, usage, tool activity, errors, compaction, and model-switch markers.
- The desktop projects gateway events into session stores and status surfaces; a running request exposes Stop controls and a running timer.
- Durable model-switch markers are appended only when the model/provider route changes.
- An exact reselect can refresh local metadata without rebuilding the runtime or mutating chat history.
- Terminal outcomes are completed, cancelled, or failed; a request is never reported as completed merely because a renderer stopped observing it.

The existing HTTP run API separately exposes queued/running/completed/failed status and SSE `run.completed` / `run.failed` events. No new parallel lifecycle protocol was introduced for this overhaul.

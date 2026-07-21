# Prompt Library: Server-Persisted + Send-to-Chat — Design

**Date:** 2026-07-20
**Status:** Approved by Jordan, proceeding to implementation plan.

## Problem

The existing Prompt Library (`app/js/promptlibrary.js`) is a hardcoded, client-only
26-prompt array (`PROMPT_SEED`) with two card actions: **Copy** (clipboard) and
**"Use in Media Lab"** (hands the prompt to the Media Lab workspace via
`workspaceStorage` key `pf.medialab.promptIntent.v1` + `openWorkspace("media")`).
It cannot be edited without a code deploy, and there's no one-click way to run a
prompt straight through Phantom AI chat.

## Goals

1. Move the curated prompt set server-side so it can be edited without a deploy.
2. Add a third card action, **Send**, that runs the prompt through the existing
   chat pipeline with one click.
3. Keep this additive — Copy and "Use in Media Lab" behavior is unchanged.

## Non-goals

- Per-tenant libraries (one global curated set, matches today's behavior).
- User-submitted prompts (admin-curated only).
- Prompt templating/variable fill-in (plain text only for now).
- Any change to `/phantom-ai/chat` itself, the prompt-injection guard, or usage
  metering — Send reuses that pipeline unmodified.

## Architecture

### Backend

New module `server/src/prompt-library/prompt-library-store.ts`, following the
existing `crm-pipeline-store.ts` pattern (`server/src/crm/crm-pipeline-store.ts`):
- Single global JSON file at `server/.local/prompt-library/library.json`
  (not per-tenant — there is one shared library).
- sha256 checksum + file lock on write, same shape as the CRM store's
  `withTenantLock`, keyed on a fixed global key instead of a tenant id.
- Seeded at first boot from the current 26-entry `PROMPT_SEED` array so nothing
  in the library changes for existing users at rollout.

New routes (added in `server/src/index.ts` alongside other `/phantom-ai/*` and
CRM-style routes):
- `GET /prompt-library` — any authenticated session, returns the full list.
- `POST /prompt-library` — create, admin-gated.
- `PUT /prompt-library/:id` — edit, admin-gated.
- `DELETE /prompt-library/:id` — delete, admin-gated.

Admin gating reuses whichever existing admin-check pattern guards other
admin-only server routes (session flags equivalent to frontend's
`isAdmin()`/`isOwnerOperator()`, `server/src/access/session.ts`) — the
implementation plan should read the current admin-route pattern directly
rather than assume a specific function name, since this design doc predates
that read.

### Frontend (`app/js/promptlibrary.js`)

- Replace hardcoded `PROMPT_SEED` with a `GET /prompt-library` fetch on render.
- Add a **Send** button (`data-pl-send`) next to the existing Copy
  (`data-pl-copy`) and "Use in Media Lab" (`data-pl-use`) buttons on each card.
- Send writes `{ prompt, autoSend: true }` to a new `workspaceStorage` key,
  `pf.chat.promptIntent.v1`, then calls `openWorkspace("chat")`. This mirrors
  the existing Media Lab handoff mechanism exactly — no new handoff pattern.
- The Chat workspace's init reads `pf.chat.promptIntent.v1` on mount: if
  present, it fills the chat input with `prompt` and, if `autoSend` is true,
  submits through the normal chat-send code path (the same path a manually
  typed message takes) — so it hits `/phantom-ai/chat`, the prompt-injection
  guard, and usage metering exactly as today, with no new attack surface.
- When `isAdmin()` is true, cards also render Edit/Delete actions and the
  panel gets an "Add Prompt" button (title / category / prompt-text form)
  posting to the new endpoints.

## Data flow

1. Dashboard loads Prompt Library card → `GET /prompt-library` → renders cards.
2. Non-admin user clicks Send → `workspaceStorage` handoff → Chat workspace
   auto-submits → existing `/phantom-ai/chat` pipeline → response renders in
   Chat workspace, unchanged from a manual chat message.
3. Admin adds/edits/deletes a prompt → `POST`/`PUT`/`DELETE /prompt-library`
   → store updates → next `GET` reflects it for every tenant immediately
   (it's global, so a bad edit is instantly platform-wide — Delete gets a
   confirm step in the UI for this reason).

## Error handling

- `GET /prompt-library` failure → show a "couldn't load, retry" empty state;
  never silently fall back to a stale hardcoded list.
- Concurrent admin writes → checksum-conflict-refuse, same as CRM store
  (reject the write, ask the admin to reload) rather than last-write-wins,
  given multiple sessions sometimes touch this worktree concurrently.
- If the Chat workspace's `promptIntent` read races against mount (rare),
  fall back to switching tabs without auto-send rather than losing the prompt
  or throwing.

## Testing

- Backend: CRUD + checksum-conflict unit tests for `prompt-library-store.ts`
  (same shape as existing CRM store tests), plus a 403 test for non-admin
  writes to the mutating routes.
- Manual: launch the dev server and click through Send → Chat handoff, and
  Add/Edit/Delete as an admin, before calling this done.

## Explicitly out of scope for this spec

Per the same conversation this was scoped out of, the following are queued as
separate future specs, not part of this work: an Automations-integrated
scraping/data-extraction module, a local chat UI overhaul, an audit of
existing agent-orchestration systems (Phantombot/Termina) before considering
any new autonomous-agent framework, and a consent-gated synthetic-media
(face-swap) feature with mandatory disclosure/watermarking and Hermes-ledger
logging — the last of these specifically requires consent verification and
disclosure safeguards before any implementation begins, regardless of
priority ordering elsewhere.

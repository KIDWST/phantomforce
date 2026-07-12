# PhantomPlay foundation

## Audit result

PhantomPlay was introduced as a new product line. No existing PhantomPlay route, backend module, game catalog, creator system, runtime, publishing flow, or database model was assumed.

Current PhantomForce integration points observed:

- React single-shell app in `apps/web/src/App.tsx`
- Fastify API in `server/src/index.ts`
- Demo/session auth through `server/src/access/session.ts`
- Admin/client role split with `canManageAccess`
- Sidebar/mobile route-state navigation
- Activity feed used as lightweight notification/audit surface
- Content Hub background job simulation for long-running creative work
- Access/admin controls already use conservative backend checks
- Local state modules are used for early product foundations

## Product boundary

PhantomPlay is separate from PhantomForce business software. It reuses only useful infrastructure:

- account/session identity
- admin role checks for org policy
- activity notifications
- design tokens and shell layout

It keeps separate:

- game catalog
- game sessions
- creator profiles
- moderation states
- runtime security policy
- favorites/recent plays
- publishing state machine

## Non-goals for this foundation

- No Asset Cloud coupling
- No Media Lab/Content Hub restructuring
- No executable game uploads
- No GPU/cloud streaming
- No automatic creator revenue-sharing logic
- No invasive employee surveillance
- No instant publishing of untrusted uploads

## Initial backend boundary

Implemented in `server/src/phantomplay/state.ts` with routes in `server/src/index.ts`:

- `GET /phantomplay/snapshot`
- `POST /phantomplay/policy`
- `POST /phantomplay/sessions`
- `PATCH /phantomplay/sessions/:id`
- `POST /phantomplay/favorites/:gameId`

Business organizations default to `disabled`. Admins can switch to:

- `enabled`
- `background_jobs_only`
- `selected_hours`

## Runtime security direction

Version one is browser-first only:

- HTML5
- JavaScript
- WebAssembly
- WebGL
- Godot web exports

Uploaded games must be treated as untrusted content. Future upload handling must include archive inspection, executable rejection, sandbox iframe isolation, CSP, network restrictions, storage quotas, abuse detection, audit logs, takedown support, and review before publishing.

## Flagship

Ghost Solitaire is the symbolic first game:

- slogan: “Play like a ghost.”
- browser-first runtime
- planned save/resume
- undo/restart/timer/move count/daily challenge/personal best
- keyboard/mouse/touch accessibility
- reduced-motion support
- pause/resume when PhantomForce work completes

## PhantomForce integration

The integration is intentionally restrained:

- sidebar entry: Break Room
- background-job-aware launch context
- admin policy controls
- no force-open behavior
- no permanent gaming takeover of PhantomForce

Inside PhantomForce, PhantomPlay is a Take Five experience while work continues.

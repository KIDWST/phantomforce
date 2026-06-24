# PhantomForce AI App Instructions

Canonical context: `C:\Users\jorda\Documents\Jordan-AI-Operations`.

Purpose: first-build PhantomForce all-in-one AI operations app prototype with command center, email, calendar, tasks, approvals, activity, connections, PWA support, and locked Falcon boundary.

Status: local frontend prototype. External Gmail/Calendar actions are simulated. This is not production.

Commands:

- `npm install`
- `npm run dev -- --host 127.0.0.1 --port 5188`
- `npm run build`
- `npm run preview`

Safe to edit:

- `src/`
- `public/`
- package/config files when needed for the app.

Approval required:

- Real OAuth credentials.
- Deployment.
- External sends/calendar writes.
- Production auth or domain changes.

Definition of done:

- Build passes.
- Browser flow verified.
- Approval-gated external actions stay explicit.
- Canonical docs updated if product direction changes.


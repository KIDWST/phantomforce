# PhantomForce App

Stable source root for the all-in-one PhantomForce AI operating app.

This is the promoted version of the 2026-06-24 PWA prototype. The prototype
proved the product surface; this repo is where the real backend, approvals,
audit trail, AI orchestration, and connector layer now belong.

## Shape

- `apps/web` - React/Vite/TypeScript PWA client.
- `server` - TypeScript backend, approval engine, connector layer, Falcon broker.
- `packages/contracts` - shared Zod contracts for actions and Falcon jobs.

## Safety Rules

- The web app never talks to Falcon directly.
- Falcon remains private local machinery.
- AI may propose actions, but human approval executes side effects.
- External sends, calendar writes, Falcon write jobs, and Falcon command jobs
  must execute only through persisted approvals and audit events.

## Local Commands

```powershell
npm install
npm run build
npm run dev:web
npm run dev:server
```

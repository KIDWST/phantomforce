# Phantom Loop

Phantom Loop is the Elite guarded build mode inside Phantom chat. It turns a user goal into a local build packet, then waits for review before anything becomes a draft, publish action, send, deployment, or connector call.

## Current Implementation

- Intent detection lives in `app/js/intent-router.js`.
- Build requests route through `app/js/command.js`.
- Explicit Phantom Loop requests create local `store.state.looperPlans` records.
- Site Creator renders those packets in `app/js/workspaces.js`.
- A packet can be turned into a local website draft only after the user clicks `Start site draft`.

## What Phantom Loop Can Do Safely

- Normalize a goal.
- Choose an output type such as page build packet, intake form spec, campaign plan, proposal draft, workflow spec, or general build plan.
- Draft steps and safeguards.
- Store a local review packet.
- Prepare a local Site Creator draft after user action.

## What Phantom Loop Must Not Do Without Approval

- Publish.
- Deploy.
- Send emails, texts, DMs, or social posts.
- Charge money.
- Connect accounts.
- Run arbitrary code.
- Expose secrets or provider keys.
- Write production data.
- Cross tenant or workspace boundaries.

## Packet Fields

- `id`
- `ws`
- `title`
- `goal`
- `output`
- `status`
- `risk`
- `steps`
- `safeguards`
- `createdAt`
- `updatedAt`

## UX Rules

- Build-language should create a Phantom Loop packet, not a generic task.
- Questions and brainstorming must stay conversational.
- Site Creator is the review surface for website/page/store packets.
- External actions remain approval-gated and connector-gated.
- If a provider is not wired, say so honestly.

## Verification

Run:

```powershell
npm run test:intent
node --check app\js\command.js
node --check app\js\workspaces.js
node --check app\js\store.js
```

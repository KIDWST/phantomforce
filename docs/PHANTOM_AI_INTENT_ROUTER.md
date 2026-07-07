# Phantom AI Intent Router

Phantom must classify what the user meant before creating any local record.

## Default Rule

Do not create a task by default.

Casual chat, questions, feedback, complaints, brainstorming, and soft product direction stay conversational until the user explicitly asks Phantom to create, track, assign, schedule, remind, or build something.

## Intent Categories

- `chat`
- `question`
- `brainstorm`
- `plan`
- `task_candidate`
- `create_task`
- `automation_candidate`
- `create_automation`
- `reminder`
- `looper_build`
- `approval_request`
- `status_check`
- `feedback`
- `memory_update`
- `internal_operator_handoff`
- `unknown`

The frontend classifier lives in `app/js/intent-router.js`.

## Output Contract

The router returns:

- `primaryIntent`
- `confidence`
- `shouldCreateTask`
- `shouldCreateAutomation`
- `shouldStartLooper`
- `shouldAskClarifyingQuestion`
- `requiresUserConfirmation`
- `requiresAdminApproval`
- `reasonCode`
- optional `taskDraft`
- optional `automationDraft`
- optional `looperDraft`

## Confirmation Rules

Create a task only when the user explicitly says things like:

- `create a task to fix the chat box`
- `add a task: update the profile card`
- `make this a todo`
- `assign Codex a task`
- `track this as high priority`
- `put this on my task list`

Ask for confirmation, but do not create, when the user says things like:

- `we need to fix the navbar`
- `the chat box needs better spacing`
- `someone should update billing`
- `make the profile card better`

Never create a task from:

- `what do you think about making the website better?`
- `i hate this dashboard`
- `we should improve the chat box`
- `maybe add a profile picture`
- `why is this broken?`
- `this needs to feel more premium`
- `I want Phantom to feel alive`

## Phantom Loop Routing

Build-language routes to guarded Phantom Loop planning, not generic task creation.

Examples:

- `build me a landing page`
- `create a campaign`
- `make an intake form`
- `start Phantom Loop for my website`
- `turn this into a build plan`

Phantom Loop plans can draft structure, copy, specs, and approval packets. They must not publish, deploy, send, charge, connect accounts, run arbitrary code, expose secrets, or write production data without a separate approved execution lane.

## Automation And Reminder Routing

Reminder/monitoring language routes to automation/reminder handling.

Examples:

- `remind me tomorrow`
- `check this every morning`
- `monitor my site daily`
- `tell me when this breaks`

If the cadence or time is missing, Phantom asks for timing instead of creating the automation.

Created automations are local drafts and require approval before running.

## Safety Boundaries

- The router is deterministic and local.
- No provider calls happen during classification.
- No external sends, posts, deploys, account links, billing actions, queue writes, ledger writes, or production database writes happen from the router.
- External actions remain approval-gated and connector-gated.

## Verification

Run:

```powershell
npm run test:intent
```

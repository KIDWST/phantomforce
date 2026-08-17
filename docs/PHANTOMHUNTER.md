# PhantomHunter

## Product split

PhantomHunter has two intentionally different surfaces.

### PhantomHunter Desktop — advanced

The private Windows application follows PhantomSentry's local-app model. It binds to `127.0.0.1`, opens a modern local interface, and gives the authorized operator explicit control over:

- readable local drives, folders, archives, files, and Git worktrees;
- remote Git repositories;
- public or private website/API text with session-only request headers;
- source, configuration, or logs pasted directly into process memory;
- up to 250 explicit targets per hunt;
- masked active-key history and one-time local reveal from volatile memory.

Windows filesystem permissions are the local-path boundary. Every network or repository target must be explicitly entered by the operator. The desktop distribution lives at `C:\Users\jorda\Documents\PhantomHunter` and bundles Betterleaks, TruffleHog, and KeyHunter.

### PhantomHunter Web — simple

The PhantomForce workspace cannot accept a path, URL, uploaded target list, or custom scan payload. It resolves exactly one repository already bound to the organization and presents one action: **Scan now**.

If a repository is not bound, the UI shows a single code-source connection state for the workspace owner. Ordinary users are never asked where a repository lives.

An unbound user chooses only GitHub, GitLab, or Bitbucket. PhantomForce records a credential-free, tenant-scoped connection request for the workspace owner; it does not ask the user for a repository path or access token.

Workspace repository bindings are supplied server-side with `PHANTOM_HUNTER_WEB_REPOSITORIES_JSON`:

```json
{
  "organization-id": {
    "target": "https://github.com/example/project.git",
    "label": "Project",
    "kind": "git_repository"
  }
}
```

The platform operator's local development session may bind the current PhantomForce repository automatically. Customer organizations never inherit that fallback.

## One three-engine pipeline

Both surfaces use the same verdict model:

1. Betterleaks performs broad discovery with native verification disabled.
2. TruffleHog performs independent filesystem/history discovery with native verification disabled.
3. KeyHunter receives safely supported detections through a bounded, provider-aware verification bridge.

The result surface and durable history retain only credentials accepted by the provider through the safe verification bridge. There is no browser review lane for other scanner output.

## Secret handling

- PhantomForce Web never returns raw credentials.
- PhantomForce Web and Desktop never durably persist raw credentials.
- Dedupe uses a keyed HMAC fingerprint.
- Web UI and CSV exports contain masked values and fingerprints only.
- Desktop may reveal a confirmed active key once from volatile local memory after explicit operator confirmation; it auto-hides after 20 seconds and disappears on restart.
- Betterleaks and TruffleHog raw reports are normalized in process memory.
- KeyHunter temporary bridge files are permission-restricted, overwritten, unlinked, and removed immediately.
- Desktop website/API authentication headers are session-only and are cleared when the hunt finishes.

The pipeline does not revoke, rotate, modify, generate, publish, deploy, or make destructive provider calls.

## Web routes

All routes require a PhantomForce session and resolve tenant membership server-side.
The browser client reads the bearer token and active tenant through the shared
PhantomForce session store, so the same authenticated contract is used by the
web host and desktop-class PhantomForce shell.

| Method | Route | Purpose |
|---|---|---|
| GET | `/phantom-ai/phantom-hunter/status` | Engine and bound-repository contract |
| GET | `/phantom-ai/phantom-hunter/web` | One repository, active-only history, engine readiness |
| POST | `/phantom-ai/phantom-hunter/web/connect` | Request GitHub/GitLab/Bitbucket connection without a path or credential |
| POST | `/phantom-ai/phantom-hunter/web/scan` | Scan the bound repository; accepts no target |
| GET | `/phantom-ai/phantom-hunter/scans/:scanId` | Active-only tenant-scoped run |
| POST | `/phantom-ai/phantom-hunter/scans/:scanId/cancel` | Stop an active run |
| GET | `/phantom-ai/phantom-hunter/scans/:scanId/export.csv` | Masked active-only export |

Legacy arbitrary asset intake and custom scan routes return `410 Gone` with a desktop-only message.

## Verification truth

The automated proof uses the real Betterleaks 1.7.4, TruffleHog 3.97.0, and KeyHunter 0.1.0 binaries. It demonstrates repository binding, disabled arbitrary browser intake, ignored forged target fields, tenant isolation, execution of all three engines, active-only output, masked export, and absence of raw credentials or non-active finding records in durable state.

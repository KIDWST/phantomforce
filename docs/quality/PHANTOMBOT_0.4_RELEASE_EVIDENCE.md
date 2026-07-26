# PhantomBot 0.4.0 release evidence

Date: 2026-07-26

## Artifact

- Version: `0.4.0`
- Installer:
  `C:\Users\jorda\Documents\Codex\2026-07-26\files-mentioned-by-the-user-phantombot\outputs\PhantomBot-0.4.0-unsigned-Setup.exe`
- Size: 139,787,776 bytes
- SHA-256:
  `6F429856B9900F32FDFA43920ABBC0FA74E0D1EEC77FA43C8A176C25977140B3`
- Authenticode: `NotSigned`
- Expected Windows behavior: SmartScreen/Defender may warn because the
  artifact is unsigned. No bypass is provided or recommended.

## Build and smoke verification

- `npm run test:phantombot-desktop`: 6/6 passed.
- `npm run make --workspace @phantomforce/phantombot-desktop`: passed.
- Squirrel outputs include
  `PhantomBot-0.4.0 Setup.exe` and
  `phantombot_desktop-0.4.0-full.nupkg`.
- The packaged `PhantomBot.exe` launched, remained alive while attached to
  the already-running local PhantomForce service on port 5190, and was then
  stopped cleanly after the smoke probe.
- The local health endpoint remained reachable; no duplicate PhantomForce
  listener was started.

## Operator verification

- Authenticated WebSocket and polling fallback tests passed.
- Exact approval, replay rejection, rollback, receipt, restart recovery, and
  duplicate suppression tests passed.
- Strict TruffleHog scan reported zero verified/unknown findings.
- PhantomBot 0.3.0 previously received signed-in installed-window,
  approval, receipt, reopen, and uninstall/reinstall inspection.

## Unfinished release gates

This artifact is a valid unsigned 0.4.0 build, but release acceptance is not
overstated:

1. The newly built 0.4.0 installer has not yet received a human signed-in
   installed-window inspection.
2. The inspected service on port 5190 is the preserved deployment at commit
   `6ac70a1`, so attaching the 0.4.0 shell to it does not visually prove the
   new WebSocket server code.
3. A successful live Hermes provider task is still absent; the previous live
   turn timed out.
4. Real Termina mission completion is blocked by Claude CLI
   reauthentication and secret-safe shared token provisioning.
5. No signing credential was supplied.

The smallest manual acceptance action is to install the unsigned artifact,
sign in, open PhantomBot, run one harmless approved fixture task against a
service built from the 0.4 branch, confirm live progression and receipt
reopen, then uninstall/reinstall and confirm preserved state.

# PhantomBot 0.3.0 installed desktop verification

Date: 2026-07-26  
Installer: `PhantomBot-0.3.0-unsigned-Setup.exe`  
SHA-256: `69A7AB81DC1F902D18B2F1C4EAA5BB189D7251ECBF2FD2D49D348D190DE1FC1C`  
Authenticode: `NotSigned`

## Installed runtime

- Installed executable: `C:\Users\jorda\AppData\Local\phantombot_desktop\app-0.3.0\PhantomBot.exe`
- The installed app launched successfully and retained the normal PhantomForce authentication gate.
- Port 5190 was already owned by PID 47384. Launching PhantomBot did not replace that listener or create a second listener.
- The existing 5190 service reported commit `6ac70a1020c2d529f82a74e772caf7445d1fce64`; it was intentionally not modified during this verification.
- Hermes ACP connected to installed Hermes Agent 0.17.0.

## Signed-in inspection

A signed-in installed window was inspected through the Electron debugging endpoint against a disposable demo-auth service built from integrated main.

Verified UI states:

- native PhantomBot task rail, multiline composer, task persistence, and activity timeline;
- exact approval payload with project, change, file, command, scope, risk, approve, and deny controls;
- normalized Hermes progress without raw machine-intent markup;
- explicit denied state with no approved execution;
- explicit failed-closed state after a real Hermes provider turn reached the 180-second ACP timeout;
- completed state, verified receipt ID, and memory-saved indicator in a disposable controlled fixture;
- completed session recovered after a full page reload with no approval button and no duplicate execution.

Durable visual evidence:

- `run-evidence/phantombot-0.3.0-approval.png`
- `run-evidence/phantombot-0.3.0-receipt-reopen.png`

The approved disposable fixture produced receipt `receipt-run-ms2eaa14-ysj80b`. Its verified file hash remained `2432E702A18A4125D34CBBF3743BE53024521DEB31EB6C4370B2B653B178E788` and its modification timestamp remained `2026-07-26T22:54:12.6145767Z` after reopening, proving that reopening did not execute the action again.

The controlled fixture is evidence of desktop rendering and governed lifecycle behavior, not a claim that Fake Hermes is a production provider. A separate installed Hermes Agent 0.17.0 provider-backed verification had already completed the real documentation/test/receipt/reopen journey. During this visual pass, one additional real provider turn timed out and failed closed; no repository file was changed.

## Uninstall and reinstall

Before uninstall, the recoverable roaming profile existed and the pre-install backup remained at:

`C:\Users\jorda\AppData\Local\PhantomBotBackups\PhantomBot-profile-before-0.3.0.zip`

Silent Squirrel uninstall exited 0. It removed the application executable and Start Menu shortcut while preserving `C:\Users\jorda\AppData\Roaming\PhantomBot`.

Silent reinstall exited 0. The versioned executable and launcher returned, and the roaming profile remained present with 287 files. The reinstalled app launched, showed the real account-access gate, and reused the pre-existing 5190 listener without duplication.

## Regression repairs found during installed verification

- Completed the declared removal of the stale web Asset Cloud surface after its module had been deleted, preventing a fresh-checkout module 404 from blanking the shell.
- Added regression checks for stale Asset Cloud import/navigation/workspace routes.
- Hid governed machine-intent markup from the user-facing operator timeline.
- Made normalized operator event sequence IDs unique and contiguous even when duplicate analyzing events are suppressed or the transport disconnects after an approval checkpoint.

## Verification

- `npm run test:phantombot-operator`
- `npm run test:command-surface`
- `npm run test:page-worker`
- `npm run build`
- `npm run security:secrets:strict`

All functional/build commands passed. TruffleHog 3.95.9 reported 0 verified and 0 unverified findings.

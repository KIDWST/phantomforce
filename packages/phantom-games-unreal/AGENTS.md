# Phantom Games Unreal Production Rules

- Never open, build, cook, package, or generate assets from the canonical
  `Codex\deployments\phantomforce-live` checkout. That checkout serves the live
  products and must remain clean for hourly fast-forward sync. Use a dedicated
  development worktree and land verified changes through Git.
- Protect `Builds/Windows` and the Unity baseline. Work in versioned `CandidateBuilds` folders.
- Treat missing required art, primitive fallback presentation, broken materials, wrong scale, black/blank frames, and non-gameplay captures as hard failures.
- Use only authored, already-owned, or properly licensed free assets. Record provenance; never scrape credentials or protected downloads.
- Build, launch, and capture each of the four games independently. One passing game cannot mask another failure.
- Routine local promotion follows automatically after the scoped candidate passes compile, package, focused regression, identity/hash, and rollback-readiness gates. Do not require the user to type a release keyword. Preserve a verified rollback checkpoint and restore automatically on failure. Stop for direction only when gates fail or the requested action is destructive outside the approved local game-install target.
- Update `Docs/Production/PHANTOM_CODEX_CHECKPOINT.md` after a substantial run.

# Phantom Unreal Build Notes — V11R6

- `.uproject`: `C:\Users\jorda\Documents\Codex\2026-07-30\hi\work\phantomforce-phantomplay-platform-20260811\packages\phantom-games-unreal\PhantomGames.uproject`
- Engine: `H:\UE_5.8` (5.8.1, CL 56057345).
- Source compilation: PASS.
- Four Windows Shipping cooks/packages: PASS; 0 cook errors observed.
- Candidate ID: V11R6. Legends was selectively rebuilt after adding proof-only edge-scroll suppression.
- Candidate contents: 31 files per game, approximately 911 MB each.
- Validation commandlet: PASS with 0 errors and 4 scalability-priority warnings.
- Live `Builds/Windows`: not modified.

Primary V11R6 source changes: `Private/Strike/PhantomStrikeDirector.cpp`, `Private/Cubetown/CubetownDirector.cpp`, `Private/Legends/PhantomLegendsDirector.cpp`, plus `work/RefreshLegendsCandidate.ps1` outside the package as a selective packaging helper.

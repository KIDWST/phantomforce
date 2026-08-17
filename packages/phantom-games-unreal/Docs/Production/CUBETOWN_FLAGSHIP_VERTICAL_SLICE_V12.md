# CubeTown Flagship Vertical Slice V12

## Player promise

CubeTown opens as a premium third-person dream-fantasy adventure: the player enters Heartstone on a grounded authored road, meets three named friends, restores Wisdom Shrines with Echo energy, fights alongside a summoned creature, and can switch into a persistent architecture mode.

This slice is a production milestone, not a claim that the full game is complete or AAA-shippable.

## Acceptance contract

- PhantomPlay launches the Shipping build from its installed game library, without depending on a source checkout.
- The first controllable frame appears within five seconds on the validation machine.
- The opening road and its shoulders cover the playable first 150 metres; no light-blue void dominates the player path.
- The current objective is always visible with a target name and distance.
- A contextual `[E]` prompt appears beside villagers and dormant shrines.
- The welcome quest uses the actual `[E]` interaction binding; `[F]` remains lock-on.
- The first 90 seconds expose movement, conversation, combat pressure, Echo magic, and the route toward the first Shrine.
- CubeTown packages successfully as a Windows Shipping build and passes the production-world validator.
- The packaged game is launched and played from the installed PhantomPlay desktop application.
- PhantomPlay carries Phantom branding in the executable, desktop shortcut, taskbar/window, and Windows version metadata.

## Evidence required

- Automated test and package logs.
- Installed buildset manifest with hashes and source candidate identifiers.
- Screenshot or recording of the installed PhantomPlay library and CubeTown launched from it.
- Process-path proof that the running `Cubetown.exe` came from the installed PhantomPlay game library.

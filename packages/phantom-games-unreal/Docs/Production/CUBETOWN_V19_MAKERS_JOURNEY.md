# Cubetown V19 — Maker's Journey

## Disposition

Release floor: installed V18R1.

Current work: V19 Maker's Journey review candidate — not promoted.

Promotion remains blocked until compile, cook, source validation, packaged visual proof, real-input playtest, and performance evidence all pass, followed by the owner's exact literal `PROMOTE` authorization.

## V19 upgrade

- Replaces Cubetown's generic Rogue launch mesh with the production modular Mage as the original Maker base.
- Replaces permanent idle playback with state-driven idle, walk, run, airborne, attack, and hit animation selection.
- Preserves the guaranteed upright V8 procedural hero as the fallback if production character assets ever fail to load.
- Keeps the distinctive echo rod visible and makes it respond to guard, sprint, dash, and combo attacks.
- Carries the visual target into the production silhouette with a crimson asymmetric mantle, brass utility belt, maker satchel, rune gauntlet, and movement-reactive costume sway instead of exposing a stock character unchanged.
- Adds three orbiting memory shards and a cyan character light whose intensity responds to movement and combat.
- Adds a designed arrival trail into Heartstone: crimson trees, cyan lanterns, wildflowers, crystal clusters, a storybook arch, and a starting echo companion.
- Upgrades Mira, Rowan, and Pip from gliding static characters to distinct Rogue, Barbarian, and Mage modular silhouettes with real idle/walk animation changes.
- Gives visible echo creatures type-specific color identity and subtle living hover/tilt motion.
- Replaces the dense bottom instruction sentence with a three-tool Maker command deck and removes purple/blue gradient language from the HUD contract.
- Stores both generated original-IP visual targets beside the game source and locks their exact prompts for reproducibility.

## Evidence status

- Source and static gates: PASS — focused V19 regression, V16 Memorycraft validation, V14 portfolio gameplay validation, change-memory guard, JSON parsing, and whitespace checks.
- Unreal compile: PASS — Cubetown Win64 Development and Cubetown Win64 Shipping both compile successfully on Unreal Engine 5.8.1.
- Shipping cook/package: PASS — 4,811 packages cooked with zero errors; staged, IoStore-packed, archived, and copied to isolated `CandidateBuilds/V19R1/cubetown`.
- Candidate contents: 31 files / 1,043,239,268 bytes. Launcher SHA-256 `693F901BF7B4F9DF9E2FF7954E66BF0443F431A16EE5F6E265351C430A6FF2D5`; Shipping binary SHA-256 `7C1B796B67980BB1D7A1B6179E73DB1BFAEACE7DE37E74C1D791F09E2C3F11D9`; content container SHA-256 `18D41EECD1950390A6E36E33EBD6AA823DBC8B76E5CBED8463C9E7B91709130D`; container index SHA-256 `A25CB0003452F5066E884640D3D6A0FE539FF8A048B9943186069A3762F97006`.
- Packaged visual proof: pending; no visible app was launched while the owner was using the machine. A hidden packaged-process smoke launch was not retried after the desktop execution policy rejected it.
- Real-input and performance gates: pending human review.
- Installed build: unchanged V18R1.

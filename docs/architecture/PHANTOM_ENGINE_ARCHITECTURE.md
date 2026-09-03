# Phantom Engine Architecture

PhantomPlay is the platform. Phantom Engine is its integrated creation workspace. The default operator executes project-scoped code changes through the local Codex CLI, with independent file comparison and captured command evidence. The secondary scene prototype uses structured actions.

## AI operator slice — 0.3.10

The default Engine experience is an AI operator, not a manual modeling package. `Play` and `Engine` are the two primary product modes in the upper-right corner. Code remains available as a secondary project action, and the direct scene workbench is behind `Advanced controls`.

An Engine command uses two explicit lanes:

1. OpenRouter or local models produce the build blueprint through existing provider connections. Auto/Codex uses one worker for both planning and execution. Claude multi-file planning is explicitly unavailable until its tool access can be isolated; existing single-file editing is unchanged.
2. A dedicated noninteractive Codex worker implements the request using the workspace-write sandbox, no interactive approvals, and hidden processes. It does not reuse the read-only chat prompt. Online asset research is enabled by default (operator can set `PHANTOM_ENGINE_ALLOW_NETWORK=false`). Server/database/provider secrets are not inherited by the child process.

The server independently hashes project files before/after execution, lists detected changes, and writes a sanitized project-local receipt under `.phantom/engine-runs/`, including after worker failure or cancellation. Build caches, dependencies, saves and receipts are excluded. Comparison is capped at 4,000 files; incomplete scans are explicitly marked and never reported as verified. No automatic backup/rollback is claimed.

Drive/profile roots, missing folders, live deployment roots and folders without a project marker are rejected. Native requests require direct loopback Host/IP, a client header, no browser Origin/fetch metadata and no forwarded address. The account paywall exemption applies only to exact job submission/cancellation routes; the local boundary is still enforced. The primary app edits the corresponding development source instead of the installed deployment.

Submission returns a job ID immediately; the native app polls phase/result and can stop its own worker tree. Duplicate request IDs replay the same job; only one worker can mutate a project at once. Jobs are currently tracked in memory, with durable final receipts. Service restart/reopening does not resume monitoring automatically: unknown jobs are reported as interrupted/untracked and the user must inspect project receipts before retrying. Worker runs are bounded to 30 minutes; the native default is ten minutes. There is no claim of an unattended multi-day game-production scheduler.

Statuses distinguish changes applied, no changes and review required. Command receipts contain observed exit codes/output, not a guarantee of gameplay quality, successful packaging, licensing clearance or deployment. `server/scripts/test-phantomplay-engine-live.ts --live` verifies the real adapter on an isolated fixture; `scripts/test-phantom-engine-offscreen.cjs --live` tests the hidden native WebView through submission, execution, evidence and Connections without touching player data.

Asset sourcing is part of the autonomous command contract: when requested, the executor must obtain actual usable files, accept only license-compatible sources, preserve attribution/license receipts, and integrate assets into the project. It may not save search pages as assets or claim a verified build without command evidence.

## Integrated runtime slices — 0.3.8+

The first production slice lives in the native PhantomPlay shell and proves the shared architecture with both 3D and Canvas projects.

- `PhantomProject → PhantomWorld → PhantomScene` supplies the persisted project/world/scene hierarchy.
- Rich entities use explicit component slots for authored objects, characters, cameras, lights, physics bodies, and systemic capabilities.
- Lightweight simulation entities remain a separate cache-friendly population for formations, crowds, foliage, projectiles, particles, and later RTS-scale workloads.
- `Transform3D` is shared infrastructure with position, rotation, and scale.
- `IRenderBackend` separates world/editor logic from the current proof renderer.
- `PhantomSoftwareBackend` provides original perspective/orthographic primitive projection, basic material shading, lighting, selection, and gizmo output for this slice.
- The Canvas path remains a peer workflow with its own 2D render behavior and lightweight population.
- Projects are stored as versioned `project.phantom.json` documents with backup-before-replace behavior.
- Editor and runtime states are separated in the workspace through Play/Stop; exported modular runtimes remain a later build-system milestone.
- Advanced controls retain structured local creation actions for entities, forests, lights, cameras, systemic objects, and RTS formations.
- RTS Stress runs 2,048 lightweight units with team selection, formation commands, continuous movement/engagement ticks, LOD sampling, and profiler counts.
- FPS Lab uses a true first-person projection path with bounded movement, aiming, weapon-ray intersection, ammo/reload, hit accounting, damage, destruction, and an in-viewport HUD.
- Systems composes Fire, Water, Cold, Electricity, and Force stimuli against generic capabilities. Wet conductive targets amplify electricity without a bespoke object-pair script.

## Module direction

The kernel remains composable. Projects enable only the modules they need:

- `Phantom.Core`
- `Phantom.Render2D` / `Phantom.Canvas`
- `Phantom.Render3D`
- `Phantom.Physics2D` / `Phantom.Physics3D`
- `Phantom.Animation`
- `Phantom.Simulation`
- `Phantom.Navigation.*`
- `Phantom.FPS` / `Phantom.RTS`
- `Phantom.Audio` / `Phantom.VFX` / `Phantom.UI`
- `Phantom.Networking`

## Honest boundary of the current product

The autonomous operator is a real local project-editing, build, and receipt path. It is not a claim that the embedded proof renderer already surpasses mature native renderers. The current backend proves the editor/runtime contract and real 3D scene math; it is not yet a DX12/Vulkan AAA renderer. PBR, skeletal animation, production physics, navigation providers, world streaming, exported runtime stripping, GPU instancing, networking, and versioned plugin APIs remain subsequent runtime milestones. Phantom can already modify projects built on Unreal, Godot, Unity, web runtimes, and other detected stacks through the project-scoped operator lane; engine-native capabilities must continue to extend the interfaces above instead of becoming genre-specific one-offs.

## Next validation order

1. Replace the proof backend behind `IRenderBackend` with a hardware backend while retaining the same world/component contract.
2. Move the validated 2,048-unit RTS tick into a job scheduler and structure-of-arrays production store, then scale toward tens of thousands.
3. Replace FPS Lab's bounded collision proof with physics-provider character sweeps, skeletal weapon animation, and VFX/audio backends.
4. Expand the validated capability rules into data-authored reactions, propagation, and deterministic replay.
5. Validate Canvas performance and iteration against a real PhantomPlay 2D title.

The engine is genre-neutral by design: genres are compositions of primitive capabilities, not hard-coded engine modes.

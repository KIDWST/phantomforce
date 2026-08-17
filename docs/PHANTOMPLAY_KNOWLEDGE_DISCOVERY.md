# PhantomPlay knowledge and discovery layer

This layer gives PhantomPlay an evidence-driven, project-aware research loop without granting research code permission to alter production.

## Search order

1. Existing PhantomPlay systems for the selected project.
2. Current official documentation for the project's declared engine.
3. Official samples and repositories for that engine.
4. Curated, licensed open-source references.
5. Primary technical research.
6. Middleware candidates.
7. Licensed asset libraries.

The curated source index is `docs/phantomplay-production/knowledge-sources.json`. Records include ownership, trust tier, URL, categories, compatible engines and versions, license context, maintenance state, practical use, and cautions. Unreal and Unity are both first-class; engine-agnostic research remains available to every project.

## Implemented tools

- Game Development Knowledge Search ranks local evidence and exposes project-specific coverage gaps.
- Multi-Engine GitHub Scout scores official and community candidates by engineering value, never by stars.
- Middleware Scout and Asset Scout use the same licensed evidence model.
- Research Scout converts paper records into engine-specific implementation summaries.
- Dependency Sandbox emits the mandatory twelve-step gate using the selected engine and never authorizes integration before the steps are performed.
- Unreal Profiling Toolkit reports Unreal Insights, stat-command, GPU-profiler, Memory Insights, RenderDoc, NVIDIA Nsight Graphics, and AMD Radeon GPU Profiler readiness.
- Unity Profiling Toolkit remains available for Unity projects and reports Profiler, Profile Analyzer, Memory Profiler, Frame Debugger, Rendering Debugger, and external GPU tools.

## Safety boundaries

- Searches are local and read-only.
- No repository, package, paper, middleware, or asset is downloaded automatically.
- No external code, installer, editor script, or demo is executed automatically.
- A declared license is evidence to inspect, not permission to bypass the dependency sandbox.
- Research decisions never claim that implementation, playtesting, visual QA, profiling, or builds occurred.
- Live GitHub and paper-index refresh are not configured and are reported as unavailable.

## Repository scoring

The score uses license, maintenance, documentation, code quality, selected-engine compatibility, security, performance, relevance, integration cost, and lock-in risk. Integration cost and lock-in are penalties. Missing license evidence is a hard rejection. GitHub stars are optional context and are excluded from the score. Earlier `unity_compatibility` score payloads remain readable as a backward-compatible alias.

## Large-crowd navigation decision

For an Unreal request such as 500-unit RTS navigation, the current decision is to prototype tiled flow-field global navigation, local avoidance, and formation slots using cache-friendly C++ data and Unreal task-graph jobs. It must be benchmarked against Unreal Navigation System/NavMesh at 100, 250, 500, and 1000 units before Mass Entity or Mass AI is considered. Unity projects retain their Unity Navigation and Jobs/Burst comparison path.

## Verification

```powershell
npm run test:phantomplay-discovery
npm run typecheck --workspace @phantomforce/server
```

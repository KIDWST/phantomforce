# PhantomPlay AI V15 — Built-in Unreal Development Brain

PhantomPlay no longer needs a ChatGPT conversation to perform normal AI-assisted game-development work.
This update adds a project-local AI agent that can inspect/edit the real repository, run safe existing build/validation scripts, and drive the live Unreal Editor through Unreal Engine 5.8's official Unreal MCP server.

## One-click use

Double-click `START-PHANTOMPLAY-AI.bat` in the project root.

It opens:

- PhantomPlay AI UI: `http://127.0.0.1:8765`
- Unreal MCP: `http://127.0.0.1:8000/mcp`

On first use, paste an OpenRouter API key in the UI and click **Save AI Settings**. The key is stored under `Saved/PhantomAI` using Windows DPAPI, not committed to the project.

The default model is `openrouter/auto`. The UI also queries OpenRouter for current models that support tool calling, so the model choice is not hard-coded to an obsolete provider/version.

## What the agent can do

- Understand the protected four-game portfolio: PhantomStrike, Phantom Ages, Phantom Legends, and CubeTown.
- Search and read C++, headers, configs, Python, PowerShell, build scripts, production docs, and other text project files.
- Edit source/config/text files in Builder mode with automatic per-session backups.
- Show git status/diffs without making destructive Git changes.
- Run existing project Python/PowerShell validation/build scripts and npm scripts through a restricted command runner.
- Launch UE5.8 with `-ModelContextProtocolStartServer` and connect to the live editor.
- Discover the exact Unreal MCP tool schemas at runtime, then invoke editor tools for actors, scenes, materials, automation, and other engine capabilities exposed by UE5.8.
- Use the included `PhantomPlayAITools` Unreal Python Toolset for portfolio-aware editor context.
- Roll back source/config edits made during the current AI session from the UI.

## Safety model

The local UI binds only to `127.0.0.1`. Unreal MCP also stays on the UE default loopback endpoint. The agent cannot escape the project root with file tools. Binary `.uasset` and `.umap` work is routed through Unreal MCP rather than overwritten as raw files. Destructive shell chaining, filesystem deletion commands, downloads, `git reset --hard`, and `git clean` are blocked by the local command runner.

Builder mode is intentionally capable: it can edit files and run existing project validation/build scripts. Read-only mode is available from the UI when you want analysis without writes.

## Unreal 5.8 integration

The installer enables these project plugins:

- `ModelContextProtocol` (Unreal MCP)
- `ToolsetRegistry`
- `AllToolsets`
- `PythonScriptPlugin`
- `EditorScriptingUtilities`
- `PhantomPlayAITools`

The launcher starts the editor with the documented UE5.8 MCP command-line flags, so you do not have to manually toggle Auto Start every session.

## Verification

Static Python syntax and update-package integrity can be verified outside Unreal. Actual Unreal MCP availability, editor tool schemas, compilation, PIE/gameplay, packaging, and visual results must be verified on the Windows UE5.8 machine because those require the installed engine and live project.

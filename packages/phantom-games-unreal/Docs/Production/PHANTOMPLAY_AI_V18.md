# PhantomPlay AI V18 — One Intelligent Workspace

PhantomPlay AI uses one conversation for questions, investigation, source changes, validation, and live Unreal work. The user never has to switch between answer, build, research, or operate modes.

## AI engines

The sidebar exposes a single engine connection with four choices:

- Local AI through a localhost OpenAI-compatible endpoint, including Ollama-compatible servers.
- OpenAI / Codex models through the OpenAI API.
- Anthropic Claude through the native Anthropic Messages API.
- OpenRouter and its current tool-capable model catalog.

Each provider lists models from its live API. Provider keys are saved separately with Windows DPAPI and are never written to repository files. Local AI requires no key and is restricted to a localhost endpoint.

## One conversation

The selected model receives the same portfolio-aware tools and project context. It infers whether the user is asking for an answer or authorizing an implementation. Source writes remain session-backed-up, risky shell operations remain blocked, and binary maps/assets continue to route through Unreal MCP.

## Verification contract

The local self-test verifies the project, all four targets, and sandbox path containment. Provider adapters, source syntax, Unreal compilation, content generation, packaged launch, and gameplay evidence are separate gates; none may be represented as passing until actually run.

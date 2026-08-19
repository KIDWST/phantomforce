# Provider Health Report

Live packaged state on 2026-08-16:

- Desktop ↔ gateway: connected.
- Phantom provider: enabled at the local Ollama OpenAI-compatible endpoint.
- Installed Ollama profiles: `phantom:latest` and `phantom-unleashed:latest` are present.
- Explicit Phantom request: started `ollama.exe serve` and loaded `phantom:latest` locally.
- Paid/browser bridges: not used by the smoke test.
- Model selector: shows both public Phantom profiles.

Truthful warning retained: the user's global Settings default still references disabled legacy provider `ollama-launch`, so setup diagnostics report `Inference not ready` even though the manually pinned Phantom session can start local inference. This is configuration drift, not hidden provider substitution; it remains visible instead of being falsely marked healthy.

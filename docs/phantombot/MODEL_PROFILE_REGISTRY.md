# Model Profile Registry

| Public profile | Provider | Runtime model | Default request context | Identity |
| --- | --- | --- | ---: | --- |
| Phantom | `phantom` | `phantom` / `phantom:latest` | 65,536 for normalized installs; explicit user overrides are preserved | Phantom |
| Phantom Unleashed | `phantom` | `phantom-unleashed` / `phantom-unleashed:latest` | 65,536 for normalized installs; model supports 262,144 | Phantom Unleashed |

Registry seams:

- `hermes_cli.config._normalize_phantom_model_profiles` installs the two canonical entries only for Phantom installs.
- `hermes_cli.inventory` exposes both public model IDs.
- `agent.ollama_runtime` handles explicit local startup and request-local context.
- `agent.system_prompt` injects the matching stable identity guard at session construction.
- Desktop labels map raw IDs to `Phantom` and `Phantom Unleashed`.

The packaged model selector visibly presents both profiles under a single `PHANTOM` group. Reselecting the active profile does not reconfigure the gateway or append a new model marker.

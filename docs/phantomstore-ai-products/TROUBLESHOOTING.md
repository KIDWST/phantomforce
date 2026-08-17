# Troubleshooting

- **Port 4182 is occupied:** set `PORT` to another unused local port.
- **Authentication required:** use a fixed `ai-demo-*` Bearer token; these are fixtures, not passwords.
- **Consent required:** an owner must grant consent independently for the selected product.
- **Idempotency required:** retryable API mutations need a unique `Idempotency-Key`; reusing a key returns the remembered result.
- **Revision conflict:** reload and apply the edit to the newest artifact revision.
- **Analysis paused:** inspect product `analysisEnabled` and `jobsEnabled` flags; source work remains available.
- **Analysis stale:** consent was withdrawn or the source revision changed. Review the source before generating another run.
- **Schema too new:** stop and use a compatible package version or restore a compatible backup.
- **Reset demo:** stop the service, move the exact `.local` JSON file to a backup location, and run migration. Never delete an unverified path.

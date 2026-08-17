# Security and tenancy report

## Passed

- Authentication boundaries
- Organization record isolation across two organizations
- Organization Settings boundaries
- CRM tenant isolation
- PhantomPlay non-touch scope guard
- Strict TruffleHog scan (`verified,unknown`) with zero findings
- Production Core backend policy checks at approval and publication time
- Production Core cross-organization denial
- Production dependency audit with zero known vulnerabilities

No credentials, tokens, cookies, or production data were written to reports. No production provider mutation was performed.

## Tool provenance

TruffleHog 3.97.0 was downloaded from the official release and its Windows archive SHA-256 was verified before extraction. The binary and scan evidence remain in ignored local-only directories.

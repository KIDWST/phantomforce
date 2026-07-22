# Defensive Seatbelt posture adapter

## Decision

GhostPack Seatbelt is beneficial for the PhantomForce platform operator’s own Windows host, but it is not a customer feature and is not a general-purpose scanner inside the product. Seatbelt describes itself as a host-survey tool for offensive and defensive use; its normal command groups include browser history, saved credentials, cloud credential files, PowerShell history, and remote WMI enumeration. Those collection paths must never enter PhantomForce.

The adapter therefore runs only a small, local posture subset: antivirus, Credential Guard, Secure Boot, UAC, Windows Defender, and Windows Firewall. Each is converted into a narrow normalized signal; no unused broad-survey module runs. It accepts no browser-provided command, target, path, or remote host.

## Safety contract

- Platform-operator/admin session only; no customer endpoint or tenant result.
- Disabled by default and requires the exact confirmation phrase `RUN_LOCAL_SEATBELT_POSTURE` per run.
- A server-side absolute executable path and matching SHA-256 pin are required.
- No remote enumeration, credential collection, browser-data collection, user-file discovery, external network call, remediation, raw-output response, or raw-output persistence.
- The response contains only normalized `pass`, `review`, or `unknown` posture signals. It is not a claim of full compliance or host security.

## Operator setup

1. Obtain and review Seatbelt source from the official GhostPack repository at a chosen commit. Seatbelt publishes source and documents building the executable rather than distributing official binaries.
2. Build or place the reviewed `Seatbelt.exe` outside this repository, in an operator-controlled directory.
3. Calculate its SHA-256 and set these server-only environment variables:

   ```text
   PHANTOMFORCE_SEATBELT_POSTURE_ENABLED=true
   PHANTOMFORCE_SEATBELT_PATH=C:\ProgramData\PhantomForce\tools\Seatbelt.exe
   PHANTOMFORCE_SEATBELT_SHA256=<64-character lowercase sha256>
   PHANTOMFORCE_SEATBELT_TIMEOUT_MS=45000
   ```

4. Restart the server, check `GET /phantom-ai/security/host-posture/seatbelt/status` as a platform operator, then explicitly call the run endpoint with the required confirmation phrase.
5. Review only the normalized findings. If a check is `unknown`, inspect the machine through approved administrator tooling instead of broadening the allowlist.

## Maintenance

When changing the binary, update the hash pin in the same server change. Do not enable bulk groups, full output, output-file mode, remote targets, credential modules, browser modules, history modules, or user-file search modules.

Source: [GhostPack/Seatbelt](https://github.com/GhostPack/Seatbelt) (BSD 3-Clause).

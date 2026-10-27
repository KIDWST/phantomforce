# Bambu Studio capture for Occasionally Odd

Owner request: automatically retain every available Bambu print package in Occasionally Odd and make cost and selling decisions useful without repeated data entry. Chosen market: **US / USD, local and custom orders**. Release build: `phantom-live-20261026-245`.

## What is connected

Occasionally Odd Production and Finance include a durable Bambu print feed above the existing ad hoc file analyzer. The top Print analysis button opens Production in this business. Other businesses retain the local file tool. Capture runs inside the existing API process and stops with it; no Windows scheduled task or separate service is installed.

The owner explicitly enables this PC through `ops/admin-live/Set-BambuCapture.ps1`. Its local marker contains only a schema version, enable flag and the exact tenant `occasionally-odd`. The watcher reads the verified Bambu temporary backup roots, classifies generated `Metadata/.PID.N.3mf` artifacts by the presence of sliced Gcode, waits for stable writes and stores a content-addressed archive. It never executes Gcode, launches a slicer, changes printer settings or reads encrypted logs, account stores or access codes.

Archives and the atomic journal default to `%LOCALAPPDATA%/PhantomForce/print-runs`, outside the deployment checkout. `PHANTOMFORCE_PRINT_RUNS_ROOT` can select another server storage root. `PHANTOMFORCE_BAMBU_CAPTURE=0` disables the connector. Downloads require an authenticated Occasionally Odd owner/administrator, use registered receipt IDs and verify the archive SHA-256. API responses retain whitelisted technical metadata and omit source paths and raw project settings.

File hashes deduplicate archive storage; independently identified observations preserve repeat sends of identical files. Startup reconciliation does not fabricate new receipts for an unchanged file. Captured files survive Bambu cleanup and server restarts. Pause/resume is a saved business setting. Unsupported or unreadable candidates remain an explicit coverage concern.

## Evidence and honest coverage

Installed Bambu Studio was verified as **02.08.02.61**. Its [print dialog](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/slic3r/GUI/SelectMachine.cpp#L3167) and [send-to-SD dialog](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/slic3r/GUI/SendToPrinter.cpp#L831) both generate the watched package before network success. A generated file therefore proves **prepared package**, not submitted, printing, completed or sold. Bambu's [printer state handler](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/slic3r/GUI/DeviceManager.cpp#L3179) exposes task/state concepts, but no legitimate printer-state connection has been configured here.

One real generated send package was inspected read-only: **37.77 g white PLA, 13,305 seconds (3 h 41 m 45 s), supports, 0.4 mm nozzle**. Slice metadata and the Gcode header agreed. Bambu deleted that package before the new collector was enabled; it was not archived or imported and must not be represented as a completed print. A later recovery archive confirmed a readable project-title source. Recovery `.3mf` files without sliced send evidence are excluded from automatic print history.

Printer reprints, cloud starts, direct imported Gcode3MF paths and artifacts removed while the API is off can bypass this source. The UI reports this boundary. A genuine hardware/cloud connection is the next step toward complete print coverage; encrypted logging is not a supported shortcut.

## Decision intelligence

New captures automatically expose slice mass/time, materials/colors, support flags, readable titles when present, a cost breakdown, break-even revenue, target-margin revenue and a printer-hour return target. Insights identify support cleanup, multi-filament complexity, capacity occupied by long prints, missing yield and the limiting price threshold.

Shop rates are reusable and optional to confirm once. Example USD assumptions remain visibly illustrative. Exact saved material costs replace generic rates only when identity, unit and complete filament-mass accounting match; slicer preset costs with unknown currency are not treated as USD. Failure allowance applies to production costs/time; finishing, packaging and fixed fees are charged once per complete project. A reusable product mapping can record saleable yield and additional nonprinted parts. Part count is never product count. Multi-plate assembly completeness requires an explicit mapping.

Cost-derived price targets are planning estimates. They are not claims about competitive prices, demand, settled profit or completed production. Optional comparable evidence stores a public source, observation date, USD item/delivery price, pack quantity, comparability review and asking/sold classification. Asking prices and reported sales remain separate, and small samples stay limited. No unattended marketplace integration, public listing or private model upload to a third party is created. Local/custom fees default to zero as an unconfirmed scenario, not a statement about every payment channel.

## Verification and undo

The release tests cover bounded stored/deflated ZIPs, malformed XML/entities, expansion limits, CRC, archive corruption, synthetic authenticated route boundaries, distinct repeat observations, restart idempotence, interrupted writes, source classification, pause/resume, missing source and safe source-path omission. Browser tests exercise the actual commerce mount and reusable settings at desktop/mobile widths, including stale scope suppression. **All 66 release-critical checks passed**, including 568 change-memory checks. Full live-source outcomes are recorded in the shared Obsidian continuation note.

Undo capture immediately with **Pause capture** in the feed. To disable it across API restarts, run `ops/admin-live/Set-BambuCapture.ps1 -Disable` and restart the existing API. Neither action deletes history. A code rollback reverts this release commit and syncs the canonical live checkout. Keep `%LOCALAPPDATA%/PhantomForce/print-runs` for recovery; no orders, inventory, printer jobs or organization memberships are mutated by imports.

# Hermes Learning Lane

Hermes can learn from PhantomForce work in two stages:

1. **Local learning examples now**
   - PhantomAI runs are auto-captured as redacted, tenant-scoped, unreviewed learning examples.
   - Jordan/admin can save approved Codex, Claude, PhantomAI, or manual examples.
   - Examples live locally in `.phantom/hermes-learning-examples.jsonl` by default.

2. **Fine-tuning later**
   - Fine-tune export is preview-only here.
   - Default export includes only examples marked `approved_for_finetune:true` with `approved` or `corrected` quality.
   - Unreviewed examples can be previewed only when explicitly requested.

## Storage

The learning lane stores redacted summaries, not raw full transcripts, screenshots, videos, cookies, API keys, or media files.
That keeps storage small: thousands of examples should usually be measured in megabytes, not gigabytes.

## Safety Rules

- Local/dev file only by default.
- Production writes are blocked.
- Tenant/user scope is preserved.
- Raw secrets are redacted before persistence.
- Raw prompts and full transcripts are not stored by this lane.
- Provider calls, network calls, approval execution, queue writes, production ledger writes, and external actions remain blocked.
- Fine-tune export is gated by explicit approval labels.

## Admin Endpoints

- `GET /phantom-ai/hermes/learning-dataset/status`
- `GET /phantom-ai/hermes/learning-dataset/history`
- `POST /phantom-ai/hermes/learning-dataset/save-example`
- `POST /phantom-ai/hermes/learning-dataset/export-preview`

## Useful Environment Flags

- `PHANTOM_HERMES_LEARNING_DATASET_PATH`
  - Overrides the local JSONL dataset path.
- `PHANTOM_HERMES_LEARNING_CAPTURE_ENABLED=false`
  - Disables learning capture.

## Recommended Training Workflow

1. Let Hermes collect unreviewed local examples from normal PhantomAI work.
2. Mark strong Codex/Claude/PhantomAI answers as approved examples.
3. Add Jordan corrections as `corrected` examples with an ideal response.
4. Run export preview and inspect the JSONL.
5. Fine-tune only after the eval set proves Hermes is answering safely and usefully.

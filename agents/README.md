# Explain commentary: reproducible workflow

The core authoring workflow is the same Analyst → Commentator → checks → Editor cycle used for Pitch Pilot's
directed commentary. This public entry point supplies an invented fact sheet rather than importing private data
adapters. It separates the orchestration from match preprocessing.

## Offline verification

From the repository root:

```sh
uv sync --project agents --frozen
uv run --project agents python agents/example.py
uv run --project agents python -m unittest discover -s agents/tests
```

`example.py` uses `DryTeam`, scripted responses and `EstimatedMeter`. No models are called, no speech is synthesized,
and no cloud account is needed. The first opening passage exceeds its budget. The Editor sends it back, the
Commentator shortens it, and the next round preserves the already accepted reception passage. The trace is written
to `artifacts/agent-example.json`, which is ignored by Git.

This verifies workflow execution, shared state, selective revision and unresolved-output reporting. It does not
measure model quality, production speech timing or live Foundry connectivity.

## Optional live Foundry execution

The same invented fixture can be sent to an existing authorized Foundry project. Install Azure CLI separately,
sign in to the intended account, and configure the empty fields in `.env.example` in a local `.env` file:

- `AZURE_AI_PROJECT_ENDPOINT`
- `AZURE_AI_MODEL_DEPLOYMENT`, or per-role `AZURE_AI_MODEL_ANALYST`, `AZURE_AI_MODEL_COMMENTATOR`, `AZURE_AI_MODEL_EDITOR`
- `AZURE_TENANT_ID` when needed

Then explicitly choose a live mode:

```sh
uv run --project agents python agents/example.py --mode local
# or: published prompt-agent versions, which creates versions in your Foundry project
uv run --project agents python agents/example.py --mode foundry
```

Both modes may incur model charges. `local` means in-process orchestration calling Foundry; it does **not** mean an
offline model. `foundry` creates prompt-agent versions. Neither command provisions a resource or uploads match
data. This example still estimates speech duration; the production speech module is available separately but is
not called automatically.

## Evidence in the source

| Concern | Implementation |
|---|---|
| Distinct roles and structured responses | `pitch_agents/roles.py` |
| Shared state, iteration and selective handoffs | `pitch_agents/workflow.py` |
| Service retries and invalid JSON handling | `pitch_agents/team.py` |
| Names, numbers, wording, timing and subtitle checks | `pitch_agents/checks.py` |
| Azure Speech synthesis and measured timing | `pitch_agents/speech.py` |
| Reproducible revision and round-limit tests | `tests/test_example.py` |

The automatic checks are guardrails, not a factual guarantee. Unresolved passages remain marked in the output.
Human approval is required before using such passages in a production narration.

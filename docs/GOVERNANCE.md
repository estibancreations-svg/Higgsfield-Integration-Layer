# Governance

## Audit Coverage

Every route emits a structured event with:
- action
- actor
- source system
- success/failure status
- resource identifier
- route-specific metadata

## Accountability Model

- Requests identify the upstream system (`triggeredBy`) for architect accountability.
- Generation parameters are stored in `job_state.generation_parameters` for reproducibility.
- Credit checks and budget decisions are recorded in `credit_transactions`.

## Query Patterns

- **Who triggered a job?** Query `job_state.triggered_by` by `job_id`.
- **What did a project spend?** Sum `credit_transactions.amount` by project-linked workflow event history.
- **Which assets came from a campaign?** Filter `media_library.project_association` and inspect `provenance_chain`.

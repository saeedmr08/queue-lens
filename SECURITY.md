# Security

QueueLens is a **local portfolio demo**. It does not persist jobs, open network workers, or authenticate users.

## Data handling

- Job payloads exist only in process memory for the browser/session lifetime.
- Known secret-shaped keys are replaced with `[REDACTED]` at enqueue (`password`, `token`, `secret`, `ssn`, `authorization`, `apiKey`, `api_key`).
- Redaction is best-effort string-key matching — not a substitute for a production secrets vault.

## Threat notes

- Do not paste real credentials into the demo payload editor.
- There is no multi-tenant isolation; treat the UI as a single-operator sandbox.
- Dead-letter inspection may still show non-secret fields from your demo payloads.

## Reporting

This is educational software. For issues in this repository, contact the author via the portfolio listing.

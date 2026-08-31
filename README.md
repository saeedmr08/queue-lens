# QueueLens

Job queue ops console by **Saeed Rumaneh**. Enqueue work, drain with retries and exponential backoff, and inspect lanes for pending / active / completed / failed / dead-letter jobs. Sensitive payload fields are redacted at enqueue time. Jobs persist to `data/queue.json` via Next.js API routes.

## Features

- FIFO claim of due jobs (`pending` or retrying `failed`)
- Configurable `maxAttempts` and base backoff
- Nested payload redaction for secrets / tokens / keys
- JSON persistence + `/api/jobs` (enqueue, process, retry)
- Ops-console UI wired with `fetch`

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/jobs` | List jobs + counts |
| POST | `/api/jobs` | Enqueue `{ name, payload }` or `{ action: "process" }` |
| POST | `/api/jobs/:id/retry` | Re-queue failed / dead-letter |

## Stack

Next.js 15 · React 19 · TypeScript · Vitest

## Scripts

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

## Library

Core logic: [`lib/queue.ts`](lib/queue.ts) · Persistence: [`lib/store.ts`](lib/store.ts) · Tests: [`__tests__/queue.test.ts`](__tests__/queue.test.ts)

Runtime data under `data/` is gitignored.

## Complete product flows

1. Enqueue a job (or “Enqueue flaky”) — payload secrets are redacted and the job lands in pending.
2. Click **Process** or **Process all pending** — due jobs move through active → completed / failed.
3. Click **Retry** on a failed or dead-letter job — it returns to pending and persists in `data/queue.json`.

## License

MIT © 2026 Saeed Rumaneh

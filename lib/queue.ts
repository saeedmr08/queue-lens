/**
 * QueueLens — job queue with retries, backoff, and payload redaction.
 * Persistence lives in lib/store.ts (data/queue.json) via the API.
 */

export type JobStatus =
  | "pending"
  | "active"
  | "completed"
  | "failed"
  | "dead-letter";

export type JobPayload = Record<string, unknown>;

export interface Job {
  id: string;
  name: string;
  payload: JobPayload;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number;
  lastError?: string;
  result?: unknown;
}

export interface QueueOptions {
  maxAttempts?: number;
  baseBackoffMs?: number;
  redactKeys?: string[];
  now?: () => number;
  idFactory?: () => string;
}

export interface EnqueueInput {
  name: string;
  payload: JobPayload;
  maxAttempts?: number;
  delayMs?: number;
}

export interface ProcessResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export type JobHandler = (
  job: Job,
) => ProcessResult | Promise<ProcessResult>;

const DEFAULT_REDACT = [
  "password",
  "token",
  "secret",
  "ssn",
  "authorization",
  "apiKey",
  "api_key",
];

let seq = 0;

function defaultId(): string {
  seq += 1;
  return `job_${seq.toString(36)}_${Date.now().toString(36)}`;
}

/** Deep-clone payload and replace sensitive keys with [REDACTED]. */
export function redactPayload(
  payload: JobPayload,
  keys: string[] = DEFAULT_REDACT,
): JobPayload {
  const lower = new Set(keys.map((k) => k.toLowerCase()));
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = lower.has(k.toLowerCase()) ? "[REDACTED]" : walk(v);
      }
      return out;
    }
    return value;
  };
  return walk(payload) as JobPayload;
}

export function computeBackoffMs(
  attempt: number,
  baseMs: number,
): number {
  const n = Math.max(0, attempt);
  return baseMs * Math.pow(2, n);
}

export class JobQueue {
  private jobs = new Map<string, Job>();
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly redactKeys: string[];
  private readonly now: () => number;
  private readonly idFactory: () => string;

  constructor(options: QueueOptions = {}, seed: Job[] = []) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseBackoffMs = options.baseBackoffMs ?? 1000;
    this.redactKeys = options.redactKeys ?? DEFAULT_REDACT;
    this.now = options.now ?? (() => Date.now());
    this.idFactory = options.idFactory ?? defaultId;
    for (const job of seed) {
      this.jobs.set(job.id, {
        ...job,
        payload: { ...job.payload },
      });
    }
  }

  enqueue(input: EnqueueInput): Job {
    const t = this.now();
    const job: Job = {
      id: this.idFactory(),
      name: input.name,
      payload: redactPayload(input.payload, this.redactKeys),
      status: "pending",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? this.maxAttempts,
      createdAt: t,
      updatedAt: t,
      nextRunAt: t + (input.delayMs ?? 0),
    };
    this.jobs.set(job.id, job);
    return { ...job, payload: { ...job.payload } };
  }

  get(id: string): Job | undefined {
    const j = this.jobs.get(id);
    return j ? { ...j, payload: { ...j.payload } } : undefined;
  }

  list(status?: JobStatus): Job[] {
    const all = [...this.jobs.values()].map((j) => ({
      ...j,
      payload: { ...j.payload },
    }));
    const filtered = status ? all.filter((j) => j.status === status) : all;
    return filtered.sort((a, b) => a.createdAt - b.createdAt);
  }

  counts(): Record<JobStatus, number> {
    const base: Record<JobStatus, number> = {
      pending: 0,
      active: 0,
      completed: 0,
      failed: 0,
      "dead-letter": 0,
    };
    for (const j of this.jobs.values()) base[j.status] += 1;
    return base;
  }

  /** Claim the next due pending/failed job (FIFO by nextRunAt). */
  claimNext(): Job | undefined {
    const t = this.now();
    const due = [...this.jobs.values()]
      .filter(
        (j) =>
          (j.status === "pending" || j.status === "failed") &&
          j.nextRunAt <= t,
      )
      .sort((a, b) => a.nextRunAt - b.nextRunAt || a.createdAt - b.createdAt);
    const job = due[0];
    if (!job) return undefined;
    job.status = "active";
    job.attempts += 1;
    job.updatedAt = t;
    return { ...job, payload: { ...job.payload } };
  }

  complete(id: string, result?: unknown): Job {
    const job = this.require(id);
    if (job.status !== "active") {
      throw new Error(`Job ${id} is ${job.status}, expected active`);
    }
    const t = this.now();
    job.status = "completed";
    job.result = result;
    job.updatedAt = t;
    job.lastError = undefined;
    return { ...job, payload: { ...job.payload } };
  }

  /**
   * Mark failure. Retries with exponential backoff while attempts < maxAttempts.
   * Otherwise moves to dead-letter.
   */
  fail(id: string, error: string): Job {
    const job = this.require(id);
    if (job.status !== "active") {
      throw new Error(`Job ${id} is ${job.status}, expected active`);
    }
    const t = this.now();
    job.lastError = error;
    job.updatedAt = t;
    if (job.attempts < job.maxAttempts) {
      // Remains claimable after backoff; visible as failed until then.
      job.status = "failed";
      job.nextRunAt = t + computeBackoffMs(job.attempts - 1, this.baseBackoffMs);
    } else {
      job.status = "dead-letter";
    }
    return { ...job, payload: { ...job.payload } };
  }

  /** Explicit move to dead-letter without retry. */
  deadLetter(id: string, error?: string): Job {
    const job = this.require(id);
    const t = this.now();
    job.status = "dead-letter";
    job.updatedAt = t;
    if (error) job.lastError = error;
    return { ...job, payload: { ...job.payload } };
  }

  /** Re-queue a failed or dead-letter job for immediate claim. */
  retry(id: string): Job {
    const job = this.require(id);
    if (job.status !== "failed" && job.status !== "dead-letter") {
      throw new Error(`Job ${id} is ${job.status}, expected failed or dead-letter`);
    }
    const t = this.now();
    job.status = "pending";
    job.nextRunAt = t;
    job.updatedAt = t;
    job.lastError = undefined;
    return { ...job, payload: { ...job.payload } };
  }

  /** Process one due job with a handler. */
  async processOne(handler: JobHandler): Promise<Job | undefined> {
    const claimed = this.claimNext();
    if (!claimed) return undefined;
    try {
      const outcome = await handler(claimed);
      if (outcome.ok) return this.complete(claimed.id, outcome.result);
      return this.fail(claimed.id, outcome.error ?? "handler rejected");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.fail(claimed.id, msg);
    }
  }

  /** Snapshot safe for UI / logs (already redacted at enqueue). */
  snapshot(): Job[] {
    return this.list();
  }

  private require(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Unknown job ${id}`);
    return job;
  }
}

export function createQueue(options?: QueueOptions, seed: Job[] = []): JobQueue {
  return new JobQueue(options, seed);
}

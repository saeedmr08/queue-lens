import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createQueue, type Job, type JobQueue, type QueueOptions } from "./queue";

const DATA_FILE = path.join(process.cwd(), "data", "queue.json");

type QueueFile = { jobs: Job[] };

function seedJobs(): Job[] {
  const t = Date.now();
  return [
    {
      id: "job_seed_notify",
      name: "notify.user",
      payload: { userId: "u_seed", channel: "email", token: "[REDACTED]" },
      status: "pending",
      attempts: 0,
      maxAttempts: 3,
      createdAt: t - 60_000,
      updatedAt: t - 60_000,
      nextRunAt: t - 60_000,
    },
    {
      id: "job_seed_report",
      name: "report.daily",
      payload: { day: "yesterday" },
      status: "completed",
      attempts: 1,
      maxAttempts: 3,
      createdAt: t - 120_000,
      updatedAt: t - 90_000,
      nextRunAt: t - 120_000,
      result: { processed: true },
    },
  ];
}

function readJobs(): Job[] {
  try {
    const raw = JSON.parse(readFileSync(DATA_FILE, "utf8")) as QueueFile | Job[];
    const jobs = Array.isArray(raw) ? raw : (raw.jobs ?? []);
    if (jobs.length > 0) return jobs;
    const seeded = seedJobs();
    writeJobs(seeded);
    return seeded;
  } catch {
    const seeded = seedJobs();
    writeJobs(seeded);
    return seeded;
  }
}

function writeJobs(jobs: Job[]): void {
  mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, `${JSON.stringify({ jobs }, null, 2)}\n`);
}

export function loadQueue(options?: QueueOptions): JobQueue {
  return createQueue(options, readJobs());
}

export function saveQueue(queue: JobQueue): void {
  writeJobs(queue.snapshot());
}

export function withQueue<T>(
  fn: (queue: JobQueue) => T | Promise<T>,
  options?: QueueOptions,
): Promise<T> {
  const queue = loadQueue({
    maxAttempts: 3,
    baseBackoffMs: 800,
    ...options,
  });
  return Promise.resolve(fn(queue)).then((result) => {
    saveQueue(queue);
    return result;
  });
}

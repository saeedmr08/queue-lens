"use client";

import { useCallback, useEffect, useState } from "react";
import type { Job, JobStatus } from "@/lib/queue";
import styles from "./page.module.css";

const STATUSES: JobStatus[] = [
  "pending",
  "active",
  "failed",
  "completed",
  "dead-letter",
];

type Counts = Record<JobStatus, number>;

const emptyCounts = (): Counts => ({
  pending: 0,
  active: 0,
  completed: 0,
  failed: 0,
  "dead-letter": 0,
});

export default function HomePage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [counts, setCounts] = useState<Counts>(emptyCounts);
  const [name, setName] = useState("notify.user");
  const [payloadJson, setPayloadJson] = useState(
    '{\n  "userId": "u_42",\n  "token": "super-secret",\n  "channel": "email"\n}',
  );
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const pushLog = (line: string) =>
    setLog((prev) =>
      [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 40),
    );

  const applySnapshot = (data: { jobs?: Job[]; counts?: Counts }) => {
    if (data.jobs) setJobs(data.jobs);
    if (data.counts) setCounts(data.counts);
  };

  const refresh = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/jobs");
      if (!res.ok) {
        setError("Failed to load queue");
        pushLog("LOAD failed");
        return;
      }
      applySnapshot((await res.json()) as { jobs: Job[]; counts: Counts });
    } catch {
      setError("Network error loading queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enqueue = async (jobName = name) => {
    setBusy(true);
    setError("");
    try {
      const payload = JSON.parse(payloadJson) as Record<string, unknown>;
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: jobName, payload }),
      });
      const data = (await res.json()) as {
        job?: Job;
        jobs?: Job[];
        counts?: Counts;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Enqueue failed");
        pushLog(`ENQUEUE failed — ${data.error ?? res.status}`);
        return;
      }
      applySnapshot(data);
      pushLog(`ENQUEUE ${data.job?.id} · secrets redacted · persisted`);
    } catch {
      setError("Invalid JSON payload");
      pushLog("ENQUEUE failed — invalid JSON payload");
    } finally {
      setBusy(false);
    }
  };

  const processOne = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process" }),
      });
      const data = (await res.json()) as {
        job?: Job | null;
        jobs?: Job[];
        counts?: Counts;
      };
      applySnapshot(data);
      if (!data.job) pushLog("PROCESS — no due jobs");
      else pushLog(`PROCESS ${data.job.id} → ${data.job.status}`);
    } catch {
      setError("Process failed");
    } finally {
      setBusy(false);
    }
  };

  const processAll = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process-all" }),
      });
      const data = (await res.json()) as {
        count?: number;
        jobs?: Job[];
        counts?: Counts;
      };
      applySnapshot(data);
      pushLog(`PROCESS ALL — ${data.count ?? 0} job(s)`);
    } catch {
      setError("Process all failed");
    } finally {
      setBusy(false);
    }
  };

  const retryJob = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(id)}/retry`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        job?: Job;
        jobs?: Job[];
        counts?: Counts;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Retry failed");
        pushLog(`RETRY failed — ${data.error ?? res.status}`);
        return;
      }
      applySnapshot(data);
      pushLog(`RETRY ${data.job?.id} → pending`);
    } finally {
      setBusy(false);
    }
  };

  const lanes = STATUSES.map((status) => ({
    status,
    items: jobs.filter((j) => j.status === status),
  }));

  if (loading) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>Loading queue lanes…</p>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <header className={styles.mast}>
        <div>
          <p className={styles.eyebrow}>OPS CONSOLE · JSON PERSISTED</p>
          <h1 className={styles.brand}>QueueLens</h1>
          <p className={styles.tag}>
            Watch pending → active → completed lanes. Retries back off; secrets
            never leave the redact path. Jobs live in data/queue.json.
          </p>
        </div>
        <div className={styles.meters}>
          {STATUSES.map((s) => (
            <div key={s} className={styles.meter} data-status={s}>
              <span>{s}</span>
              <strong>{counts[s]}</strong>
            </div>
          ))}
        </div>
      </header>

      {error ? (
        <p className={styles.empty} role="alert">
          {error}
        </p>
      ) : null}

      <section className={styles.controls}>
        <label>
          Job name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={styles.payload}>
          Payload JSON
          <textarea
            value={payloadJson}
            onChange={(e) => setPayloadJson(e.target.value)}
            rows={6}
          />
        </label>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            disabled={busy}
            onClick={() => void enqueue()}
          >
            Enqueue
          </button>
          <button type="button" disabled={busy} onClick={() => void processOne()}>
            Process
          </button>
          <button type="button" disabled={busy} onClick={() => void processAll()}>
            Process all pending
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setName("task.fail");
              void enqueue("task.fail");
            }}
          >
            Enqueue flaky
          </button>
          <button type="button" disabled={busy} onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </section>

      {jobs.length === 0 ? (
        <p className={styles.empty}>
          Queue is empty — enqueue a job to populate the lanes.
        </p>
      ) : (
        <section className={styles.board}>
          {lanes.map((lane) => (
            <div key={lane.status} className={styles.lane} data-status={lane.status}>
              <h2>
                {lane.status}
                <span>{lane.items.length}</span>
              </h2>
              <ul>
                {lane.items.length === 0 ? (
                  <li className={styles.emptyLane}>No {lane.status} jobs</li>
                ) : (
                  lane.items.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      onRetry={
                        job.status === "failed" || job.status === "dead-letter"
                          ? () => void retryJob(job.id)
                          : undefined
                      }
                    />
                  ))
                )}
              </ul>
            </div>
          ))}
        </section>
      )}

      <aside className={styles.tape}>
        <h2>Event tape</h2>
        {log.length === 0 ? (
          <p className={styles.empty}>No events yet — enqueue or process to start the tape.</p>
        ) : (
          <ul>
            {log.map((line, i) => (
              <li key={`${line}-${i}`}>{line}</li>
            ))}
          </ul>
        )}
      </aside>

      <footer className={styles.foot}>
        Saeed Rumaneh · QueueLens · persisted via /api/jobs
      </footer>
    </main>
  );
}

function JobCard({
  job,
  onRetry,
}: {
  job: Job;
  onRetry?: () => void;
}) {
  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <code>{job.id}</code>
        <span>
          try {job.attempts}/{job.maxAttempts}
        </span>
      </div>
      <strong>{job.name}</strong>
      <pre>{JSON.stringify(job.payload, null, 0)}</pre>
      {job.lastError ? <em>{job.lastError}</em> : null}
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </li>
  );
}

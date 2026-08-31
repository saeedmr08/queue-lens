import { describe, expect, it } from "vitest";
import {
  JobQueue,
  computeBackoffMs,
  createQueue,
  redactPayload,
} from "@/lib/queue";

describe("redactPayload", () => {
  it("redacts sensitive keys case-insensitively", () => {
    const out = redactPayload({
      user: "ada",
      password: "hunter2",
      Token: "abc",
      nested: { api_key: "k", ok: true },
    });
    expect(out.password).toBe("[REDACTED]");
    expect(out.Token).toBe("[REDACTED]");
    expect((out.nested as { api_key: string; ok: boolean }).api_key).toBe(
      "[REDACTED]",
    );
    expect((out.nested as { ok: boolean }).ok).toBe(true);
    expect(out.user).toBe("ada");
  });
});

describe("computeBackoffMs", () => {
  it("doubles per attempt", () => {
    expect(computeBackoffMs(0, 1000)).toBe(1000);
    expect(computeBackoffMs(1, 1000)).toBe(2000);
    expect(computeBackoffMs(2, 1000)).toBe(4000);
  });
});

describe("JobQueue", () => {
  it("enqueues with redacted payload", () => {
    const q = createQueue({ idFactory: () => "j1", now: () => 1000 });
    const job = q.enqueue({
      name: "email",
      payload: { to: "a@b.c", secret: "x" },
    });
    expect(job.status).toBe("pending");
    expect(job.payload.secret).toBe("[REDACTED]");
    expect(job.payload.to).toBe("a@b.c");
  });

  it("completes an active job", () => {
    let t = 0;
    const q = new JobQueue({
      now: () => t,
      idFactory: () => "a",
      maxAttempts: 3,
    });
    q.enqueue({ name: "work", payload: { n: 1 } });
    const claimed = q.claimNext();
    expect(claimed?.status).toBe("active");
    expect(claimed?.attempts).toBe(1);
    const done = q.complete("a", { ok: true });
    expect(done.status).toBe("completed");
    expect(q.counts().completed).toBe(1);
  });

  it("retries with backoff then dead-letters", () => {
    let t = 1_000;
    const q = new JobQueue({
      now: () => t,
      idFactory: () => "r1",
      maxAttempts: 2,
      baseBackoffMs: 1000,
    });
    q.enqueue({ name: "flaky", payload: {} });

    q.claimNext();
    const f1 = q.fail("r1", "boom");
    expect(f1.status).toBe("failed");
    expect(f1.nextRunAt).toBe(2000);

    t = 2000;
    q.claimNext();
    const f2 = q.fail("r1", "boom again");
    expect(f2.status).toBe("dead-letter");
    expect(q.counts()["dead-letter"]).toBe(1);
  });

  it("processOne success and failure paths", async () => {
    let t = 0;
    let n = 0;
    const q = new JobQueue({
      now: () => t,
      idFactory: () => `id${++n}`,
      maxAttempts: 1,
    });
    q.enqueue({ name: "ok", payload: {} });
    q.enqueue({ name: "bad", payload: {} });

    const good = await q.processOne(async () => ({ ok: true, result: 1 }));
    expect(good?.status).toBe("completed");

    const bad = await q.processOne(async () => ({
      ok: false,
      error: "nope",
    }));
    expect(bad?.status).toBe("dead-letter");
  });

  it("retries dead-letter back to pending", () => {
    let t = 1_000;
    const q = new JobQueue({
      now: () => t,
      idFactory: () => "dl1",
      maxAttempts: 1,
      baseBackoffMs: 1000,
    });
    q.enqueue({ name: "x", payload: {} });
    q.claimNext();
    q.fail("dl1", "gone");
    expect(q.get("dl1")?.status).toBe("dead-letter");
    const again = q.retry("dl1");
    expect(again.status).toBe("pending");
    expect(again.nextRunAt).toBe(t);
  });
});

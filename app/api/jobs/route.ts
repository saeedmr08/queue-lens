import { NextResponse } from "next/server";
import { withQueue } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  return withQueue((queue) =>
    NextResponse.json({
      jobs: queue.snapshot(),
      counts: queue.counts(),
    }),
  );
}

export async function POST(request: Request) {
  let body: {
    name?: string;
    payload?: Record<string, unknown>;
    maxAttempts?: number;
    delayMs?: number;
    action?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const handler = async (j: { name: string }) => {
    if (j.name.includes("fail")) {
      return { ok: false, error: "forced failure" };
    }
    return { ok: true, result: { processed: true } };
  };

  if (body.action === "process") {
    return withQueue(async (queue) => {
      const job = await queue.processOne(handler);
      return NextResponse.json({
        job: job ?? null,
        jobs: queue.snapshot(),
        counts: queue.counts(),
      });
    });
  }

  if (body.action === "process-all") {
    return withQueue(async (queue) => {
      const processed: unknown[] = [];
      for (let i = 0; i < 50; i++) {
        const job = await queue.processOne(handler);
        if (!job) break;
        processed.push(job);
      }
      return NextResponse.json({
        processed,
        count: processed.length,
        jobs: queue.snapshot(),
        counts: queue.counts(),
      });
    });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  return withQueue((queue) => {
    const job = queue.enqueue({
      name: body.name!.trim(),
      payload: body.payload ?? {},
      maxAttempts: body.maxAttempts,
      delayMs: body.delayMs,
    });
    return NextResponse.json(
      { job, jobs: queue.snapshot(), counts: queue.counts() },
      { status: 201 },
    );
  });
}

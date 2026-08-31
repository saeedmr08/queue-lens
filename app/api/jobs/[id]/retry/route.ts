import { NextResponse } from "next/server";
import { withQueue } from "@/lib/store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    return await withQueue((queue) => {
      const job = queue.retry(id);
      return NextResponse.json({
        job,
        jobs: queue.snapshot(),
        counts: queue.counts(),
      });
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Retry failed" },
      { status: 400 },
    );
  }
}

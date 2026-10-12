import { NextResponse } from "next/server";
import { changeBillStatus } from "@/lib/system-db";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    const id = Number(context.params.id);
    const body = await request.json();
    const status = body.status;
    if (!["pending_review", "approved", "rejected", "sent"].includes(status)) {
      return NextResponse.json({ error: "状态无效" }, { status: 400 });
    }

    const result = await changeBillStatus({
      id,
      status,
      reviewNotes: body.reviewNotes || null
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新状态失败" },
      { status: 500 }
    );
  }
}

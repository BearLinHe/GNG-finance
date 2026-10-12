import { NextResponse } from "next/server";
import { listTransportPricingRules } from "@/lib/system-db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rules = await listTransportPricingRules();
    return NextResponse.json({ rules });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取运输定价失败" },
      { status: 500 }
    );
  }
}

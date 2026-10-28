import { NextResponse } from "next/server";
import { IncomeInputError, readIncomeBody } from "@/lib/oak-income-db";
import { listSettlements, saveSettlement, settlementPreview } from "@/lib/oak-settlement-db";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    return NextResponse.json(params.get("subject") ? await settlementPreview(params.get("subject")!, params.get("weekStart") || "") : await listSettlements(params.get("weekStart") || ""));
  } catch (error) { return NextResponse.json({ error: error instanceof IncomeInputError ? error.message : "读取周结算失败" }, { status: error instanceof IncomeInputError ? 400 : 500 }); }
}
export async function POST(request: Request) {
  try { return NextResponse.json(await saveSettlement(null, await readIncomeBody(request))); }
  catch (error) { return NextResponse.json({ error: error instanceof IncomeInputError ? error.message : "保存周结算失败" }, { status: error instanceof IncomeInputError ? 400 : 500 }); }
}

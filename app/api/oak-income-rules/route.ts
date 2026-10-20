import { NextResponse } from "next/server";
import { IncomeInputError, listIncomeRules, readIncomeBody, saveIncomeRule } from "@/lib/oak-income-db";

export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json(await listIncomeRules()); }
  catch { return NextResponse.json({ error: "读取收入标准失败，请稍后重试" }, { status: 500 }); }
}
export async function POST(request: Request) {
  try { return NextResponse.json(await saveIncomeRule(null, await readIncomeBody(request))); }
  catch (error) { return NextResponse.json({ error: error instanceof IncomeInputError ? error.message : "保存收入标准失败，请稍后重试" }, { status: error instanceof IncomeInputError ? 400 : 500 }); }
}

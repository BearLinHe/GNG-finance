import { NextResponse } from "next/server";
import { IncomeInputError, readIncomeBody } from "@/lib/oak-income-db";
import { deletePeriodCosts, savePeriodCosts } from "@/lib/oak-period-profit-db";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { return NextResponse.json(await savePeriodCosts(await readIncomeBody(request))); }
  catch (e) { return NextResponse.json({ error: e instanceof IncomeInputError ? e.message : "保存周期成本失败" }, { status: e instanceof IncomeInputError ? 400 : 500 }); }
}
export async function DELETE(request: Request) {
  try { return NextResponse.json(await deletePeriodCosts(await readIncomeBody(request))); }
  catch (e) { return NextResponse.json({ error: e instanceof IncomeInputError ? e.message : "撤销周期成本失败" }, { status: e instanceof IncomeInputError ? 400 : 500 }); }
}

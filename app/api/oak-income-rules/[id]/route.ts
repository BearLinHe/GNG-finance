import { NextResponse } from "next/server";
import { deleteIncomeRule, IncomeInputError, incomeId, readIncomeBody, saveIncomeRule } from "@/lib/oak-income-db";

export const dynamic = "force-dynamic";
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try { return NextResponse.json(await saveIncomeRule(incomeId(params.id), await readIncomeBody(request))); }
  catch (error) { return NextResponse.json({ error: error instanceof IncomeInputError ? error.message : "保存收入标准失败，请稍后重试" }, { status: error instanceof IncomeInputError ? 400 : 500 }); }
}
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try { return NextResponse.json(await deleteIncomeRule(incomeId(params.id))); }
  catch (error) { return NextResponse.json({ error: error instanceof IncomeInputError ? error.message : "删除收入标准失败，请稍后重试" }, { status: error instanceof IncomeInputError ? 400 : 500 }); }
}

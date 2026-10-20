import { NextResponse } from "next/server";
import { deleteIncomeReview, IncomeInputError, incomeId, incomeTaskScope, readIncomeBody, saveIncomeReview } from "@/lib/oak-income-db";
import { listDriverActivities } from "@/lib/oak-driver-db";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const id = incomeId(params.id); const scope = await incomeTaskScope(id);
    const data = await listDriverActivities({ ...scope, dateFrom: "", dateTo: "", search: "", page: 1, pageSize: 100 });
    const anchors = data.periods.flatMap(period => period.days.flatMap(day => day.tasks)).filter(task => task.id !== id && task.income?.status === "priced" && (task.income.billingBasis === "trip" || task.income.source === "manual"));
    return NextResponse.json({ anchors });
  } catch (error) { return NextResponse.json({ error: error instanceof IncomeInputError ? error.message : "读取整趟作业失败，请稍后重试" }, { status: error instanceof IncomeInputError ? 400 : 500 }); }
}
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try { return NextResponse.json(await saveIncomeReview(incomeId(params.id), await readIncomeBody(request))); }
  catch (error) { return NextResponse.json({ error: error instanceof IncomeInputError ? error.message : "保存收入核对失败，请稍后重试" }, { status: error instanceof IncomeInputError ? 400 : 500 }); }
}
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try { return NextResponse.json(await deleteIncomeReview(incomeId(params.id))); }
  catch (error) { return NextResponse.json({ error: error instanceof IncomeInputError ? error.message : "恢复自动计价失败，请稍后重试" }, { status: error instanceof IncomeInputError ? 400 : 500 }); }
}

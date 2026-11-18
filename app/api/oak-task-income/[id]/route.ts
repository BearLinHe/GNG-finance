import { NextResponse } from "next/server";
import { deleteIncomeReview, IncomeInputError, incomeId, readIncomeBody, saveIncomeReview } from "@/lib/oak-income-db";
import { readTaskReviewContext } from "@/lib/oak-driver-db";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { anchors } = await readTaskReviewContext(incomeId(params.id));
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

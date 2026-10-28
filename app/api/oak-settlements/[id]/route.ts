import { NextResponse } from "next/server";
import { IncomeInputError, incomeId, readIncomeBody } from "@/lib/oak-income-db";
import { addSettlementPayment, confirmSettlement, deleteSettlement, getSettlement, saveSettlement, settlementCsv, voidSettlementPayment } from "@/lib/oak-settlement-db";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const record = await getSettlement(incomeId(params.id));
    if (new URL(request.url).searchParams.get("format") === "csv") return new Response(settlementCsv(record), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="oak-settlement-${record.id}.csv"` } });
    return NextResponse.json(record);
  } catch (error) { return NextResponse.json({ error: error instanceof IncomeInputError ? error.message : "读取结算单失败" }, { status: error instanceof IncomeInputError ? 400 : 500 }); }
}
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try { return NextResponse.json(await saveSettlement(incomeId(params.id), await readIncomeBody(request))); }
  catch (error) { return NextResponse.json({ error: error instanceof IncomeInputError ? error.message : "保存结算单失败" }, { status: error instanceof IncomeInputError ? 400 : 500 }); }
}
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const id = incomeId(params.id); const body = await readIncomeBody(request);
    if (body?.action === "confirm") return NextResponse.json(await confirmSettlement(id));
    if (body?.action === "pay") return NextResponse.json(await addSettlementPayment(id, body));
    if (body?.action === "voidPayment") return NextResponse.json(await voidSettlementPayment(id, incomeId(body.paymentId), body.reason));
    throw new IncomeInputError("结算操作无效");
  } catch (error) { return NextResponse.json({ error: error instanceof IncomeInputError ? error.message : "结算操作失败" }, { status: error instanceof IncomeInputError ? 400 : 500 }); }
}
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try { return NextResponse.json(await deleteSettlement(incomeId(params.id))); }
  catch (error) { return NextResponse.json({ error: error instanceof IncomeInputError ? error.message : "删除结算单失败" }, { status: error instanceof IncomeInputError ? 400 : 500 }); }
}

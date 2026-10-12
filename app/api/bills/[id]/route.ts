import { NextResponse } from "next/server";
import { getBill, updateOperationBill } from "@/lib/system-db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: { id: string } }) {
  try {
    const id = Number(context.params.id);
    const bill = await getBill(id);
    if (!bill) {
      return NextResponse.json({ error: "账单不存在" }, { status: 404 });
    }
    return NextResponse.json(bill);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取账单失败" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, context: { params: { id: string } }) {
  try {
    const id = Number(context.params.id);
    const body = await request.json();
    const result = await updateOperationBill({
      id,
      amount: Number(body.amount),
      notes: body.notes || null
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存操作账单失败" },
      { status: 500 }
    );
  }
}

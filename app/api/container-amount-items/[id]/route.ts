import { NextResponse } from "next/server";
import { deleteContainerAmountItem, saveContainerAmountItem } from "@/lib/system-db";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: { id: string } }) {
  try {
    const body = await request.json();
    const item = await saveContainerAmountItem({
      id: Number(context.params.id),
      sourceOrderId: Number(body.sourceOrderId),
      containerNumber: body.containerNumber || "",
      amountSourceKey: "finance",
      amountType: body.amountType === "expense" ? "expense" : "receivable",
      expenseCategory: body.expenseCategory || null,
      itemName: body.itemName || "",
      amount: Number(body.amount),
      notes: body.notes || null
    });

    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "修改金额明细失败" },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: { params: { id: string } }) {
  try {
    const id = await deleteContainerAmountItem(Number(context.params.id));
    return NextResponse.json({ id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除金额明细失败" },
      { status: 500 }
    );
  }
}

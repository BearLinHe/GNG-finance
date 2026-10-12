import { NextResponse } from "next/server";
import { saveContainerAmountItem } from "@/lib/system-db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const item = await saveContainerAmountItem({
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
      { error: error instanceof Error ? error.message : "保存金额明细失败" },
      { status: 500 }
    );
  }
}

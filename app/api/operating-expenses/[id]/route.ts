import { NextResponse } from "next/server";
import { deleteContainerAmountItem, saveContainerAmountItem } from "@/lib/system-db";

export const dynamic = "force-dynamic";

const categories = new Set(["transport", "warehouse", "domestic"]);

export async function PATCH(request: Request, context: { params: { id: string } }) {
  try {
    const body = await request.json();
    const category = String(body.category || "");
    if (!categories.has(category)) throw new Error("支出分类无效");

    const item = await saveContainerAmountItem({
      id: Number(context.params.id),
      sourceOrderId: Number(body.sourceOrderId),
      containerNumber: String(body.containerNumber || "").trim().toUpperCase(),
      amountSourceKey: "finance",
      amountType: "expense",
      expenseCategory: category,
      itemName: String(body.itemName || ""),
      amount: Number(body.amount),
      warehousePoint: body.warehousePoint || null,
      vendorName: body.vendorName || null,
      expenseDate: body.expenseDate || null,
      referenceNumber: body.referenceNumber || null,
      pricingMethod: body.pricingMethod === "standard" ? "standard" : "manual",
      standardAmount: body.standardAmount == null ? null : Number(body.standardAmount),
      pricingRuleId: body.pricingRuleId == null ? null : Number(body.pricingRuleId),
      notes: body.notes || null
    });
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "修改运营支出失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, context: { params: { id: string } }) {
  try {
    const id = await deleteContainerAmountItem(Number(context.params.id));
    if (!id) throw new Error("支出记录不存在");
    return NextResponse.json({ id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除运营支出失败" },
      { status: 400 }
    );
  }
}

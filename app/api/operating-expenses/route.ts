import { NextResponse } from "next/server";
import { searchSourceContainers } from "@/lib/source-db";
import {
  getOperatingExpenseSummary,
  listOperatingExpenses,
  saveContainerAmountItem
} from "@/lib/system-db";

export const dynamic = "force-dynamic";

const categories = new Set(["transport", "warehouse", "domestic"]);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") || "transport";
    if (!categories.has(category)) throw new Error("支出分类无效");

    const [result, summary] = await Promise.all([
      listOperatingExpenses({
        category: category as "transport" | "warehouse" | "domestic",
        search: searchParams.get("search") || "",
        dateFrom: searchParams.get("dateFrom") || "",
        dateTo: searchParams.get("dateTo") || "",
        page: Number(searchParams.get("page") || 1),
        pageSize: Number(searchParams.get("pageSize") || 50)
      }),
      getOperatingExpenseSummary()
    ]);
    return NextResponse.json({ ...result, summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取运营支出失败" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const category = String(body.category || "");
    if (!categories.has(category)) throw new Error("支出分类无效");

    const containerNumber = String(body.containerNumber || "").trim().toUpperCase();
    if (!containerNumber) throw new Error("柜号不能为空");
    const sourceMatches = await searchSourceContainers({ search: containerNumber, limit: 20 });
    const sourceContainer = sourceMatches.find(
      (item) => item.containerNumber.trim().toUpperCase() === containerNumber
    );
    if (!sourceContainer) throw new Error("源数据库没有找到这个柜号");

    const item = await saveContainerAmountItem({
      sourceOrderId: sourceContainer.sourceOrderId,
      containerNumber: sourceContainer.containerNumber,
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
      { error: error instanceof Error ? error.message : "保存运营支出失败" },
      { status: 400 }
    );
  }
}

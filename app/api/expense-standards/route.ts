import { NextResponse } from "next/server";
import {
  listExpenseStandards,
  listTransportPricingRules,
  listWarehousePickupPricingRules,
  saveExpenseStandard,
  type ExpenseStandard
} from "@/lib/system-db";

export const dynamic = "force-dynamic";

const categories = new Set(["transport", "warehouse", "domestic"]);
const standardKinds = new Set(["fixed", "monthly"]);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") || "transport";
    const standardKind = searchParams.get("standardKind") || "fixed";
    if (!categories.has(category) || !standardKinds.has(standardKind)) throw new Error("支出标准分类无效");

    const [customStandards, transportRules, warehousePickupRules] = await Promise.all([
      listExpenseStandards({
        category: category as ExpenseStandard["category"],
        standardKind: standardKind as ExpenseStandard["standard_kind"]
      }),
      category === "transport" && standardKind === "fixed" ? listTransportPricingRules() : Promise.resolve([]),
      category === "warehouse" && standardKind === "fixed" ? listWarehousePickupPricingRules() : Promise.resolve([])
    ]);

    return NextResponse.json({ customStandards, transportRules, warehousePickupRules });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取支出标准失败" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const category = String(body.category || "");
    const standardKind = String(body.standardKind || "");
    const standardName = String(body.standardName || "").trim();
    const amount = Number(body.amount);
    const periodStart = String(body.periodStart || "");
    const periodEnd = String(body.periodEnd || "");
    if (!categories.has(category) || !standardKinds.has(standardKind)) throw new Error("支出标准分类无效");
    if (!standardName) throw new Error("费用名称不能为空");
    if (!Number.isFinite(amount) || amount < 0) throw new Error("金额必须是大于或等于 0 的数字");
    const isProratedMonthly = standardKind === "monthly" && (category === "warehouse" || category === "transport");
    if (isProratedMonthly) {
      if (!periodStart || !periodEnd) throw new Error("请选择费用周期的开始和结束日期");
      if (periodStart > periodEnd) throw new Error("结束日期不能早于开始日期");
    } else if (standardKind === "monthly" && !body.billingMonth) {
      throw new Error("请选择费用月份");
    }

    const standard = await saveExpenseStandard({
      category: category as ExpenseStandard["category"],
      standardKind: standardKind as ExpenseStandard["standard_kind"],
      standardName,
      amount,
      unit: body.unit,
      billingMonth: periodStart
        ? `${periodStart.slice(0, 7)}-01`
        : body.billingMonth ? `${String(body.billingMonth).slice(0, 7)}-01` : null,
      periodStart: periodStart || null,
      periodEnd: periodEnd || null,
      applicationRule: isProratedMonthly ? "monthly_prorated" : undefined,
      operationMode: isProratedMonthly ? category === "transport" ? "direct_delivery" : "unload" : undefined,
      vendorName: body.vendorName,
      description: body.description
    });
    return NextResponse.json({ standard });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存支出标准失败" },
      { status: 400 }
    );
  }
}

import { NextResponse } from "next/server";
import { priceInitialBills } from "@/lib/initial-pricing";
import { getSourceInitialBillExact } from "@/lib/source-db";
import { listBills, upsertBillFromSource } from "@/lib/system-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const bills = await listBills({
      search: url.searchParams.get("search") || "",
      status: url.searchParams.get("status") || ""
    });

    return NextResponse.json({ bills });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取系统账单失败" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sourceOrderId = Number(body.sourceOrderId);
    if (!Number.isFinite(sourceOrderId) || sourceOrderId <= 0) {
      return NextResponse.json({ error: "sourceOrderId 无效" }, { status: 400 });
    }

    const source = await getSourceInitialBillExact(sourceOrderId);
    if (!source) {
      return NextResponse.json({ error: "源数据库没有找到这个海柜订单" }, { status: 404 });
    }

    const [pricedSource] = await priceInitialBills([source]);
    const bill = await upsertBillFromSource({
      sourceOrderId: pricedSource.sourceOrderId,
      containerNumber: pricedSource.containerNumber,
      customerName: pricedSource.customerName,
      productType: pricedSource.productTypes,
      orderDate: pricedSource.orderDate,
      pickupDate: pricedSource.pickupDate,
      returnDeadline: pricedSource.returnDeadline,
      operationMode: pricedSource.operationMode,
      containerType: pricedSource.containerType,
      presetReceivableAmount: pricedSource.presetReceivableAmount,
      sourceBalanceAmount: pricedSource.sourceBalanceAmount,
      invoiceNumbers: pricedSource.invoiceNumbers,
      matchedFeeNames: pricedSource.matchedFeeNames,
      matchedFeeCount: pricedSource.matchedFeeCount
    });
    return NextResponse.json({ bill });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成账单失败" },
      { status: 500 }
    );
  }
}

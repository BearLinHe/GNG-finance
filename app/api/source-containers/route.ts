import { NextResponse } from "next/server";
import { searchSourceContainers } from "@/lib/source-db";
import { getBillsBySourceOrderIds } from "@/lib/system-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rows = await searchSourceContainers({
      search: url.searchParams.get("search") || "",
      customer: url.searchParams.get("customer") || "",
      productType: url.searchParams.get("productType") || "",
      limit: Number(url.searchParams.get("limit") || 100)
    });
    const localBills = await getBillsBySourceOrderIds(rows.map((row) => row.sourceOrderId));

    return NextResponse.json({
      containers: rows.map((row) => {
        const bill = localBills.get(row.sourceOrderId);
        return {
          ...row,
          billId: bill?.id || null,
          localStatus: bill?.status || null,
          operationBillAmount: bill?.operation_bill_amount || null
        };
      })
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取源数据库失败" },
      { status: 500 }
    );
  }
}

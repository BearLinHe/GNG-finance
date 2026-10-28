import { NextResponse } from "next/server";
import { loadSavAccounting, savApiError, savApiStatus } from "@/lib/sav-accounting-service";
export const dynamic = "force-dynamic";
function csv(value: unknown) {
  let text = value == null ? "" : String(value);
  if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export async function GET(request: Request) {
  try {
    const result = await loadSavAccounting(new URL(request.url).searchParams, { allRows: true });
    const rows: unknown[][] = [["柜号", "客户", "订单类型", "订单状态", "订单日期", "提柜日期", "收入USD", "已计收入USD", "运输支出USD", "已计支出USD", "收入减运输支出USD", "整柜利润USD", "核算状态", "在库板数", "退运板数", "待计成本条数", "说明"]];
    for (const row of result.rows) rows.push([row.containerNumber, row.customerName, row.operationMode, row.status, row.orderDate, row.pickupDate, row.income, row.knownIncome, row.expense, row.knownExpense, row.transportBalance, row.profit, row.statusLabel, row.inStockPallets, row.returnedPallets, row.pendingCostCount, row.warnings.join("；")]);
    return new Response(`\uFEFF${rows.map(row => row.map(csv).join(",")).join("\r\n")}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="SAV-container-accounting.csv"', "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json(savApiError(error), { status: savApiStatus(error) }); }
}

import { NextResponse } from "next/server";
import { listDriverActivities } from "@/lib/oak-driver-db";
import { driverPagination } from "@/lib/oak-pagination";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    let pagination;
    try { pagination = driverPagination(params); }
    catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
    const importId = params.get("importId") ? Number(params.get("importId")) : null;
    if (importId !== null && (!Number.isSafeInteger(importId) || importId <= 0)) throw new Error("导入批次无效");
    return NextResponse.json(await listDriverActivities({
      driverName: params.get("driverName") || "", dateFrom: params.get("dateFrom") || "", dateTo: params.get("dateTo") || "",
      search: params.get("search") || "", importId, ...pagination
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取司机作业失败" }, { status: 500 });
  }
}

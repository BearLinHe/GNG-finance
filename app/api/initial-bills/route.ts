import { NextResponse } from "next/server";
import { listSourceOperationModes, searchSourceInitialBills } from "@/lib/source-db";

export const dynamic = "force-dynamic";

type InitialBillsResponse = {
  initialBills: Awaited<ReturnType<typeof searchSourceInitialBills>>;
  operationModes: Awaited<ReturnType<typeof listSourceOperationModes>>;
  totalCount: number;
  page: number;
  pageSize: number;
};

const initialBillsGlobal = globalThis as typeof globalThis & {
  gngInitialBillsCache?: Map<string, { expiresAt: number; payload: InitialBillsResponse }>;
};
const responseCache: Map<string, { expiresAt: number; payload: InitialBillsResponse }> =
  initialBillsGlobal.gngInitialBillsCache ?? (initialBillsGlobal.gngInitialBillsCache = new Map());
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || 1);
    const pageSize = Math.min(Math.max(Number(url.searchParams.get("pageSize") || 100), 10), 300);
    const cacheKey = new URLSearchParams(url.searchParams);
    cacheKey.delete("refresh");
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const cached = responseCache.get(cacheKey.toString());
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload, { headers: { "X-Finance-Cache": "HIT" } });
    }
    const [sourceRows, operationModes] = await Promise.all([
      searchSourceInitialBills({
        search: url.searchParams.get("search") || "",
        containerNumber: url.searchParams.get("containerNumber") || "",
        customerName: url.searchParams.get("customerName") || "",
        productType: url.searchParams.get("productType") || "",
        operationMode: url.searchParams.get("operationMode") || "",
        dateField: url.searchParams.get("dateField") || "",
        dateFrom: url.searchParams.get("dateFrom") || "",
        dateTo: url.searchParams.get("dateTo") || "",
        page,
        pageSize
      }),
      listSourceOperationModes()
    ]);

    const payload = {
      initialBills: sourceRows,
      operationModes,
      totalCount: sourceRows[0]?.totalCount || 0,
      page,
      pageSize
    } satisfies InitialBillsResponse;
    responseCache.set(cacheKey.toString(), { expiresAt: Date.now() + CACHE_TTL_MS, payload });
    if (responseCache.size > 40) responseCache.delete(responseCache.keys().next().value as string);
    return NextResponse.json(payload, { headers: { "X-Finance-Cache": "MISS" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取初始账单失败" },
      { status: 500 }
    );
  }
}

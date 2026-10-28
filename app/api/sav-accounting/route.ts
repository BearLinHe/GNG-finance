import { NextResponse } from "next/server";
import { loadSavAccounting, savApiError, savApiStatus } from "@/lib/sav-accounting-service";
import { savRuntimeDiagnostic } from "@/lib/sav-runtime-error";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return NextResponse.json(await loadSavAccounting(new URL(request.url).searchParams), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { console.error("SAV accounting request failed:", savRuntimeDiagnostic(error)); return NextResponse.json(savApiError(error), { status: savApiStatus(error) }); }
}

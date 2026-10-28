import { NextResponse } from "next/server";
import { loadSavAccounting, savApiError } from "@/lib/sav-accounting-service";
import { SavInputError } from "@/lib/sav-settings";
import { SavSourceInputError } from "@/lib/sav-source-db";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return NextResponse.json(await loadSavAccounting(new URL(request.url).searchParams), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { console.error("SAV accounting request failed:", error instanceof Error ? error.name : "unknown"); return NextResponse.json(savApiError(error), { status: error instanceof SavInputError || error instanceof SavSourceInputError ? 400 : 500 }); }
}

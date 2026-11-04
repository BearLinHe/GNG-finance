import { NextResponse } from "next/server";
import { IncomeInputError, readIncomeBody } from "@/lib/oak-income-db";
import { deleteVehicleAccounting, listVehicleAccounting, saveVehicleAccounting } from "@/lib/oak-vehicle-accounting-db";

export const dynamic = "force-dynamic";
function failure(e: unknown) {
  return NextResponse.json({ error: e instanceof IncomeInputError ? e.message : "读取或保存单车核算失败" }, { status: e instanceof IncomeInputError ? 400 : 500 });
}
export async function GET(request: Request) {
  try { return NextResponse.json(await listVehicleAccounting(new URL(request.url).searchParams)); } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try { return NextResponse.json(await saveVehicleAccounting(await readIncomeBody(request))); } catch (e) { return failure(e); }
}
export async function DELETE(request: Request) {
  try { return NextResponse.json(await deleteVehicleAccounting(await readIncomeBody(request))); } catch (e) { return failure(e); }
}

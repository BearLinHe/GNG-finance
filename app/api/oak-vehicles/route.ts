import { NextResponse } from "next/server";
import { IncomeInputError, readIncomeBody } from "@/lib/oak-income-db";
import { updateOakVehicle } from "@/lib/oak-vehicle-accounting-db";

export const dynamic = "force-dynamic";
export async function PUT(request: Request) {
  try { return NextResponse.json(await updateOakVehicle(await readIncomeBody(request))); }
  catch (e) { return NextResponse.json({ error: e instanceof IncomeInputError ? e.message : "保存车辆资料失败" }, { status: e instanceof IncomeInputError ? 400 : 500 }); }
}

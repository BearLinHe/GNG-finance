import { NextResponse } from "next/server";
import { IncomeInputError, readIncomeBody } from "@/lib/oak-income-db";
import { listVehicleAmounts, saveVehicleAmount, voidVehicleAmount } from "@/lib/oak-vehicle-amounts-db";
export const dynamic = "force-dynamic";
function failure(e: unknown) { return NextResponse.json({error:e instanceof IncomeInputError?e.message:"周期明细读取或保存失败"},{status:e instanceof IncomeInputError?400:500}); }
export async function GET(request:Request) {try{return NextResponse.json(await listVehicleAmounts(new URL(request.url).searchParams));}catch(e){return failure(e);}}
export async function POST(request:Request) {try{return NextResponse.json(await saveVehicleAmount(await readIncomeBody(request)));}catch(e){return failure(e);}}
export async function DELETE(request:Request) {try{return NextResponse.json(await voidVehicleAmount(await readIncomeBody(request)));}catch(e){return failure(e);}}

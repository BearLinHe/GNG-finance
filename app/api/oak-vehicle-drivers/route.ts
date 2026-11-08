import { NextResponse } from 'next/server';
import { IncomeInputError, readIncomeBody } from '@/lib/oak-income-db';
import { listVehicleDriverHistory, writeVehicleDriverHistory } from '@/lib/oak-vehicle-drivers-db';

export const dynamic = 'force-dynamic';

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof IncomeInputError ? error.message : '司机记录读取或保存失败' },
    { status: error instanceof IncomeInputError ? 400 : 500 });
}

export async function GET(request: Request) {
  try { return NextResponse.json(await listVehicleDriverHistory(new URL(request.url).searchParams.get('vehicleId'))); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try { return NextResponse.json(await writeVehicleDriverHistory(await readIncomeBody(request))); }
  catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  try { return NextResponse.json(await writeVehicleDriverHistory(await readIncomeBody(request), true)); }
  catch (error) { return failure(error); }
}

import { NextResponse } from 'next/server';
import { readDriverAccounting, saveDriverTimeline } from '@/lib/oak-driver-accounting-db';
import { IncomeInputError, readIncomeBody } from '@/lib/oak-income-db';

export const dynamic = 'force-dynamic';

function failure(error: unknown) {
  const invalid = error instanceof IncomeInputError;
  if (!invalid) console.error('OAK driver accounting request failed', error instanceof Error ? error.message : error);
  return NextResponse.json({ error: invalid ? error.message : '司机盈亏读取或保存失败' }, { status: invalid ? 400 : 500 });
}

export async function GET(request: Request) {
  try { return NextResponse.json(await readDriverAccounting(new URL(request.url).searchParams)); }
  catch (error) { return failure(error); }
}

export async function PUT(request: Request) {
  try { return NextResponse.json(await saveDriverTimeline(await readIncomeBody(request))); }
  catch (error) { return failure(error); }
}

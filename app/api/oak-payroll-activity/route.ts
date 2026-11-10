import { NextResponse } from 'next/server';
import { IncomeInputError, readIncomeBody } from '@/lib/oak-income-db';
import { reconcilePayrollActivity, reconcilePayrollActivityBatch } from '@/lib/oak-payroll-activity-db';

export const dynamic = 'force-dynamic';

function activityError(error: unknown) {
  return error instanceof IncomeInputError
    ? NextResponse.json({ error: error.message }, { status: 400 })
    : NextResponse.json({ error: '无法核对周表作业，请重试' }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const wageId = params.get('wageId') || '';
    return NextResponse.json(await (params.get('batch') === '1' ? reconcilePayrollActivityBatch(wageId) : reconcilePayrollActivity(wageId)));
  } catch (error) { return activityError(error); }
}

export async function POST(request: Request) {
  try {
    const body = await readIncomeBody(request);
    if (typeof body?.wageId !== 'string') throw new IncomeInputError('核对内容无效');
    if (Array.isArray(body.selection)) await reconcilePayrollActivityBatch(body.wageId, body.selection);
    else {
      if (typeof body.token !== 'string') throw new IncomeInputError('核对内容无效');
      await reconcilePayrollActivity(body.wageId, body.token);
    }
    return NextResponse.json({ success: true });
  } catch (error) { return activityError(error); }
}

import { NextResponse } from "next/server";
import { IncomeInputError, incomeId, incomeTaskScope, readIncomeBody } from "@/lib/oak-income-db";
import { listDriverActivities } from "@/lib/oak-driver-db";
import { saveJobGrouping } from "@/lib/oak-job-db";
import { withSystemClient } from "@/lib/system-db";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const id = incomeId(params.id); const scope = await incomeTaskScope(id);
    const data = await listDriverActivities({ ...scope, dateFrom: "", dateTo: "", search: "", page: 1, pageSize: 100 });
    const tasks = data.periods.flatMap(period => period.days.flatMap(day => day.tasks));
    const lockedTaskIds = await withSystemClient(async client => {
      const result = await client.query(`select st.task_id::text from oak_settlement_tasks st join oak_weekly_settlements s on s.id=st.settlement_id
        where s.status='confirmed' and st.task_id=any($1::bigint[])`, [tasks.map(task => task.id)]);
      return result.rows.map(row => String(row.task_id));
    });
    return NextResponse.json({ tasks, lockedTaskIds });
  } catch (error) { return NextResponse.json({ error: error instanceof IncomeInputError ? error.message : "读取任务作业失败" }, { status: error instanceof IncomeInputError ? 400 : 500 }); }
}
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try { return NextResponse.json(await saveJobGrouping(incomeId(params.id), await readIncomeBody(request))); }
  catch (error) { return NextResponse.json({ error: error instanceof IncomeInputError ? error.message : "保存归集失败" }, { status: error instanceof IncomeInputError ? 400 : 500 }); }
}

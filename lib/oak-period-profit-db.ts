import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { DriverPeriod, DriverTask } from "./oak-driver-types";
import { IncomeInputError } from "./oak-income-db";
import { calculatePeriodProfit, profitTaskSignature, validatePeriodCost, validateProfitScope, type PeriodCostReview, type ProfitScope, type ProfitSettlement } from "./oak-period-profit";
import { summarizePayeeTypes } from "./oak-payee";
import { ensureSystemSchema, withSystemClient } from "./system-db";

function hashTasks(tasks: DriverTask[]) { return createHash("sha256").update(profitTaskSignature(tasks)).digest("hex"); }
function costReview(row: Record<string, unknown>): PeriodCostReview {
  return { subject: String(row.subject), dateFrom: String(row.date_from), dateTo: String(row.date_to), importId: Number(row.import_id) || null,
    payeeType: row.payee_type as PeriodCostReview["payeeType"], laborMode: row.labor_mode as PeriodCostReview["laborMode"],
    laborAmount: row.labor_amount == null ? null : Number(row.labor_amount), expenses: row.expenses as PeriodCostReview["expenses"],
    expensesConfirmed: true, note: String(row.note), taskHash: String(row.task_hash), version: Number(row.version), updatedAt: String(row.updated_at) };
}
export async function pricePeriodProfits(client: PoolClient, periods: DriverPeriod[], range: { dateFrom: string; dateTo: string; importId: number | null }) {
  if (!periods.length) return [];
  const subjects = periods.map(period => period.driverName);
  const reviews = await client.query(`select *,date_from::text,date_to::text,updated_at::text from oak_period_cost_reviews
    where subject=any($1::text[]) and date_from=$2::date and date_to=$3::date and import_id=$4`, [subjects, range.dateFrom, range.dateTo, range.importId || 0]);
  const settlements = await client.query(`select s.id::text,s.subject,s.week_start::text as "weekStart",s.week_end::text as "weekEnd",s.payee_type as "payeeType",
    s.base_amount::float8 as "baseAmount",s.adjustments,s.status,
    coalesce((select jsonb_agg(st.task_id::text order by st.task_id) from oak_settlement_tasks st where st.settlement_id=s.id),'[]') as "taskIds"
    from oak_weekly_settlements s where s.status='confirmed' and s.subject=any($1::text[]) and s.week_start<=$3::date and s.week_end>=$2::date`, [subjects, range.dateFrom, range.dateTo]);
  return periods.map(period => {
    const tasks = period.days.flatMap(day => day.tasks);
    const row = reviews.rows.find(row => row.subject === period.driverName);
    return calculatePeriodProfit({ subject: period.driverName, ...range }, tasks, settlements.rows as ProfitSettlement[], row ? costReview(row) : null, hashTasks(tasks));
  });
}
async function scopeTasks(client: PoolClient, scope: ProfitScope) {
  const result = await client.query(`select id::text,import_id::int as "importId",driver_name as "driverName",sheet_name as "sheetName",
    work_date::text as "workDate",payee_type as "payeeType" from oak_driver_tasks
    where driver_name=$1 and work_date between $2::date and $3::date and ($4::bigint is null or import_id=$4)`, [scope.subject, scope.dateFrom, scope.dateTo, scope.importId]);
  return result.rows as DriverTask[];
}
export async function savePeriodCosts(value: unknown) {
  let input;
  try { input = validatePeriodCost(value); } catch (e) { throw new IncomeInputError((e as Error).message); }
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query("begin");
    try {
      await client.query("select pg_advisory_xact_lock(19431, 3)");
      const tasks = await scopeTasks(client, input);
      if (!tasks.length || hashTasks(tasks) !== input.taskHash) throw new IncomeInputError("作业范围已变化，请关闭并刷新后重新核对成本");
      const identity = summarizePayeeTypes(tasks);
      if (identity.conflict || (identity.type && identity.type !== input.payeeType)) throw new IncomeInputError("结算身份不一致，不能混用司机工资与车主价格");
      const current = await client.query(`select id,version from oak_period_cost_reviews where subject=$1 and date_from=$2::date and date_to=$3::date and import_id=$4 for update`, [input.subject, input.dateFrom, input.dateTo, input.importId || 0]);
      if (Number(current.rows[0]?.version || 0) !== input.version) throw new IncomeInputError("成本已被其他操作更新，请刷新后重试");
      const values = [input.subject, input.dateFrom, input.dateTo, input.importId || 0, input.payeeType, input.laborMode, input.laborAmount,
        JSON.stringify(input.expenses), input.note, input.taskHash, JSON.stringify(tasks.map(task => task.id))];
      const saved = await client.query(`insert into oak_period_cost_reviews(subject,date_from,date_to,import_id,payee_type,labor_mode,labor_amount,expenses,note,task_hash,task_ids)
        values($1,$2::date,$3::date,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb)
        on conflict(subject,date_from,date_to,import_id) do update set payee_type=excluded.payee_type,labor_mode=excluded.labor_mode,
        labor_amount=excluded.labor_amount,expenses=excluded.expenses,note=excluded.note,task_hash=excluded.task_hash,task_ids=excluded.task_ids,
        version=oak_period_cost_reviews.version+1,updated_at=now() returning id::text,version`, values);
      await client.query(`insert into oak_workflow_audit(entity_kind,entity_id,event,details) values('period_cost',$1,'核对周期成本',$2::jsonb)`, [saved.rows[0].id, JSON.stringify(input)]);
      await client.query("commit"); return { success: true, version: Number(saved.rows[0].version) };
    } catch (e) { await client.query("rollback"); throw e; }
  });
}
export async function deletePeriodCosts(value: unknown) {
  let scope: ProfitScope; let version: number;
  try {
    if (!value || typeof value !== "object") throw new Error("成本范围无效");
    scope = validateProfitScope(value as Record<string, unknown>); version = Number((value as Record<string, unknown>).version);
    if (!Number.isSafeInteger(version) || version < 1) throw new Error("成本版本无效");
  } catch (e) { throw new IncomeInputError((e as Error).message); }
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query("begin");
    try {
      await client.query("select pg_advisory_xact_lock(19431, 3)");
      const result = await client.query(`delete from oak_period_cost_reviews where subject=$1 and date_from=$2::date and date_to=$3::date and import_id=$4 and version=$5 returning id::text`, [scope.subject, scope.dateFrom, scope.dateTo, scope.importId || 0, version]);
      if (!result.rowCount) throw new IncomeInputError("成本已变化，请刷新后重试");
      await client.query(`insert into oak_workflow_audit(entity_kind,entity_id,event,details) values('period_cost',$1,'撤销周期成本核对',$2::jsonb)`, [result.rows[0].id, JSON.stringify(scope)]);
      await client.query("commit"); return { success: true };
    } catch (e) { await client.query("rollback"); throw e; }
  });
}

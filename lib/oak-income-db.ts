import type { PoolClient } from "pg";
import { ensureSystemSchema, withSystemClient } from "./system-db";
import { incomeAmount, incomeText, priceDriverDays, rulesOverlap, validateIncomeRule, type IncomeReview, type IncomeRule } from "./oak-income";
import { summarizeDriverTasks, type DriverTask } from "./oak-driver-types";
import type { PayeeType } from "./oak-payee";

export class IncomeInputError extends Error {}
export function incomeId(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d{0,14}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new IncomeInputError("记录编号无效");
  return value;
}
export async function readIncomeBody(request: Request) {
  const text = await request.text();
  if (text.length > 16000) throw new IncomeInputError("提交内容过长");
  try { return JSON.parse(text); } catch { throw new IncomeInputError("提交内容不是有效 JSON"); }
}
export async function readIncomeRules(client: PoolClient): Promise<IncomeRule[]> {
  const result = await client.query(`select id::int, name, work_label as "workLabel", from_location as "fromLocation", to_location as "toLocation",
    amount::float8, billing_basis as "billingBasis", valid_from::text as "validFrom", valid_to::text as "validTo", active
    from oak_income_rules order by active desc, work_label, id`);
  return result.rows;
}
export async function readIncomeReviews(client: PoolClient, taskIds: string[]): Promise<IncomeReview[]> {
  if (!taskIds.length) return [];
  const result = await client.query(`select task_id::text as "taskId", mode, work_label as "workLabel", amount::float8,
    included_task_id::text as "includedTaskId", note from oak_task_income_reviews where task_id = any($1::bigint[])`, [taskIds]);
  return result.rows;
}
export async function assertIncomeTasksEditable(client: PoolClient, taskIds: string[]) {
  const locked = await client.query(`select s.id from oak_settlement_tasks st join oak_weekly_settlements s on s.id=st.settlement_id
    where s.status='confirmed' and st.task_id=any($1::bigint[]) limit 1`, [taskIds]);
  if (locked.rowCount) throw new IncomeInputError(`作业已进入确认的周结算单 #${locked.rows[0].id}，不能修改收入或归集关系`);
}
function taskFromRow(row: Record<string, unknown>): DriverTask {
  const text = (value: unknown) => value == null ? null : String(value);
  return { id: String(row.id), importId: Number(row.import_id), sheetName: String(row.sheet_name), section: String(row.section),
    payeeType: row.payee_type as PayeeType | null,
    sourceRow: Number(row.source_row), driverName: String(row.driver_name), workDate: String(row.date_text), reference: text(row.reference),
    nature: text(row.nature), fromLocation: text(row.from_location), toLocation: text(row.to_location), miles: row.miles == null ? null : Number(row.miles), notes: text(row.notes), rawCells: (row.raw_cells || {}) as DriverTask["rawCells"] };
}
export async function readIncomeContext(client: PoolClient, ids: string[], reviews: IncomeReview[]) {
  const loaded = new Set(ids);
  const missing = [...new Set(reviews.map(review => review.includedTaskId).filter((id): id is string => Boolean(id) && !loaded.has(id!)))];
  if (!missing.length) return { days: [], reviews: [] };
  const result = await client.query(`select t.*, t.work_date::text as date_text from oak_driver_tasks t
    where exists(select 1 from oak_driver_tasks a where a.id=any($1::bigint[]) and t.import_id=a.import_id and t.driver_name=a.driver_name and t.work_date=a.work_date)
      and not(t.id=any($2::bigint[])) order by t.id`, [missing, ids]);
  const tasks = result.rows.map(taskFromRow);
  return { days: summarizeDriverTasks(tasks), reviews: await readIncomeReviews(client, tasks.map(task => task.id!)) };
}
export async function incomeTaskScope(taskId: string) {
  await ensureSystemSchema();
  return withSystemClient(async client => {
    const result = await client.query("select import_id::int, driver_name from oak_driver_tasks where id=$1", [taskId]);
    if (!result.rows[0]) throw new IncomeInputError("作业不存在，请刷新");
    return { importId: Number(result.rows[0].import_id), driverName: String(result.rows[0].driver_name) };
  });
}
export async function listIncomeRules() {
  await ensureSystemSchema();
  return withSystemClient(async client => {
    const rules = await readIncomeRules(client);
    const labels = await client.query(`select distinct btrim(nature) as label from oak_driver_tasks where nullif(btrim(nature), '') is not null order by label`);
    return { rules, workLabels: [...new Set([...labels.rows.map(row => String(row.label)), "提柜", "还柜", "空车", "带车架", "挪柜"])] };
  });
}
export async function saveIncomeRule(id: string | null, value: unknown) {
  let input;
  try { input = validateIncomeRule(value); } catch (error) { throw new IncomeInputError(error instanceof Error ? error.message : "收入标准无效"); }
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query("begin");
    try {
      await client.query("select pg_advisory_xact_lock(19431, 1)");
      const rules = await readIncomeRules(client);
      if (id && !rules.some(rule => String(rule.id) === id)) throw new IncomeInputError("收入标准不存在，请刷新");
      if (rules.some(rule => String(rule.id) !== id && rulesOverlap(rule, input))) throw new IncomeInputError("同作业、同路线的收入标准生效期重叠，请调整日期或编辑已有标准");
      const values = [input.name, input.workLabel, input.fromLocation, input.toLocation, input.amount, input.billingBasis, input.validFrom, input.validTo, input.active];
      const result = id ? await client.query(`update oak_income_rules set name=$1, work_label=$2, from_location=$3, to_location=$4,
        amount=$5, billing_basis=$6, valid_from=$7::date, valid_to=$8::date, active=$9, updated_at=now() where id=$10 returning id::int`, [...values, id])
        : await client.query(`insert into oak_income_rules(name,work_label,from_location,to_location,amount,billing_basis,valid_from,valid_to,active)
          values($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9) returning id::int`, values);
      await client.query("commit"); return result.rows[0];
    } catch (error) { await client.query("rollback"); throw error; }
  });
}
export async function deleteIncomeRule(id: string) {
  await ensureSystemSchema();
  return withSystemClient(async client => {
    const result = await client.query("delete from oak_income_rules where id=$1 returning id", [id]);
    if (!result.rowCount) throw new IncomeInputError("收入标准不存在");
    return { success: true };
  });
}

export async function saveIncomeReview(taskId: string, value: unknown) {
  let review: IncomeReview;
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("核对内容无效");
    const body = value as Record<string, unknown>;
    if (body.mode !== "label" && body.mode !== "manual" && body.mode !== "included") throw new Error("核对方式无效");
    review = { taskId, mode: body.mode, workLabel: incomeText(body.workLabel, 120, body.mode === "label"),
      amount: body.mode === "manual" ? incomeAmount(body.amount) : null,
      includedTaskId: body.mode === "included" ? incomeId(body.includedTaskId) : null,
      note: incomeText(body.note, 1000, body.mode !== "label") || "" };
  } catch (error) { throw new IncomeInputError(error instanceof Error ? error.message : "核对内容无效"); }
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query("begin");
    try {
      await client.query("select pg_advisory_xact_lock(19431, 2)");
      const taskResult = await client.query("select *, work_date::text as date_text from oak_driver_tasks where id=$1", [taskId]);
      const task = taskResult.rows[0];
      if (!task) throw new IncomeInputError("作业不存在，请刷新");
      const related = await client.query("select task_id::text, included_task_id::text from oak_task_income_reviews where task_id=$1 or included_task_id=$1", [taskId]);
      await assertIncomeTasksEditable(client, [taskId, ...(review.includedTaskId ? [review.includedTaskId] : []), ...related.rows.flatMap(row => [row.task_id, row.included_task_id].filter(Boolean))]);
      if (review.mode === "included") {
        const children = await client.query("select 1 from oak_task_income_reviews where included_task_id=$1 limit 1", [taskId]);
        if (children.rowCount) throw new IncomeInputError("这段作业已有其他路段并入，不能再并入另一段");
        const result = await client.query("select *, work_date::text as date_text from oak_driver_tasks where id=$1", [review.includedTaskId]);
        const anchor = result.rows[0];
        if (!anchor || String(anchor.id) === taskId || String(anchor.import_id) !== String(task.import_id) || anchor.driver_name !== task.driver_name) throw new IncomeInputError("只能并入同批次、同司机的主作业");
        const dayResult = await client.query("select *, work_date::text as date_text from oak_driver_tasks where driver_name=$1 and work_date=$2::date", [anchor.driver_name, anchor.date_text]);
        const dayTasks = dayResult.rows.map(taskFromRow);
        const rules = await readIncomeRules(client); const reviews = await readIncomeReviews(client, dayTasks.map(row => row.id!));
        const income = priceDriverDays([{ driverName: anchor.driver_name, workDate: anchor.date_text, taskCount: dayTasks.length, miles: null, tasks: dayTasks }], rules, reviews)[0].tasks.find(row => row.id === String(anchor.id))!.income!;
        if (income.status !== "priced" || (income.source === "rule" && income.billingBasis !== "trip")) throw new IncomeInputError("主作业需已有整趟收入或人工核定收入，请先核对主作业");
      }
      await client.query(`insert into oak_task_income_reviews(task_id,mode,work_label,amount,included_task_id,note)
        values($1,$2,$3,$4,$5,$6) on conflict(task_id) do update set mode=excluded.mode,work_label=excluded.work_label,
        amount=excluded.amount,included_task_id=excluded.included_task_id,note=excluded.note,updated_at=now()`,
      [taskId, review.mode, review.workLabel, review.amount, review.includedTaskId, review.note]);
      await client.query("commit"); return { success: true };
    } catch (error) { await client.query("rollback"); throw error; }
  });
}
export async function deleteIncomeReview(taskId: string) {
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query("begin");
    try {
      await client.query("select pg_advisory_xact_lock(19431, 2)");
      const related = await client.query("select task_id::text, included_task_id::text from oak_task_income_reviews where task_id=$1 or included_task_id=$1", [taskId]);
      await assertIncomeTasksEditable(client, [taskId, ...related.rows.flatMap(row => [row.task_id, row.included_task_id].filter(Boolean))]);
      await client.query("delete from oak_task_income_reviews where task_id=$1", [taskId]);
      await client.query("commit"); return { success: true };
    } catch (error) { await client.query("rollback"); throw error; }
  });
}

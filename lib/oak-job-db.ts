import { ensureSystemSchema, withSystemClient } from "./system-db";
import { assertIncomeTasksEditable, IncomeInputError, incomeId } from "./oak-income-db";
import { incomeText } from "./oak-income";
import { listDriverActivities } from "./oak-driver-db";

export async function saveJobGrouping(anchorId: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new IncomeInputError("归集内容无效");
  const body = value as Record<string, unknown>;
  if (body.confirmed !== true || !Array.isArray(body.taskIds) || body.taskIds.length > 300) throw new IncomeInputError("请确认选中作业属于同一笔收费业务（最多 300 段）");
  const selectedIds = [...new Set([anchorId, ...body.taskIds.map(incomeId)])];
  let note: string;
  try { note = incomeText(body.note, 1000, true)!; } catch (error) { throw new IncomeInputError((error as Error).message); }
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query("begin");
    try {
      await client.query("select pg_advisory_xact_lock(19431, 2)");
      const previous = await client.query("select task_id::text from oak_task_income_reviews where included_task_id=$1", [anchorId]);
      const allIds = [...new Set([...selectedIds, ...previous.rows.map(row => String(row.task_id))])];
      await assertIncomeTasksEditable(client, allIds);
      const tasks = await client.query("select id::text,import_id::text,driver_name from oak_driver_tasks where id=any($1::bigint[])", [allIds]);
      if (tasks.rows.length !== allIds.length) throw new IncomeInputError("作业已变化，请刷新后重试");
      const anchor = tasks.rows.find(row => row.id === anchorId)!;
      if (tasks.rows.some(row => row.driver_name !== anchor.driver_name || row.import_id !== anchor.import_id)) throw new IncomeInputError("只能归集同批次、同司机的作业，可跨日期");
      const reviews = await client.query("select task_id::text,mode,included_task_id::text from oak_task_income_reviews where task_id=any($1::bigint[])", [allIds]);
      if (reviews.rows.some(row => row.task_id === anchorId && row.mode === "included")) throw new IncomeInputError("主作业已并入其他任务，请先恢复自动后再归集");
      for (const row of reviews.rows) {
        if (row.task_id === anchorId || !selectedIds.includes(row.task_id)) continue;
        if (row.mode === "manual") throw new IncomeInputError("选中作业已有人工收入，请先核对是否另行收费并恢复自动，不能直接覆盖");
        if (row.mode === "included" && row.included_task_id !== anchorId) throw new IncomeInputError("选中作业已属于其他任务，请先解除原归属");
      }
      const childRoots = await client.query("select 1 from oak_task_income_reviews where included_task_id=any($1::bigint[]) limit 1", [selectedIds.filter(id => id !== anchorId)]);
      if (childRoots.rowCount) throw new IncomeInputError("选中作业本身已有附属路段，不能形成多层归集");
      if (selectedIds.length > 1) {
        const priced = await listDriverActivities({ driverName: anchor.driver_name, importId: Number(anchor.import_id), dateFrom: "", dateTo: "", search: "", page: 1, pageSize: 100 });
        const primary = priced.periods.flatMap(period => period.days.flatMap(day => day.tasks)).find(task => task.id === anchorId);
        if (primary?.income?.status === "priced" && primary.income.source === "rule" && primary.income.billingBasis !== "trip") throw new IncomeInputError("主作业当前按单段计价，请先设置整趟收入或人工核定，不能直接并入其他路段");
      }
      for (const id of previous.rows.map(row => String(row.task_id)).filter(id => !selectedIds.includes(id))) {
        await client.query("update oak_task_income_reviews set mode='label',amount=null,included_task_id=null,updated_at=now() where task_id=$1 and work_label is not null", [id]);
        await client.query("delete from oak_task_income_reviews where task_id=$1 and mode='included'", [id]);
      }
      for (const id of selectedIds.filter(id => id !== anchorId)) {
        await client.query(`insert into oak_task_income_reviews(task_id,mode,included_task_id,note) values($1,'included',$2,$3)
          on conflict(task_id) do update set mode='included',amount=null,included_task_id=excluded.included_task_id,note=excluded.note,updated_at=now()`, [id, anchorId, note]);
      }
      await client.query("insert into oak_workflow_audit(entity_kind,entity_id,event,details) values('job',$1,'归集任务',$2::jsonb)", [anchorId, JSON.stringify({ taskIds: selectedIds, previous: previous.rows.map(row => row.task_id), note })]);
      await client.query("commit"); return { success: true };
    } catch (error) { await client.query("rollback"); throw error; }
  });
}

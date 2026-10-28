import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { ensureSystemSchema, withSystemClient } from "./system-db";
import { listDriverActivities } from "./oak-driver-db";
import { IncomeInputError } from "./oak-income-db";
import { incomeAmount, incomeText } from "./oak-income";
import { csvCell, paymentBalance, settlementSnapshot, settlementTotals, settlementWeek, validateSettlement, workflowDate, type SettlementInput, type WeeklySettlement } from "./oak-workflow";

export async function settlementPreview(subject: string, weekStart: string) {
  try { workflowDate(weekStart); incomeText(subject, 120, true); } catch (error) { throw new IncomeInputError((error as Error).message); }
  const week = settlementWeek(weekStart);
  const data = await listDriverActivities({ driverName: subject, dateFrom: week.start, dateTo: week.end, search: "", importId: null, page: 1, pageSize: 100 });
  try {
    const snapshot = settlementSnapshot(subject, week.start, data.periods.flatMap(period => period.days.flatMap(day => day.tasks)));
    return { snapshot, sourceHash: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex") };
  } catch (error) { throw new IncomeInputError((error as Error).message); }
}
async function audit(client: PoolClient, id: string, event: string, details: Record<string, unknown>) {
  await client.query("insert into oak_workflow_audit(entity_kind,entity_id,event,details) values('settlement',$1,$2,$3::jsonb)", [id, event, JSON.stringify(details)]);
}
function normalize(row: Record<string, unknown>): WeeklySettlement {
  const payments = (row.payments || []) as WeeklySettlement["payments"];
  const totalAmount = Number(row.total_amount);
  return { id: String(row.id), subject: String(row.subject), weekStart: String(row.week_start), weekEnd: String(row.week_end),
    payeeName: String(row.payee_name), payeeType: row.payee_type as WeeklySettlement["payeeType"], baseAmount: Number(row.base_amount),
    adjustments: row.adjustments as WeeklySettlement["adjustments"], totalAmount, note: String(row.note), status: row.status as WeeklySettlement["status"],
    snapshot: row.snapshot as WeeklySettlement["snapshot"], confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null, updatedAt: String(row.updated_at),
    payments, ...paymentBalance(totalAmount, payments), audit: (row.audit || []) as WeeklySettlement["audit"] };
}
export async function listSettlements(weekStart: string) {
  let week;
  try { week = settlementWeek(weekStart); } catch (error) { throw new IncomeInputError((error as Error).message); }
  await ensureSystemSchema();
  return withSystemClient(async client => {
    const result = await client.query(`select s.*,s.week_start::text,s.week_end::text,s.confirmed_at::text,s.updated_at::text,
      coalesce((select jsonb_agg(jsonb_build_object('id',p.id::text,'amount',p.amount::float8,'date',p.payment_date::text,'reference',p.reference,'note',p.note,'voided',p.voided_at is not null,'voidReason',p.void_reason) order by p.id) from oak_settlement_payments p where p.settlement_id=s.id),'[]') as payments,
      coalesce((select jsonb_agg(jsonb_build_object('event',a.event,'at',a.created_at::text,'details',a.details) order by a.id desc) from oak_workflow_audit a where a.entity_kind='settlement' and a.entity_id=s.id),'[]') as audit
      from oak_weekly_settlements s where s.week_start=$1::date order by s.subject,s.id`, [week.start]);
    return { week, settlements: result.rows.map(normalize) };
  });
}
export async function getSettlement(id: string) {
  await ensureSystemSchema();
  const week = await withSystemClient(async client => {
    const result = await client.query("select week_start::text from oak_weekly_settlements where id=$1", [id]);
    if (!result.rows[0]) throw new IncomeInputError("结算单不存在"); return String(result.rows[0].week_start);
  });
  const record = (await listSettlements(week)).settlements.find(record => record.id === id);
  if (!record) throw new IncomeInputError("结算单不存在"); return record;
}
export async function saveSettlement(id: string | null, value: unknown) {
  let input: SettlementInput;
  try { input = validateSettlement(value); } catch (error) { throw new IncomeInputError((error as Error).message); }
  const totals = settlementTotals(input); const week = settlementWeek(input.weekStart);
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query("begin");
    try {
      await client.query("select pg_advisory_xact_lock(19431, 2)");
      if (id) {
        const current = await client.query("select status from oak_weekly_settlements where id=$1 for update", [id]);
        if (!current.rows[0] || current.rows[0].status !== "draft") throw new IncomeInputError("只能修改草稿，已确认结算不可覆盖");
      }
      const source = await settlementPreview(input.subject, input.weekStart);
      if (source.snapshot.payeeConflict) throw new IncomeInputError("本周同一归属存在不同身份，请先核对导入归属，不能混算车主价格和司机工资");
      if (source.snapshot.payeeType && source.snapshot.payeeType !== input.payeeType) throw new IncomeInputError(source.snapshot.payeeType === "owner" ? "这周作业属于车主，应按车主价格结算，不能按司机工资保存" : "这周作业属于司机，应按司机工资结算，不能按车主价格保存");
      const values = [input.subject, week.start, week.end, input.payeeName, input.payeeType, input.baseAmount,
        JSON.stringify(input.adjustments), totals.totalAmount, input.note, JSON.stringify(source.snapshot), source.sourceHash];
      const result = id ? await client.query(`update oak_weekly_settlements set subject=$1,week_start=$2::date,week_end=$3::date,payee_name=$4,payee_type=$5,base_amount=$6,
        adjustments=$7::jsonb,total_amount=$8,note=$9,snapshot=$10::jsonb,source_hash=$11,updated_at=now() where id=$12 returning id::text`, [...values, id])
        : await client.query(`insert into oak_weekly_settlements(subject,week_start,week_end,payee_name,payee_type,base_amount,adjustments,total_amount,note,snapshot,source_hash)
          values($1,$2::date,$3::date,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,$11) returning id::text`, values);
      const savedId = String(result.rows[0].id);
      await client.query("delete from oak_settlement_tasks where settlement_id=$1", [savedId]);
      await client.query("insert into oak_settlement_tasks(settlement_id,task_id) select $1,unnest($2::bigint[])", [savedId, source.snapshot.tasks.map(task => task.id)]);
      await audit(client, savedId, id ? "更新草稿" : "创建草稿", { ...input, totalAmount: totals.totalAmount, taskCount: source.snapshot.tasks.length });
      await client.query("commit"); return { id: savedId };
    } catch (error) {
      await client.query("rollback");
      if ((error as { code?: string }).code === "23505") throw new IncomeInputError("该司机本周已有结算单，或作业已进入其他结算单，请勿重复结算");
      throw error;
    }
  });
}
export async function confirmSettlement(id: string) {
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query("begin");
    try {
      await client.query("select pg_advisory_xact_lock(19431, 2)");
      const result = await client.query("select subject,week_start::text,status,source_hash from oak_weekly_settlements where id=$1 for update", [id]);
      const record = result.rows[0];
      if (!record || record.status !== "draft") throw new IncomeInputError("只能确认草稿，请刷新结算单");
      const source = await settlementPreview(record.subject, record.week_start);
      if (source.sourceHash !== record.source_hash) throw new IncomeInputError("作业或收入计价已变化，请编辑并保存草稿后再确认");
      await client.query("update oak_weekly_settlements set status='confirmed',confirmed_at=now(),updated_at=now() where id=$1", [id]);
      await audit(client, id, "确认结算", { sourceHash: source.sourceHash });
      await client.query("commit"); return { success: true };
    } catch (error) { await client.query("rollback"); throw error; }
  });
}
export async function deleteSettlement(id: string) {
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query("begin");
    try {
      await client.query("select pg_advisory_xact_lock(19431, 2)");
      const result = await client.query("delete from oak_weekly_settlements where id=$1 and status='draft' returning id", [id]);
      if (!result.rowCount) throw new IncomeInputError("只能删除草稿，已确认结算需保留记录");
      await audit(client, id, "删除草稿", {}); await client.query("commit"); return { success: true };
    } catch (error) { await client.query("rollback"); throw error; }
  });
}
export async function addSettlementPayment(id: string, value: unknown) {
  let amount: number; let date: string; let reference: string; let note: string;
  try {
    if (!value || typeof value !== "object") throw new Error("付款记录无效");
    const body = value as Record<string, unknown>;
    amount = incomeAmount(body.amount); if (amount <= 0) throw new Error("付款金额必须大于零");
    date = workflowDate(body.date); reference = incomeText(body.reference, 200, true)!; note = incomeText(body.note, 1000) || "";
  } catch (error) { throw new IncomeInputError((error as Error).message); }
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query("begin");
    try {
      const current = await client.query("select status,total_amount::float8 from oak_weekly_settlements where id=$1 for update", [id]);
      if (current.rows[0]?.status !== "confirmed") throw new IncomeInputError("请先确认结算单，再登记付款");
      const paid = await client.query("select coalesce(sum(amount),0)::float8 as amount from oak_settlement_payments where settlement_id=$1 and voided_at is null", [id]);
      if (Math.round(amount * 100) > Math.round(current.rows[0].total_amount * 100) - Math.round(paid.rows[0].amount * 100)) throw new IncomeInputError("付款金额超过剩余应付，未保存");
      const duplicate = await client.query("select 1 from oak_settlement_payments where settlement_id=$1 and reference=$2 and voided_at is null", [id, reference]);
      if (duplicate.rowCount) throw new IncomeInputError("这张结算单已有相同付款凭证，请核对是否重复提交");
      const result = await client.query("insert into oak_settlement_payments(settlement_id,amount,payment_date,reference,note) values($1,$2,$3::date,$4,$5) returning id::text", [id, amount, date, reference, note]);
      await audit(client, id, "登记付款", { paymentId: result.rows[0].id, amount, date, reference, note });
      await client.query("commit"); return { success: true };
    } catch (error) { await client.query("rollback"); throw error; }
  });
}
export async function voidSettlementPayment(id: string, paymentId: string, reason: string) {
  try { incomeText(reason, 1000, true); } catch (error) { throw new IncomeInputError((error as Error).message); }
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query("begin");
    try {
      await client.query("select id from oak_weekly_settlements where id=$1 for update", [id]);
      const result = await client.query("update oak_settlement_payments set voided_at=now(),void_reason=$3 where id=$2 and settlement_id=$1 and voided_at is null returning amount::float8", [id, paymentId, reason.trim()]);
      if (!result.rowCount) throw new IncomeInputError("付款记录不存在或已作废");
      await audit(client, id, "作废付款", { paymentId, amount: result.rows[0].amount, reason });
      await client.query("commit"); return { success: true };
    } catch (error) { await client.query("rollback"); throw error; }
  });
}
export function settlementCsv(record: WeeklySettlement) {
  const rows: unknown[][] = [["周结算单", `#${record.id}`], ["状态", record.status === "draft" ? "草稿" : "已确认"],
    ["周期", record.weekStart, record.weekEnd], ["作业归属", record.subject], ["收款对象", record.payeeName], ["类型", record.payeeType === "driver" ? "司机工资" : "车主价格"],
    [record.payeeType === "driver" ? "司机工资" : "车主价格", record.baseAmount], ...record.adjustments.map(item => [item.kind === "allowance" ? "补贴" : "扣款", item.title, item.amount]),
    ["应付合计", record.totalAmount], ["已登记付款", record.paidAmount], ["未付", paymentBalance(record.totalAmount, record.payments).remaining], ["结算依据", record.note], [],
    ["作业收入参考（不参与应付计算）", record.snapshot.revenue.amount, "待计价路段", record.snapshot.revenue.pendingCount],
    ["日期", "作业", "柜号", "起点", "终点", "原表里程", "已计价收入", "收入状态", "原文件", "工作表", "行"]];
  rows.push(...record.snapshot.tasks.map(task => [task.date, task.work, task.reference, task.from, task.to, task.miles, task.income?.amount ?? "", task.income?.status, task.file, task.sheet, task.row]));
  rows.push([], ["付款日期", "金额", "凭证", "备注", "状态", "作废原因"], ...record.payments.map(payment => [payment.date, payment.amount, payment.reference, payment.note, payment.voided ? "已作废" : "有效", payment.voidReason]));
  return `\uFEFF${rows.map(row => row.map(csvCell).join(",")).join("\r\n")}`;
}

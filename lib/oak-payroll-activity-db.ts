import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { IncomeActivitySource } from './oak-income-coverage';
import type { VehicleAmount } from './oak-vehicle-amounts';
import { matchesPayrollActivityLink, type PayrollActivityLink, type PayrollActivityTarget } from './oak-payroll-activity';
import { vehicleForSubject, type OakVehicle } from './oak-vehicles';
import { ensureSystemSchema, withSystemClient } from './system-db';
import { IncomeInputError } from './oak-income-db';
import type { VehicleRange } from './oak-vehicle-accounting';

type PayrollWage = Pick<VehicleAmount, 'id' | 'version' | 'category' | 'payeeType' | 'vehicleId' | 'dateFrom' | 'dateTo' | 'payroll'>;
export type ActivityLeg = {
  id: string; workDate: string; reference: string | null; nature: string | null;
  fromLocation: string | null; toLocation: string | null; miles: number | null; sourceRow: number; section?: string;
};
type ActivityCandidate = ActivityLeg & {
  batchId: string; fileHash: string; driverName: string; payeeType: VehicleAmount['payeeType'];
};
export type PayrollActivityPreview = {
  fileName: string; sheetName: string; dateFrom: string; dateTo: string;
  candidate: { legs: ActivityLeg[]; token: string } | null;
};
export type PayrollActivityBatchRow = {
  wageId: string; vehicleNumber: string | null; driverName: string; sheetName: string;
  candidate: PayrollActivityPreview['candidate'];
};
export type PayrollActivityBatchPreview = VehicleRange & { fileName: string; rows: PayrollActivityBatchRow[] };
const wageColumns = `id::text,version,category,payee_type as "payeeType",vehicle_id as "vehicleId",
  date_from::text as "dateFrom",date_to::text as "dateTo",payroll_source as payroll`;

export function payrollActivityCandidate(wage: PayrollWage, rows: ActivityCandidate[], vehicles: OakVehicle[]) {
  if (!wage.payroll || wage.payroll.activityLink || !rows.length) return null;
  const { batchId, fileHash } = rows[0];
  if (fileHash === wage.payroll.fileHash || rows.some(row => row.batchId !== batchId
    || row.workDate < wage.dateFrom || row.workDate > wage.dateTo
    || vehicleForSubject(vehicles, row.driverName)?.id !== wage.vehicleId
    || (row.payeeType && row.payeeType !== wage.payeeType))) return null;
  const legs = rows.map(({ batchId: _batch, fileHash: _hash, driverName: _driver, payeeType: _payee, ...leg }) => leg);
  const target = { fileHash, sheetName: wage.payroll.sheetName, vehicleId: wage.vehicleId,
    dateFrom: wage.dateFrom, dateTo: wage.dateTo, taskIds: legs.map(leg => leg.id) };
  const token = createHash('sha256').update(JSON.stringify([wage.id, wage.version, batchId, target, legs])).digest('hex');
  return { target, legs, token };
}

async function withPayrollActivity<T>(wageId: string, write: boolean, fn: (client: PoolClient, wage: PayrollWage) => Promise<T>) {
  if (!/^[1-9]\d{0,14}$/.test(wageId)) throw new IncomeInputError('工资记录无效');
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query(write ? 'begin' : 'begin isolation level repeatable read read only');
    try {
      await client.query('select pg_advisory_xact_lock_shared(19431,0)');
      if (write) for (const lock of [2, 3]) await client.query('select pg_advisory_xact_lock(19431,$1)', [lock]);
      const { rows: [wage] } = await client.query<PayrollWage>(`select ${wageColumns}
        from oak_vehicle_amounts where id=$1 and category='labor' and voided_at is null`, [wageId]);
      if (!wage?.payroll) throw new IncomeInputError('找不到这笔 Excel 工资记录，请刷新');
      const result = await fn(client, wage);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  });
}

async function readActivityCandidates(client: PoolClient, source: PayrollWage, wages: PayrollWage[]) {
  const { rows } = await client.query<ActivityCandidate & { sheetName: string }>(`select i.id::text as "batchId",i.file_hash as "fileHash",t.id::text,t.driver_name as "driverName",
        t.payee_type as "payeeType",t.work_date::text as "workDate",t.reference,t.nature,t.from_location as "fromLocation",
        t.to_location as "toLocation",t.miles::float8,t.source_row as "sourceRow",t.section,t.sheet_name as "sheetName"
        from oak_driver_imports i join oak_driver_tasks t on t.import_id=i.id
        where i.file_name=$1 and t.sheet_name=any($2::text[]) and i.period_from=$3::date and i.period_to=$4::date
        order by t.work_date,t.section,t.source_row,t.id`, [source.payroll!.fileName, wages.map(wage => wage.payroll!.sheetName), source.dateFrom, source.dateTo]);
  const vehicles = (await client.query<OakVehicle>(
    'select id,vehicle_number as "vehicleNumber",driver_name as "driverName",aliases,version from oak_vehicles',
  )).rows;
  const bySheet = new Map<string, ActivityCandidate[]>();
  for (const { sheetName, ...row } of rows) {
    const sheet = bySheet.get(sheetName) || [];
    sheet.push(row);
    bySheet.set(sheetName, sheet);
  }
  return wages.map(wage => {
    const legs = bySheet.get(wage.payroll!.sheetName) || [];
    return { wage, vehicle: vehicles.find(vehicle => vehicle.id === wage.vehicleId),
      sameFile: legs.some(leg => leg.fileHash === wage.payroll!.fileHash), candidate: payrollActivityCandidate(wage, legs, vehicles) };
  });
}

const previewCandidate = (candidate: ReturnType<typeof payrollActivityCandidate>) =>
  candidate ? { legs: candidate.legs, token: candidate.token } : null;

export async function reconcilePayrollActivity(wageId: string, confirmedToken?: string): Promise<PayrollActivityPreview> {
  if (confirmedToken !== undefined && !/^[a-f0-9]{64}$/.test(confirmedToken)) throw new IncomeInputError('核对凭据无效');
  return withPayrollActivity(wageId, confirmedToken !== undefined, async (client, wage) => {
    const [{ candidate }] = await readActivityCandidates(client, wage, [wage]);
    if (confirmedToken !== undefined) {
      if (!candidate || candidate.token !== confirmedToken) throw new IncomeInputError('工资或已有作业已变化，请重新核对');
      await savePayrollActivityLink(client, wage, candidate.target, '核对同车、同周期、同名工作表的已有作业后确认关联');
    }
    const { fileName, sheetName } = wage.payroll!;
    return { fileName, sheetName, dateFrom: wage.dateFrom, dateTo: wage.dateTo, candidate: previewCandidate(candidate) };
  });
}

type BatchEntry = Awaited<ReturnType<typeof readActivityCandidates>>[number];

export function selectPayrollActivityBatch(entries: BatchEntry[], value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new IncomeInputError('请选择 1 至 100 笔待关联工资');
  const used = new Set<string>();
  return value.map(item => {
    if (typeof item?.wageId !== 'string' || typeof item?.token !== 'string' || used.has(item.wageId)) {
      throw new IncomeInputError('核对内容无效或重复');
    }
    used.add(item.wageId);
    const entry = entries.find(entry => entry.wage.id === item.wageId);
    if (!entry?.vehicle?.vehicleNumber || !entry.candidate || entry.candidate.token !== item.token ||
      entries.some(other => other !== entry && other.wage.vehicleId === entry.wage.vehicleId)) {
      throw new IncomeInputError('选中的工资或作业已变化，或车号未确认，请重新核对');
    }
    return { wage: entry.wage, target: entry.candidate.target };
  });
}

export async function reconcilePayrollActivityBatch(wageId: string, selection?: unknown): Promise<PayrollActivityBatchPreview> {
  return withPayrollActivity(wageId, selection !== undefined, async (client, source) => {
    const { fileName, fileHash } = source.payroll!;
    const { dateFrom, dateTo } = source;
    const { rows: wages } = await client.query<PayrollWage>(`select ${wageColumns} from oak_vehicle_amounts
      where category='labor' and voided_at is null and date_from=$1::date and date_to=$2::date
        and payroll_source->>'fileName'=$3 and payroll_source->>'fileHash'=$4
      order by id`, [dateFrom, dateTo, fileName, fileHash]);
    const entries = (await readActivityCandidates(client, source, wages))
      .filter(entry => !entry.wage.payroll!.activityLink && !entry.sameFile)
      .map(entry => wages.some(wage => wage.id !== entry.wage.id && wage.vehicleId === entry.wage.vehicleId)
        ? {...entry, candidate:null} : entry);
    if (selection !== undefined) {
      for (const { wage, target } of selectPayrollActivityBatch(entries, selection)) {
        await savePayrollActivityLink(client, wage, target, '批量核对同车、同周期、同名工作表的已有作业后确认关联');
      }
    }
    const rows = entries.map(({ wage, vehicle, candidate }) => ({
      wageId: wage.id, vehicleNumber: vehicle?.vehicleNumber || null, driverName: vehicle?.driverName || wage.payroll!.sheetName,
      sheetName: wage.payroll!.sheetName, candidate: previewCandidate(candidate),
    }));
    return { dateFrom, dateTo, fileName, rows };
  });
}

export async function readIncomeActivitySources(client: PoolClient, vehicles: OakVehicle[]): Promise<IncomeActivitySource[]> {
  const { rows } = await client.query(`select i.file_hash as "fileHash",t.sheet_name as "sheetName",t.driver_name as "driverName",
    i.period_from::text as "dateFrom",i.period_to::text as "dateTo",jsonb_agg(t.id::text order by t.id) as "taskIds"
    from oak_driver_imports i join oak_driver_tasks t on t.import_id=i.id group by i.id,t.sheet_name,t.driver_name`);
  return rows.map(({driverName, ...source}) => {
    const vehicle = vehicleForSubject(vehicles, driverName);
    return {fileHash: source.fileHash, sheetNames: [source.sheetName], target: vehicle ? {...source, vehicleId: vehicle.id} : undefined};
  });
}

// The caller holds the work and ledger locks for the source validation and this audit write.
export async function savePayrollActivityLink(client: PoolClient, wage: PayrollWage, target: PayrollActivityTarget, reason: string) {
  if (!wage.payroll || wage.category !== 'labor' || target.vehicleId !== wage.vehicleId
    || target.dateFrom !== wage.dateFrom || target.dateTo !== wage.dateTo || !target.taskIds.length || !reason.trim()) {
    throw Error('工资与作业的车辆或周期不一致，不能关联');
  }
  if (matchesPayrollActivityLink(wage, target)) return;
  if (wage.payroll.activityLink) throw Error('此工资已关联另一组作业，请先核对');
  const link: PayrollActivityLink = {...target, dateFrom: wage.dateFrom, dateTo: wage.dateTo};
  const result = await client.query(`update oak_vehicle_amounts set payroll_source=jsonb_set(payroll_source,'{activityLink}',$3::jsonb),
    version=version+1,updated_at=now() where id=$1 and version=$2 and voided_at is null returning id`, [wage.id, wage.version, JSON.stringify(link)]);
  if (!result.rowCount) throw Error('工资记录已变化，请重新核对');
  await client.query(`insert into oak_workflow_audit(entity_kind,entity_id,event,details) values('vehicle_amount',$1,'关联已有周表作业',$2::jsonb)`,
    [wage.id, JSON.stringify({link, reason})]);
}

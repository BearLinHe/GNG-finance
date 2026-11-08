import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { IncomeActivitySource } from './oak-income-coverage';
import type { VehicleAmount } from './oak-vehicle-amounts';
import { matchesPayrollActivityLink, type PayrollActivityLink, type PayrollActivityTarget } from './oak-payroll-activity';
import { vehicleForSubject, type OakVehicle } from './oak-vehicles';
import { ensureSystemSchema, withSystemClient } from './system-db';
import { IncomeInputError } from './oak-income-db';

type PayrollWage = Pick<VehicleAmount, 'id' | 'version' | 'category' | 'payeeType' | 'vehicleId' | 'dateFrom' | 'dateTo' | 'payroll'>;
type ActivityLeg = {
  id: string; workDate: string; reference: string | null; nature: string | null;
  fromLocation: string | null; toLocation: string | null; miles: number | null; sourceRow: number;
};
type ActivityCandidate = ActivityLeg & {
  batchId: string; fileHash: string; driverName: string; payeeType: VehicleAmount['payeeType'];
};
export type PayrollActivityPreview = {
  fileName: string; sheetName: string; dateFrom: string; dateTo: string;
  candidate: { legs: ActivityLeg[]; token: string } | null;
};

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

export async function reconcilePayrollActivity(wageId: string, confirmedToken?: string): Promise<PayrollActivityPreview> {
  if (!/^[1-9]\d{0,14}$/.test(wageId) || (confirmedToken !== undefined && !/^[a-f0-9]{64}$/.test(confirmedToken))) {
    throw new IncomeInputError('工资记录或核对凭据无效');
  }
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query(confirmedToken ? 'begin' : 'begin isolation level repeatable read read only');
    try {
      await client.query('select pg_advisory_xact_lock_shared(19431,0)');
      if (confirmedToken) for (const lock of [2, 3]) await client.query('select pg_advisory_xact_lock(19431,$1)', [lock]);
      const { rows: [wage] } = await client.query<PayrollWage>(`select id::text,version,category,payee_type as "payeeType",vehicle_id as "vehicleId",
        date_from::text as "dateFrom",date_to::text as "dateTo",payroll_source as payroll
        from oak_vehicle_amounts where id=$1 and category='labor' and voided_at is null`, [wageId]);
      if (!wage?.payroll) throw new IncomeInputError('找不到这笔 Excel 工资记录，请刷新');
      const { fileName, sheetName } = wage.payroll;
      const { rows } = await client.query<ActivityCandidate>(`select i.id::text as "batchId",i.file_hash as "fileHash",t.id::text,t.driver_name as "driverName",
        t.payee_type as "payeeType",t.work_date::text as "workDate",t.reference,t.nature,t.from_location as "fromLocation",
        t.to_location as "toLocation",t.miles::float8,t.source_row as "sourceRow"
        from oak_driver_imports i join oak_driver_tasks t on t.import_id=i.id
        where i.file_name=$1 and t.sheet_name=$2 and i.period_from=$3::date and i.period_to=$4::date
        order by t.work_date,t.section,t.source_row,t.id`, [fileName, sheetName, wage.dateFrom, wage.dateTo]);
      const vehicles = rows.length ? (await client.query<OakVehicle>(
        'select id,vehicle_number as "vehicleNumber",driver_name as "driverName",aliases,version from oak_vehicles',
      )).rows : [];
      const candidate = payrollActivityCandidate(wage, rows, vehicles);
      if (confirmedToken) {
        if (!candidate || candidate.token !== confirmedToken) throw new IncomeInputError('工资或已有作业已变化，请重新核对');
        await savePayrollActivityLink(client, wage, candidate.target, '核对同车、同周期、同名工作表的已有作业后确认关联');
      }
      await client.query('commit');
      return { fileName, sheetName, dateFrom: wage.dateFrom, dateTo: wage.dateTo,
        candidate: candidate ? { legs: candidate.legs, token: candidate.token } : null };
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
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

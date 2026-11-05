import type { PoolClient } from 'pg';
import type { IncomeActivitySource } from './oak-income-coverage';
import type { VehicleAmount } from './oak-vehicle-amounts';
import { matchesPayrollActivityLink, type PayrollActivityLink, type PayrollActivityTarget } from './oak-payroll-activity';
import { vehicleForSubject, type OakVehicle } from './oak-vehicles';

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
export async function savePayrollActivityLink(client: PoolClient, wage: VehicleAmount, target: PayrollActivityTarget, reason: string) {
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

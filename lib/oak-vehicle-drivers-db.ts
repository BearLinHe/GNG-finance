import type { PoolClient } from 'pg';
import { IncomeInputError, incomeId } from './oak-income-db';
import { incomeText } from './oak-income';
import { ensureSystemSchema, withSystemClient } from './system-db';
import { workflowDate } from './oak-workflow';
import type { VehicleDriverChange } from './oak-vehicle-drivers';

export const vehicleDriverHistoryQuery = `select id::text, vehicle_id as "vehicleId", driver_name as "driverName",
  case when isfinite(effective_date) then effective_date::text end as "effectiveDate", version from oak_vehicle_driver_history`;

function validated<T>(parse: () => T): T {
  try { return parse(); }
  catch (error) { throw new IncomeInputError((error as Error).message); }
}

async function readHistory(client: PoolClient, vehicleId: string) {
  return (await client.query<VehicleDriverChange>(`${vehicleDriverHistoryQuery} where vehicle_id=$1 order by effective_date desc`, [vehicleId])).rows;
}

export async function listVehicleDriverHistory(value: unknown) {
  const vehicleId = validated(() => incomeText(value, 60, true)!);
  await ensureSystemSchema();
  return withSystemClient(async client => ({ changes: await readHistory(client, vehicleId) }));
}

export async function writeVehicleDriverHistory(value: unknown, remove = false) {
  const input = validated(() => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('司机记录无效');
    const body = value as Record<string, unknown>;
    const id = body.id == null && !remove ? null : incomeId(body.id);
    if (id && (!Number.isSafeInteger(body.version) || Number(body.version) < 1)) throw Error('记录版本无效');
    return { id, version: Number(body.version), vehicleId: incomeText(body.vehicleId, 60, true)!,
      driverName: remove ? null : incomeText(body.driverName, 120, true)!, effectiveDate: remove ? null : workflowDate(body.effectiveDate) };
  });
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query('begin');
    try {
      await client.query('select pg_advisory_xact_lock_shared(19431,0)');
      const vehicle = (await client.query<{driver_name:string}>('select driver_name from oak_vehicles where id=$1 for update', [input.vehicleId])).rows[0];
      if (!vehicle) throw new IncomeInputError('车辆不存在');
      const changes = await readHistory(client, input.vehicleId);
      const before = changes.find(change => change.id === input.id && change.effectiveDate !== null);
      if (input.id && (!before || before.version !== input.version)) throw new IncomeInputError('司机记录已变化，请重新打开后核对');
      if (!remove && changes.some(change => change.id !== input.id && change.effectiveDate === input.effectiveDate)) {
        throw new IncomeInputError('此日期已登记司机，请修改已有记录');
      }
      let id: string;
      if (remove) {
        id = before!.id;
        await client.query('delete from oak_vehicle_driver_history where id=$1', [id]);
      } else if (before) {
        id = before.id;
        await client.query(`update oak_vehicle_driver_history set driver_name=$2,effective_date=$3::date,version=version+1,updated_at=now() where id=$1`,
          [id, input.driverName, input.effectiveDate]);
      } else {
        // Freeze the display baseline without changing the original source-sheet identity.
        await client.query(`insert into oak_vehicle_driver_history(vehicle_id,driver_name,effective_date) values($1,$2,'-infinity'::date)
          on conflict(vehicle_id,effective_date) do nothing`, [input.vehicleId, vehicle.driver_name]);
        id = (await client.query<{id:string}>(`insert into oak_vehicle_driver_history(vehicle_id,driver_name,effective_date)
          values($1,$2,$3::date) returning id::text`, [input.vehicleId, input.driverName, input.effectiveDate])).rows[0].id;
      }
      const next = await readHistory(client, input.vehicleId);
      await client.query(`insert into oak_workflow_audit(entity_kind,entity_id,event,details) values('vehicle_driver',$1,$2,$3::jsonb)`,
        [id, remove ? '删除司机显示记录' : before ? '修改司机显示记录' : '登记司机显示记录',
          JSON.stringify({ vehicleId: input.vehicleId, before: before ?? null, after: next.find(change => change.id === id) ?? null })]);
      await client.query('commit');
      return { changes: next };
    } catch (error) { await client.query('rollback'); throw error; }
  });
}

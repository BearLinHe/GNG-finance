import type { PoolClient } from 'pg';
import { davidDriverKey, effectiveDriverTimelines, davidTrialRange, driverDirectory, driverProfit, hasSharedUse, validateDriverUses, type DriverTimeline } from './oak-driver-accounting';
import { readRepairFeed } from './oak-repair-db';
import { readFuelMileageData } from './oak-fuel-db';
import type { FuelMileageContext } from './oak-fuel';
import { incomeActivityGaps } from './oak-income-coverage';
import { IncomeInputError, readRatedDriverTasks } from './oak-income-db';
import { readIncomeActivitySources } from './oak-payroll-activity-db';
import type { ProfitSettlement } from './oak-period-profit';
import { vehicleRange } from './oak-vehicle-accounting';
import { readVehicleAmounts } from './oak-vehicle-amounts-db';
import type { OakVehicle } from './oak-vehicles';
import { withSystemClient } from './system-db';

const getVehicles = async (client: PoolClient) => (await client.query<OakVehicle>(`select id,vehicle_number as "vehicleNumber",driver_name as "driverName",aliases,version from oak_vehicles order by id`)).rows;
const getNames = async (client: PoolClient) => (await client.query<{ name: string }>(`select distinct driver_name as name from oak_driver_tasks
  union select distinct payroll_source->>'sheetName' from oak_vehicle_amounts where category='labor' and voided_at is null and payroll_source is not null
  union select distinct subject from oak_weekly_settlements where status='confirmed'`)).rows.flatMap(row => row.name ? [row.name] : []);
async function getTimelines(client: PoolClient, vehicles: OakVehicle[]): Promise<DriverTimeline[]> {
  const exists = (await client.query<{ present: boolean }>(`select to_regclass('oak_driver_vehicle_timelines') is not null as present`)).rows[0].present;
  const timelines = exists ? (await client.query<DriverTimeline>(`select driver_key as "driverKey",version,uses from oak_driver_vehicle_timelines`)).rows : [];
  return effectiveDriverTimelines(timelines, vehicles);
}

export async function readDriverAccounting(params: URLSearchParams) {
  let range = davidTrialRange;
  if (params.has('dateFrom') || params.has('dateTo')) {
    try { range = vehicleRange(Object.fromEntries(params)); }
    catch (error) { throw new IncomeInputError((error as Error).message); }
  }
  const driverKey = params.get('driverKey') || davidDriverKey;
  return withSystemClient(async client => {
    await client.query('begin isolation level repeatable read read only');
    try {
      const vehicles = await getVehicles(client);
      const { keyFor, drivers } = driverDirectory(vehicles, await getNames(client));
      if (!drivers.some(driver => driver.key === driverKey)) throw new IncomeInputError('未找到该司机');
      const timelines = await getTimelines(client, vehicles);
      const timeline = timelines.find(item => item.driverKey === driverKey) ?? { driverKey, version: 0, uses: [] };
      const repairPromise = readRepairFeed(vehicles);
      const tasks = await readRatedDriverTasks(client, range, vehicles);
      const amounts = await readVehicleAmounts(client, range);
      const sources = await readIncomeActivitySources(client, vehicles);
      const settlements = (await client.query<ProfitSettlement>(`select s.id::text,s.subject,s.week_start::text as "weekStart",s.week_end::text as "weekEnd",
        s.payee_type as "payeeType",s.base_amount::float8 as "baseAmount",s.adjustments,s.status,'[]'::jsonb as "taskIds"
        from oak_weekly_settlements s where s.status='confirmed' and s.week_start<=$2::date and s.week_end>=$1::date`, [range.dateFrom, range.dateTo])).rows;
      const fuel = amounts.filter(item => item.category === 'fuel' && timeline.uses.some(use => use.vehicleId === item.vehicleId && (!use.dateFrom || use.dateFrom <= item.dateTo) && (!use.dateTo || use.dateTo >= item.dateFrom)));
      const mileage: Record<string, FuelMileageContext> = Object.create(null);
      if (fuel.length && (driverKey !== davidDriverKey || range.dateFrom < '2026-08-01' || range.dateTo > '2026-10-31')) {
        const from = fuel.map(item => item.dateFrom).sort()[0];
        const to = fuel.map(item => item.dateTo).sort().at(-1)!;
        const data = await readFuelMileageData(client, from, to);
        const get = (key: string) => mileage[key] ??= { days: [], coverage: [], gaps: [] };
        for (const day of data.days) {
          const key = keyFor(day.driverName);
          if (key) get(key).days.push(day);
        }
        for (const source of data.sources) {
          const key = keyFor(source.driverName);
          if (key && source.dateFrom && source.dateTo) get(key).coverage.push({ dateFrom: source.dateFrom, dateTo: source.dateTo });
        }
        for (const wage of incomeActivityGaps(data.wages, sources, { dateFrom: from, dateTo: to })) {
          const key = keyFor(wage.sheetName);
          if (key) get(key).gaps.push({ ...wage, reason: `尚未同步作业：${wage.fileName}` });
        }
      }
      const repair = await repairPromise;
      const invoices = repair.records.filter(r => r.dateFrom <= range.dateTo && r.dateTo >= range.dateFrom);
      const profit = driverProfit({ range, timeline, timelines, vehicles, tasks, amounts: [...amounts, ...invoices], repairStatus: repair.status, sources, keyFor, settlements, mileage });
      await client.query('commit');
      return { drivers, vehicles: vehicles.filter(vehicle => vehicle.vehicleNumber).map(({ id, vehicleNumber }) => ({ id, vehicleNumber })), timeline, profit };
    } catch (error) { await client.query('rollback'); throw error; }
  });
}

export async function saveDriverTimeline(value: unknown) {
  if (!value || typeof value !== 'object') throw new IncomeInputError('换车记录无效');
  const { driverKey, version, uses } = value as Record<string, unknown>;
  if (typeof driverKey !== 'string' || !Number.isSafeInteger(version) || Number(version) < 0) throw new IncomeInputError('换车记录版本无效');
  return withSystemClient(async client => {
    await client.query('begin');
    try {
      await client.query('select pg_advisory_xact_lock(19431, 19)');
      const vehicles = await getVehicles(client);
      const { drivers } = driverDirectory(vehicles, await getNames(client));
      if (!drivers.some(driver => driver.key === driverKey)) throw new IncomeInputError('未找到该司机');
      let valid;
      try { valid = validateDriverUses(uses, vehicles); }
      catch (error) { throw new IncomeInputError((error as Error).message); }
      const timelines = await getTimelines(client, vehicles);
      if ((timelines.find(item => item.driverKey === driverKey)?.version ?? 0) !== version) throw new IncomeInputError('换车记录已修改，请关闭后重新加载');
      const conflict = timelines.find(item => item.driverKey !== driverKey && hasSharedUse(valid, item.uses));
      if (conflict) throw new IncomeInputError(`同一辆车的用车日期与 ${drivers.find(driver => driver.key === conflict.driverKey)?.name ?? conflict.driverKey} 重叠`);
      // This table is deliberately independent of the vehicle and accounting ledgers.
      await client.query(`create table if not exists oak_driver_vehicle_timelines (
        driver_key text primary key, version integer not null, uses jsonb not null
      )`);
      await client.query(`insert into oak_driver_vehicle_timelines(driver_key,version,uses) values($1,$2,$3::jsonb)
        on conflict(driver_key) do update set version=excluded.version,uses=excluded.uses`, [driverKey, Number(version) + 1, JSON.stringify(valid)]);
      await client.query('commit');
      return { driverKey, version: Number(version) + 1, uses: valid };
    } catch (error) { await client.query('rollback'); throw error; }
  });
}

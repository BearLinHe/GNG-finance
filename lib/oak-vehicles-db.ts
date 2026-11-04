import type { PoolClient } from "pg";
import { oakVehicleSeeds, type OakVehicle } from "./oak-vehicles";

export async function readOakVehicles(client: PoolClient): Promise<OakVehicle[]> {
  const current=(await client.query(`select id,vehicle_number as "vehicleNumber",driver_name as "driverName",aliases,version from oak_vehicles order by id`)).rows as OakVehicle[];
  const missing=oakVehicleSeeds.filter(seed=>!current.some(vehicle=>vehicle.id===seed.id));
  if(!missing.length)return current;
  await client.query(`insert into oak_vehicles(id,vehicle_number,driver_name,aliases)
    select id,"vehicleNumber","driverName",aliases from jsonb_to_recordset($1::jsonb)
    as v(id text,"vehicleNumber" text,"driverName" text,aliases jsonb) on conflict(id) do nothing`, [JSON.stringify(missing)]);
  return (await client.query(`select id,vehicle_number as "vehicleNumber",driver_name as "driverName",aliases,version from oak_vehicles order by id`)).rows;
}

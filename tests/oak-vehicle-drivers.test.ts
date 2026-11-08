import {test} from 'node:test';
import assert from 'node:assert/strict';
import {vehicleDriverLabel,vehicleDriverPeriods,type VehicleDriverChange} from '../lib/oak-vehicle-drivers';
import {oakVehicleSeeds,vehicleForSubject} from '../lib/oak-vehicles';

const truck=oakVehicleSeeds.find(vehicle=>vehicle.vehicleNumber==='3033')!;
const change=(driverName:string,effectiveDate:string|null,id='1'):VehicleDriverChange=>({id,vehicleId:truck.id,driverName,effectiveDate,version:1});
const before={dateFrom:'2026-09-01',dateTo:'2026-09-15'};
const after={dateFrom:'2026-09-16',dateTo:'2026-09-30'};
const full={dateFrom:before.dateFrom,dateTo:after.dateTo};

test('vehicle driver displays use the effective date and keep both names for a crossing period',()=>{
  const changes=[change('David Gao',after.dateFrom)];
  assert.deepEqual(vehicleDriverPeriods(truck.driverName,changes,before),[{...before,driverName:'周亚峰'}]);
  assert.deepEqual(vehicleDriverPeriods(truck.driverName,changes,after),[{...after,driverName:'David Gao'}]);
  const periods=vehicleDriverPeriods(truck.driverName,changes,full);
  assert.deepEqual(periods,[{...before,driverName:'周亚峰'},{...after,driverName:'David Gao'}]);
  assert.equal(vehicleDriverLabel(truck.driverName,periods),'周亚峰、David Gao');
});

test('the recorded initial display name survives later edits to the source identity',()=>{
  const baseline=change('周亚峰',null);
  assert.deepEqual(vehicleDriverPeriods('源表名称',[baseline,change('David Gao',after.dateFrom,'2')],before),[{...before,driverName:'周亚峰'}]);
  assert.deepEqual(vehicleDriverPeriods('源表名称',[baseline],full),[{...full,driverName:'周亚峰'}]);
});

test('driver history sorts changes, preserves the leap day, and merges adjacent identical labels',()=>{
  const changes=[change('David Gao','2028-03-02','2'),change('David Gao','2028-03-01')];
  assert.deepEqual(vehicleDriverPeriods(truck.driverName,changes,{dateFrom:'2028-02-29',dateTo:'2028-03-03'}),[
    {dateFrom:'2028-02-29',dateTo:'2028-02-29',driverName:'周亚峰'},
    {dateFrom:'2028-03-01',dateTo:'2028-03-03',driverName:'David Gao'},
  ]);
  assert.equal(changes[0].effectiveDate,'2028-03-02');
});

test('an edited label does not overwrite driver sheet matching, and other vehicles stay unchanged',()=>{
  assert.equal(vehicleDriverLabel(truck.driverName,vehicleDriverPeriods(truck.driverName,[change('David Gao',after.dateFrom)],after)),'David Gao');
  assert.equal(vehicleForSubject(oakVehicleSeeds,'周亚峰')?.vehicleNumber,'3033');
  assert.equal(vehicleForSubject(oakVehicleSeeds,'David Gao')?.vehicleNumber,'77');
  const unchanged=oakVehicleSeeds.find(vehicle=>vehicle.vehicleNumber==='877')!;
  assert.equal(vehicleDriverLabel(unchanged.driverName,vehicleDriverPeriods(unchanged.driverName,[],full)),'张晓澄');
});

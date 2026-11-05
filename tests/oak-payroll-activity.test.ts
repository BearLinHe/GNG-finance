import {test} from 'node:test';
import assert from 'node:assert/strict';
import {incomeActivityGaps} from '../lib/oak-income-coverage';
import {buildFuelMileageContexts} from '../lib/oak-fuel';
import type {VehicleAmount} from '../lib/oak-vehicle-amounts';
import {oakVehicleSeeds} from '../lib/oak-vehicles';

const vehicle=oakVehicleSeeds[13],range={dateFrom:'2026-09-12',dateTo:'2026-09-18'};
const target={...range,vehicleId:vehicle.id,fileHash:'work-version',sheetName:vehicle.driverName,taskIds:['1','2']};
const wage={id:'70',category:'labor',...range,vehicleId:vehicle.id,payroll:{fileHash:'wage-version',sheetName:vehicle.driverName,fileName:'9_12-9_18.xlsx',activityLink:target}} as VehicleAmount;
const incomeSource=(source=target)=>({fileHash:source.fileHash,sheetNames:[source.sheetName],target:source});
test('a verified work version resolves the wage gap in income and mileage without changing original evidence',()=>{
 assert.deepEqual(incomeActivityGaps([wage],[incomeSource({...target,taskIds:['2','1']})],range),[]);
 const fuel=buildFuelMileageContexts([vehicle],[],[{...target,fileName:wage.payroll!.fileName,driverName:vehicle.driverName}],[wage]);
 assert.deepEqual(fuel[vehicle.id].gaps,[]);assert.equal(wage.payroll!.fileHash,'wage-version');
});
test('unverified versions, changed tasks, and different periods or vehicle assignments stay pending',()=>{
 for(const changed of [{taskIds:['1']},{taskIds:['1','3']},{taskIds:['1','2','3']},{dateTo:'2026-09-19'},{vehicleId:'other'},{sheetName:'不同工作表'}]){
  assert.equal(incomeActivityGaps([wage],[incomeSource({...target,...changed})],range).length,1);
 }
 assert.equal(incomeActivityGaps([{...wage,payroll:{...wage.payroll!,activityLink:undefined}}],[incomeSource()],range).length,1);
 assert.equal(incomeActivityGaps([{...wage,dateTo:'2026-09-19'}],[incomeSource()],range).length,1);
 const fuel=buildFuelMileageContexts([vehicle],[],[{...target,taskIds:['1'],fileName:wage.payroll!.fileName,driverName:vehicle.driverName}],[wage]);
 assert.equal(fuel[vehicle.id].gaps.length,1);
});

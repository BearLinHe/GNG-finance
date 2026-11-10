import {test} from 'node:test';
import assert from 'node:assert/strict';
import {incomeActivityGaps} from '../lib/oak-income-coverage';
import {buildFuelMileageContexts} from '../lib/oak-fuel';
import {payrollActivityCandidate,selectPayrollActivityBatch} from '../lib/oak-payroll-activity-db';
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

const unlinkedWage={...wage,version:1,payeeType:'driver' as const,payroll:{...wage.payroll!,activityLink:undefined}};
const firstLeg={id:'1',batchId:'5',fileHash:target.fileHash,driverName:vehicle.driverName,payeeType:null,
 workDate:range.dateFrom,reference:'trailer 916',nature:'HLI2',fromLocation:'SFO',toLocation:'95023',miles:77,sourceRow:3};
const returnLeg={...firstLeg,id:'2',workDate:range.dateTo,fromLocation:'95023',toLocation:'SFO',sourceRow:4};

test('an eligible existing batch is offered for explicit review, not treated as linked',()=>{
 const candidate=payrollActivityCandidate(unlinkedWage,[firstLeg,returnLeg],[vehicle]);
 assert.deepEqual(candidate?.target,target);
 assert.equal(candidate?.legs.length,2);
 assert.equal(candidate?.legs[0].reference,'trailer 916');
 assert.equal(incomeActivityGaps([unlinkedWage],[incomeSource()],range).length,1);
});

test('missing, ambiguous, out-of-period, differently assigned, and already linked work is not offered',()=>{
 for(const legs of [[],[firstLeg,{...returnLeg,batchId:'6'}],[{...firstLeg,workDate:'2026-09-11'}],
  [{...firstLeg,driverName:'Unrelated'}],[{...firstLeg,payeeType:'owner' as const}],[{...firstLeg,fileHash:unlinkedWage.payroll.fileHash}]]){
  assert.equal(payrollActivityCandidate(unlinkedWage,legs,[vehicle]),null);
 }
 assert.equal(payrollActivityCandidate(wage,[firstLeg,returnLeg],[vehicle]),null);
});

test('confirmation token changes if the wage or reviewed job evidence changes',()=>{
 const token=payrollActivityCandidate(unlinkedWage,[firstLeg,returnLeg],[vehicle])?.token;
 assert.match(token!,/^[a-f0-9]{64}$/);
 assert.notEqual(payrollActivityCandidate({...unlinkedWage,version:2},[firstLeg,returnLeg],[vehicle])?.token,token);
 assert.notEqual(payrollActivityCandidate(unlinkedWage,[firstLeg,{...returnLeg,miles:78}],[vehicle])?.token,token);
 assert.notEqual(payrollActivityCandidate(unlinkedWage,[firstLeg],[vehicle])?.token,token);
});

test('batch confirmation requires explicit fresh selections for eligible, numbered vehicles only',()=>{
 const candidate=payrollActivityCandidate(unlinkedWage,[firstLeg,returnLeg],[vehicle])!;
 const entry={wage:unlinkedWage,vehicle,candidate,sameFile:false};
 const selection={wageId:unlinkedWage.id,token:candidate.token};
 assert.deepEqual(selectPayrollActivityBatch([entry],[selection]),[{wage:unlinkedWage,target}]);
 for(const input of [[],[selection,selection],[{...selection,wageId:'99'}],[{...selection,token:'stale'}]]){
  assert.throws(()=>selectPayrollActivityBatch([entry],input));
 }
 assert.throws(()=>selectPayrollActivityBatch([{...entry,vehicle:{...vehicle,vehicleNumber:null}}],[selection]),/车号未确认/);
 assert.throws(()=>selectPayrollActivityBatch([entry,{...entry,wage:{...unlinkedWage,id:'71'}}],[selection]),/重新核对/);
});

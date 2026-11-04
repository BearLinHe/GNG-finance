import {test} from 'node:test';import assert from 'node:assert/strict';
import {allocateFuelAmount,buildFuelMileageContexts,type FuelMileageContext} from '../lib/oak-fuel';
import {calculateDatedVehicleAccounting,type VehicleAmount} from '../lib/oak-vehicle-amounts';
import {oakVehicleSeeds} from '../lib/oak-vehicles';
const month={dateFrom:'2026-08-01',dateTo:'2026-08-31'},week={dateFrom:'2026-08-01',dateTo:'2026-08-07'};
const source={...month,amount:5117.87},vehicle=oakVehicleSeeds[4];
const mileage:FuelMileageContext={coverage:[month],gaps:[],days:[{workDate:'2026-08-03',miles:154},{workDate:'2026-08-05',miles:99},{workDate:'2026-08-06',miles:99},{workDate:'2026-08-07',miles:506},{workDate:'2026-08-14',miles:532},{workDate:'2026-08-21',miles:3632},{workDate:'2026-08-28',miles:859},{workDate:'2026-08-31',miles:948}]};
test('877 first-week fuel uses monthly cost per mile, not 7/31 calendar days',()=>{
 const result=allocateFuelAmount(source,week,mileage);assert.equal(result.periodMiles,6829);assert.equal(result.rangeMiles,858);assert.equal(result.allocatedAmount,643.01);assert.equal(result.unitPrice,5117.87/6829);
});
test('full fuel periods retain their exact budget even before mileage is loaded',()=>{
 assert.equal(allocateFuelAmount(source,month).allocatedAmount,5117.87);
 assert.equal(allocateFuelAmount(source,{dateFrom:'2026-07-01',dateTo:'2026-09-30'}).allocatedAmount,5117.87);
 assert.equal(allocateFuelAmount(source,{dateFrom:'2026-09-01',dateTo:'2026-09-30'}).allocatedAmount,0);
});
test('missing coverage or missing task mileage never silently falls back to time proration',()=>{
 assert.equal(allocateFuelAmount(source,week).allocatedAmount,null);
 assert.match(allocateFuelAmount(source,week,{...mileage,coverage:[week]}).pendingReason!,/未覆盖完整/);
 const missing=allocateFuelAmount(source,week,{...mileage,gaps:[{dateFrom:'2026-08-15',dateTo:'2026-08-21',reason:'尚未同步作业：8_15-8_21.xlsx'}]});
 assert.equal(missing.allocatedAmount,null);assert.match(missing.pendingReason!,/8_15-8_21/);
 for(const miles of [null,-1,NaN])assert.equal(allocateFuelAmount(source,week,{...mileage,days:[...mileage.days,{workDate:'2026-08-20',miles}]}).allocatedAmount,null);
});
test('a known no-driving day allocates zero while a zero monthly denominator remains pending',()=>{
 assert.equal(allocateFuelAmount(source,{dateFrom:'2026-08-01',dateTo:'2026-08-02'},mileage).allocatedAmount,0);
 assert.equal(allocateFuelAmount(source,week,{...mileage,days:[]}).allocatedAmount,null);
 assert.equal(allocateFuelAmount({...source,amount:0},week).allocatedAmount,0);
});
test('daily, weekly and cross-month fuel slices reconcile to the exact original cents',()=>{
 const days=Array.from({length:31},(_,i)=>`2026-08-${String(i+1).padStart(2,'0')}`);
 assert.equal(days.reduce((sum,date)=>sum+Math.round(allocateFuelAmount(source,{dateFrom:date,dateTo:date},mileage).allocatedAmount!*100),0),511787);
 const a=allocateFuelAmount(source,week,mileage).allocatedAmount!,b=allocateFuelAmount(source,{dateFrom:'2026-08-08',dateTo:'2026-09-07'},mileage).allocatedAmount!;
 assert.equal(Math.round(a*100)+Math.round(b*100),511787);
 assert.equal(allocateFuelAmount({...source,amount:9999999999.99},week,mileage).allocatedAmount,1256406501.68);
});
test('mileage sources require original exact sheet keys and unambiguous vehicle links',()=>{
 const base={driverName:'张晓澄',sheetName:' 张晓澄',fileHash:'hash',fileName:'8_1-8_7.xlsx',...month};
 const wage={vehicleId:vehicle.id,...month,payroll:{fileHash:'hash',sheetName:' 张晓澄',fileName:base.fileName}} as VehicleAmount;
 const contexts=buildFuelMileageContexts([vehicle],[{driverName:'张晓澄',workDate:week.dateFrom,miles:100}],[base],[wage]);
 assert.equal(contexts[vehicle.id].gaps.length,0);assert.equal(contexts[vehicle.id].days.length,1);
 const mismatch=buildFuelMileageContexts([vehicle],[],[{...base,sheetName:'张晓澄'}],[wage]);assert.equal(mismatch[vehicle.id].gaps.length,1);
 const ambiguous=buildFuelMileageContexts([vehicle,{...vehicle,id:'duplicate'}],[],[base],[]);assert.deepEqual(ambiguous,{});
});
test('payroll gaps cannot be hidden by unrelated manual income and coverage keys are deterministic',()=>{
 const sources=[{driverName:'877',sheetName:'张晓澄',fileHash:'a',fileName:'a.xlsx',dateFrom:'2026-08-01',dateTo:'2026-08-14'},{driverName:'张晓澄',sheetName:'张晓澄',fileHash:'b',fileName:'b.xlsx',dateFrom:'2026-08-15',dateTo:'2026-08-31'}];
 const days=[{driverName:'877',workDate:'2026-08-03',miles:200},{driverName:'张晓澄',workDate:'2026-08-15',miles:300}];
 const a=buildFuelMileageContexts([vehicle],days,sources,[]),b=buildFuelMileageContexts([vehicle],[...days].reverse(),[...sources].reverse(),[]);assert.deepEqual(a,b);
 assert.equal(allocateFuelAmount(source,week,a[vehicle.id]).allocatedAmount,2047.15);
});
test('main accounting and line allocations use the same mileage result and preserve missing-data status',()=>{
 const record:VehicleAmount={id:'fuel',vehicleId:vehicle.id,category:'fuel',...source,payeeType:null,note:'',version:1,requestKey:'fuel-source',sourceReviewId:null,updatedAt:week.dateFrom};
 const row=calculateDatedVehicleAccounting(vehicle,week,[],[],null,'hash',[record],undefined,undefined,mileage);
 assert.equal(row.lines.fuel.amount,643.01);assert.equal(row.amounts![0].allocatedAmount,643.01);
 const pending=calculateDatedVehicleAccounting(vehicle,week,[],[],null,'hash',[record]);assert.equal(pending.lines.fuel.amount,null);assert.equal(pending.amounts![0].allocatedAmount,null);assert.equal(pending.totalCost,null);assert.equal(pending.net,null);
});

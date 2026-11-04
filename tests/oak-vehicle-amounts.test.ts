import {test} from "node:test";
import assert from "node:assert/strict";
import {allocateVehicleAmount,calculateDatedVehicleAccounting,validateVehicleAmount,type VehicleAmount} from "../lib/oak-vehicle-amounts";
import {oakVehicleSeeds} from "../lib/oak-vehicles";
import type {DriverTask} from "../lib/oak-driver-types";
import type {ProfitSettlement} from "../lib/oak-period-profit";
const vehicle=oakVehicleSeeds[4];const range={dateFrom:"2026-10-03",dateTo:"2026-10-09"};
const record=(category:VehicleAmount['category'],amount:number,dates={dateFrom:"2026-10-01",dateTo:"2026-10-31"}):VehicleAmount=>({id:category,vehicleId:vehicle.id,category,amount,...dates,note:"test",payeeType:category==='labor'?'driver':null,version:1,requestKey:`request-${category}`,sourceReviewId:null,updatedAt:"2026-11-02"});
const task=(id="1",date="2026-10-03"):DriverTask=>({id,driverName:vehicle.driverName,sheetName:vehicle.driverName,section:"海柜",payeeType:"driver",sourceRow:3,workDate:date,reference:"QA",nature:"TCY1",fromLocation:"SFO",toLocation:"STK",miles:68,notes:null,rawCells:{},income:{status:"priced",source:"manual",workLabel:"TCY1",amount:1000,basis:"manual",billingBasis:"trip",ruleId:null,includedTaskId:null,review:null}});
test("non-fuel expense and revenue categories allocate the inclusive overlapping days",()=>{
 const result=allocateVehicleAmount(record('insurance',3100),range);assert.deepEqual(result,{allocatedAmount:700,overlapDays:7,totalDays:31});
 assert.equal(allocateVehicleAmount(record('insurance',3100),{dateFrom:"2026-09-01",dateTo:"2026-09-30"}).allocatedAmount,0);
 assert.equal(allocateVehicleAmount(record('insurance',3100),{dateFrom:"2026-10-31",dateTo:"2026-11-01"}).allocatedAmount,100);
});
test("cent allocation reconciles across adjacent periods instead of multiplying rounding errors",()=>{
 const source={amount:100,dateFrom:"2026-10-01",dateTo:"2026-10-03"};
 const values=[1,2,3].map(day=>allocateVehicleAmount(source,{dateFrom:`2026-10-0${day}`,dateTo:`2026-10-0${day}`}).allocatedAmount);
 assert.deepEqual(values,[33.33,33.33,33.34]);assert.equal(values.reduce((s,v)=>s+Math.round(v*100),0),10000);
});
test("leap days and cross-year ranges allocate by UTC calendar days",()=>{
 assert.equal(allocateVehicleAmount({amount:290,dateFrom:"2028-02-01",dateTo:"2028-02-29"},{dateFrom:"2028-02-29",dateTo:"2028-02-29"}).allocatedAmount,10);
 assert.equal(allocateVehicleAmount({amount:300,dateFrom:"2026-12-31",dateTo:"2027-01-02"},{dateFrom:"2027-01-01",dateTo:"2027-01-02"}).allocatedAmount,200);
});
test("main table sums independently dated amounts for each category",()=>{
 const records=[record('income',6200),record('labor',3100),record('fuel',620),record('maintenance',310),record('insurance',310),record('other',310)];
 const mileage={coverage:[{dateFrom:'2026-10-01',dateTo:'2026-10-31'}],gaps:[],days:Array.from({length:31},(_,i)=>({workDate:`2026-10-${String(i+1).padStart(2,'0')}`,miles:100}))};
 const result=calculateDatedVehicleAccounting(vehicle,range,[],[],null,'hash',records,undefined,undefined,mileage);
 assert.equal(result.lines.income.amount,1400);assert.equal(result.lines.labor.amount,700);assert.equal(result.lines.fuel.amount,140);
 assert.equal(result.totalCost,1050);assert.equal(result.net,350);assert.equal(result.amounts?.length,6);
});
test("out-of-range and other-vehicle amounts never leak into the main period",()=>{
 const records=[record('fuel',900,{dateFrom:"2026-09-01",dateTo:"2026-09-30"}),{...record('fuel',3100),vehicleId:'other'}];
 const result=calculateDatedVehicleAccounting(vehicle,range,[],[],null,'hash',records);assert.equal(result.lines.fuel.amount,null);assert.equal(result.net,null);
});
test("explicit zero differs from absent expense records",()=>{
 const result=calculateDatedVehicleAccounting(vehicle,range,[],[],null,'hash',[record('fuel',0)]);assert.equal(result.lines.fuel.amount,0);assert.equal(result.lines.maintenance.amount,null);
});
test("manual dated income replaces automatic income only on covered work dates",()=>{
 const records=[record('income',500,{dateFrom:"2026-10-03",dateTo:"2026-10-03"})];
 const result=calculateDatedVehicleAccounting(vehicle,range,[task(),task('2','2026-10-04')],[],null,'hash',records);
 assert.equal(result.lines.income.amount,1500);
});
test("a monthly manual revenue record is not added again to source work income",()=>{
 const result=calculateDatedVehicleAccounting(vehicle,range,[task()],[],null,'hash',[record('income',3100)]);assert.equal(result.lines.income.amount,700);
});
test("confirmed weekly gross wages are prorated and deductions do not reduce earned labor cost",()=>{
 const settlement:ProfitSettlement={id:'1',subject:vehicle.driverName,weekStart:range.dateFrom,weekEnd:range.dateTo,payeeType:'driver',baseAmount:300,
  adjustments:[{kind:'allowance',title:'bonus',amount:20},{kind:'deduction',title:'advance',amount:100}],status:'confirmed',taskIds:['1']};
 const result=calculateDatedVehicleAccounting(vehicle,{dateFrom:range.dateFrom,dateTo:'2026-10-04'},[task()],[settlement],null,'hash',[]);
 assert.equal(result.lines.labor.amount,91.42);
});
test("manual wage dates replace rather than duplicate the matching weekly wage days",()=>{
 const settlement:ProfitSettlement={id:'1',subject:vehicle.driverName,weekStart:range.dateFrom,weekEnd:range.dateTo,payeeType:'driver',baseAmount:700,adjustments:[],status:'confirmed',taskIds:['1']};
 const result=calculateDatedVehicleAccounting(vehicle,range,[task()],[settlement],null,'hash',[record('labor',300,{dateFrom:range.dateFrom,dateTo:'2026-10-04'})]);
 assert.equal(result.lines.labor.amount,800);
});
test("partial manual coverage never invents unknown automatic income or wage data",()=>{
 const pending={...task('2','2026-10-05'),income:undefined};
 const result=calculateDatedVehicleAccounting(vehicle,range,[task(),pending],[],null,'hash',[record('income',500,{dateFrom:range.dateFrom,dateTo:'2026-10-04'}),record('labor',100,{dateFrom:range.dateFrom,dateTo:'2026-10-04'})]);
 assert.equal(result.lines.income.amount,null);assert.equal(result.lines.labor.amount,null);
});
test('uploaded wages remain visible as an entered subtotal when a wider period has unmatched workdays',()=>{
 const wages=record('labor',1145,{dateFrom:'2026-08-22',dateTo:'2026-08-28'}),broad={dateFrom:'2026-08-01',dateTo:'2026-10-09'};
 const tasks=[task('1','2026-08-25'),task('2','2026-09-01'),task('3','2026-09-01'),task('4','2026-10-09')];
 const result=calculateDatedVehicleAccounting(vehicle,broad,tasks,[],null,'hash',[wages,record('fuel',100,broad),record('insurance',100,broad),record('maintenance',100,broad)]);
 assert.equal(result.lines.labor.amount,null);assert.equal(result.lines.labor.knownAmount,1145);assert.deepEqual(result.lines.labor.missingWorkDates,['2026-09-01','2026-10-09']);assert.match(result.lines.labor.pendingReason!,/2 个作业日/);
 assert.equal(result.totalCost,null);assert.equal(result.net,null);assert.ok(result.issues.includes('工资待核对'));
});
test('a confirmed zero wage subtotal is visible, while an absent wage source stays unknown',()=>{
 const result=calculateDatedVehicleAccounting(vehicle,range,[task(),task('2','2026-10-06')],[],null,'hash',[record('labor',0,{dateFrom:range.dateFrom,dateTo:range.dateFrom})]);
 assert.equal(result.lines.labor.knownAmount,0);assert.equal(result.lines.labor.amount,null);
 const missing=calculateDatedVehicleAccounting(vehicle,range,[task()],[],null,'hash',[]);assert.equal(missing.lines.labor.knownAmount,undefined);assert.equal(missing.lines.labor.amount,null);
});
test('partial weekly settlement wages show their entered subtotal without becoming complete period costs',()=>{
 const settlement:ProfitSettlement={id:'1',subject:vehicle.driverName,weekStart:'2026-10-03',weekEnd:'2026-10-09',payeeType:'driver',baseAmount:700,adjustments:[],status:'confirmed',taskIds:['1']};
 const result=calculateDatedVehicleAccounting(vehicle,{dateFrom:'2026-10-03',dateTo:'2026-10-16'},[task(),task('2','2026-10-12')],[settlement],null,'hash',[]);
 assert.equal(result.lines.labor.knownAmount,700);assert.equal(result.lines.labor.amount,null);assert.equal(result.net,null);
});
test('adding the remaining wage periods turns the subtotal into a verified amount without duplicates',()=>{
 const tasks=[task(),task('2','2026-10-06')],wages=[record('labor',300,{dateFrom:range.dateFrom,dateTo:'2026-10-04'}),record('labor',500,{dateFrom:'2026-10-05',dateTo:range.dateTo})];
 const result=calculateDatedVehicleAccounting(vehicle,range,tasks,[],null,'hash',wages);
 assert.equal(result.lines.labor.amount,800);assert.equal(result.lines.labor.knownAmount,800);assert.equal(result.lines.labor.pendingReason,undefined);assert.equal(result.lines.labor.missingWorkDates,undefined);
 const outside=calculateDatedVehicleAccounting(vehicle,{dateFrom:'2026-11-01',dateTo:'2026-11-30'},[],[],null,'hash',wages);assert.equal(outside.lines.labor.knownAmount,undefined);
});
test("record validation requires its own dates, bounded amount, and optimistic version",()=>{
 const input={...record('fuel',0),id:null,version:0};assert.equal(validateVehicleAmount(input).amount,0);
 assert.throws(()=>validateVehicleAmount({...input,dateFrom:'2026-02-30'}));
 assert.throws(()=>validateVehicleAmount({...input,dateTo:'2026-09-01'}));
 assert.throws(()=>validateVehicleAmount({...input,amount:-1}));assert.throws(()=>validateVehicleAmount({...input,amount:1.001}));
 assert.throws(()=>validateVehicleAmount({...input,amount:''}));assert.throws(()=>validateVehicleAmount({...input,id:'1',version:0}));
});
test('owner wages stay independent and insurance and repairs do not block or reduce owner profit',()=>{
 const wages={...record('labor',300,range),payeeType:'owner' as const};
 const result=calculateDatedVehicleAccounting(vehicle,range,[],[],null,'hash',[wages,record('income',1000,range),record('fuel',50,range)]);
 assert.equal(result.lines.labor.amount,300);assert.equal(result.payeeType,'owner');assert.equal(result.lines.insurance.amount,0);assert.equal(result.lines.maintenance.amount,0);
 assert.equal(result.lines.insurance.notApplicable,true);assert.equal(result.lines.maintenance.notApplicable,true);assert.equal(result.totalCost,350);assert.equal(result.net,650);
});
test('owner exemption leaves original repair and insurance records intact but out of calculated costs',()=>{
 const records=[{...record('labor',300,range),payeeType:'owner' as const},record('income',1000,range),record('fuel',50,range),record('maintenance',500,range),record('insurance',200,range)];
 const result=calculateDatedVehicleAccounting(vehicle,range,[],[],null,'hash',records,{configured:true,available:false,message:'offline',matchedVehicleIds:[],warnings:[]});
 assert.equal(result.net,650);assert.equal(result.amounts?.find(item=>item.category==='maintenance')?.amount,500);assert.equal(result.amounts?.find(item=>item.category==='insurance')?.amount,200);
});
test('known owner work waives ownership costs even while wages are pending, never inventing wages',()=>{
 const result=calculateDatedVehicleAccounting(vehicle,range,[{...task(),payeeType:'owner',driverName:'O Don'}],[],null,'hash',[]);
 assert.equal(result.lines.maintenance.notApplicable,true);assert.equal(result.lines.insurance.notApplicable,true);assert.equal(result.lines.labor.amount,null);assert.equal(result.net,null);
});
test('driver vehicles still require repair and insurance amounts',()=>{
 const result=calculateDatedVehicleAccounting(vehicle,range,[],[],null,'hash',[record('labor',300,range),record('income',1000,range),record('fuel',50,range)]);
 assert.equal(result.lines.maintenance.amount,null);assert.equal(result.lines.insurance.amount,null);assert.equal(result.lines.insurance.notApplicable,undefined);assert.equal(result.net,null);
});
test('zero owner wages retain the ownership exemption and do not become driver wages',()=>{
 const settlement:ProfitSettlement={id:'zero',subject:vehicle.driverName,weekStart:range.dateFrom,weekEnd:range.dateTo,payeeType:'owner',baseAmount:0,adjustments:[],status:'confirmed',taskIds:[]};
 const result=calculateDatedVehicleAccounting(vehicle,range,[],[settlement],null,'hash',[]);
 assert.equal(result.payeeType,'owner');assert.equal(result.lines.labor.amount,0);assert.equal(result.lines.maintenance.notApplicable,true);
});
test('mixed driver and owner periods never exempt the entire period',()=>{
 const owner={...record('labor',300,{dateFrom:range.dateFrom,dateTo:'2026-10-04'}),payeeType:'owner' as const};
 const driver=record('labor',200,{dateFrom:'2026-10-05',dateTo:range.dateTo});
 const result=calculateDatedVehicleAccounting(vehicle,range,[],[],null,'hash',[owner,driver]);
 assert.equal(result.lines.maintenance.notApplicable,undefined);assert.equal(result.lines.insurance.notApplicable,undefined);assert.equal(result.lines.labor.amount,null);assert.equal(result.net,null);
});

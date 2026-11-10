import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildVehicleIncomeRows,summarizeVehicleIncome,incomeMapDays} from '../lib/oak-vehicle-income';
import {incomeActivityGaps} from '../lib/oak-income-coverage';
import {calculateDatedVehicleAccounting,type VehicleAmount} from '../lib/oak-vehicle-amounts';
import {oakVehicleSeeds} from '../lib/oak-vehicles';
import {priceDriverDays} from '../lib/oak-income';
import {summarizeDriverTasks,type DriverTask} from '../lib/oak-driver-types';
const vehicle={...oakVehicleSeeds[4],aliases:['Test alias']},range={dateFrom:'2026-10-03',dateTo:'2026-10-09'};
const task=(id='1',date=range.dateFrom):DriverTask=>({id,importId:1,driverName:vehicle.driverName,sheetName:vehicle.driverName,section:'海柜',sourceRow:Number(id)+2,workDate:date,reference:`REF-${id}`,nature:'TCY1直送',fromLocation:'SFO',toLocation:'95206',miles:68,notes:null,rawCells:{G3:9999}});
const record=(category:VehicleAmount['category'],amount:number,dates=range):VehicleAmount=>({id:category,category,vehicleId:vehicle.id,amount,...dates,note:'confirmed',payeeType:category==='labor'?'driver':null,version:1,updatedAt:'2026-11-03',requestKey:`key-${category}`,sourceReviewId:null});
const rule={id:1,name:'TCY1 company revenue',workLabel:'TCY1',amount:440,fromLocation:null,toLocation:null,billingBasis:'trip' as const,validFrom:null,validTo:null,active:true};
const rated=(tasks:DriverTask[])=>priceDriverDays(summarizeDriverTasks(tasks),[rule],[]).flatMap(day=>day.tasks);
test('income is company work pricing, never the wage column or miles',()=>{
 const rows=buildVehicleIncomeRows([vehicle],rated([task()]),[],range);assert.equal(rows[0].amount,440);assert.equal(rows[0].status,'auto');assert.equal(rows[0].task?.rawCells.G3,9999);
 assert.equal(summarizeVehicleIncome(rows).amount,440);
});
test('unclassified return legs remain pending until explicitly included in a verified trip',()=>{
 const back={...task('2'),nature:null,reference:'EMPTY-RETURN',fromLocation:'95206',toLocation:'SFO'};
 const tasks=priceDriverDays(summarizeDriverTasks([task(),back]),[rule],[]).flatMap(day=>day.tasks);
 const pending=buildVehicleIncomeRows([vehicle],tasks,[],range);assert.equal(pending.find(row=>row.task?.id==='2')?.amount,null);assert.equal(summarizeVehicleIncome(pending).amount,null);
 const reviewed=priceDriverDays(summarizeDriverTasks([task(),back]),[rule],[{taskId:'2',mode:'included',workLabel:null,amount:null,includedTaskId:'1',note:'Same trip return'}]).flatMap(day=>day.tasks);
 const rows=buildVehicleIncomeRows([vehicle],reviewed,[],range);assert.equal(summarizeVehicleIncome(rows).amount,440);assert.equal(summarizeVehicleIncome(rows).includedCount,1);
});
test('manual segment review is displayed distinctly and missing prices never become zero',()=>{
 const days=priceDriverDays(summarizeDriverTasks([task(),{...task('2'),nature:'OTHER'}]),[],[{taskId:'1',mode:'manual',workLabel:'Delivery',amount:500,includedTaskId:null,note:'Confirmed invoice'}]);
 const rows=buildVehicleIncomeRows([vehicle],days.flatMap(day=>day.tasks),[],range);assert.equal(rows.find(row=>row.task?.id==='1')?.status,'reviewed');assert.equal(summarizeVehicleIncome(rows).knownAmount,500);assert.equal(summarizeVehicleIncome(rows).pendingCount,1);
});
test('income ledger and main table reconcile when dated manual amounts replace covered work',()=>{
 const tasks=rated([task(),task('2','2026-10-04')]);
 const records=[record('income',3100,{dateFrom:'2026-10-01',dateTo:'2026-10-31'})];
 const rows=buildVehicleIncomeRows([vehicle],tasks,records,range);assert.equal(summarizeVehicleIncome(rows).amount,700);assert.equal(summarizeVehicleIncome(rows).replacedCount,2);
 assert.equal(calculateDatedVehicleAccounting(vehicle,range,tasks,[],null,'hash',records).lines.income.amount,700);
 const partial=[record('income',100,{dateFrom:range.dateFrom,dateTo:range.dateFrom})];
 assert.equal(summarizeVehicleIncome(buildVehicleIncomeRows([vehicle],tasks,partial,range)).amount,540);
 assert.equal(calculateDatedVehicleAccounting(vehicle,range,tasks,[],null,'hash',partial).lines.income.amount,540);
});
test('unlinked source work cannot be attributed or included in a vehicle total',()=>{
 const rows=buildVehicleIncomeRows([vehicle],rated([{...task(),driverName:'Unknown person'}]),[],range);assert.equal(rows[0].status,'unlinked');assert.equal(rows[0].amount,null);assert.equal(rows[0].vehicleId,null);
});
test('mapped aliases merge map days without losing source names or route IDs',()=>{
 const tasks=[task(),{...task('2'),driverName:'Test alias'}],days=incomeMapDays(tasks,vehicle);
 assert.equal(days.length,1);assert.equal(days[0].taskCount,2);assert.equal(days[0].tasks[1].driverName,'Test alias');assert.equal(days[0].miles,136);
});
test('income dates default to oldest first, and reversing dates preserves same-day task order and totals',()=>{
 const tasks=rated([task('3','2026-10-09'),task('2'),task('1')]);
 const ascending=buildVehicleIncomeRows([vehicle],tasks,[],range);
 const descending=buildVehicleIncomeRows([vehicle],tasks,[],range,undefined,'desc');
 assert.deepEqual(ascending.map(row=>row.task?.id),['1','2','3']);
 assert.deepEqual(descending.map(row=>row.task?.id),['3','1','2']);
 assert.deepEqual(summarizeVehicleIncome(ascending),summarizeVehicleIncome(descending));
});
test('wages without extracted work produce pending income in both views, not false complete revenue',()=>{
 const wages={...record('labor',700),payroll:{fileName:'week.xlsx',fileHash:'hash',sheetName:'Original',candidate:{id:'x',label:'check',amount:700,cells:[]},originalAmount:700,confirmedAmount:700,warnings:[],note:''}};
 const tasks=rated([task()]),rows=buildVehicleIncomeRows([vehicle],tasks,[wages],range,[]);
 assert.equal(summarizeVehicleIncome(rows).pendingCount,1);assert.equal(summarizeVehicleIncome(rows).knownAmount,440);assert.equal(summarizeVehicleIncome(rows).amount,null);
 const main=calculateDatedVehicleAccounting(vehicle,range,tasks,[],null,'hash',[wages],undefined,[]);assert.equal(main.lines.income.amount,null);assert.equal(main.lines.income.knownAmount,440);assert.equal(main.lines.labor.amount,700);
 const sources=[{fileHash:'hash',sheetNames:['Original']}];assert.equal(incomeActivityGaps([wages],sources,range).length,0);
 assert.equal(calculateDatedVehicleAccounting(vehicle,range,tasks,[],null,'hash',[wages],undefined,sources).lines.income.amount,440);
});
test('a wage coverage warning keeps its original payroll period separate from actual task dates',()=>{
 const wages={...record('labor',700),payroll:{fileName:'week.xlsx',fileHash:'hash',sheetName:'Original',candidate:{id:'x',label:'check',amount:700,cells:[]},originalAmount:700,confirmedAmount:700,warnings:[],note:''}};
 const filtered={dateFrom:'2026-10-04',dateTo:'2026-10-07'};
 const rows=buildVehicleIncomeRows([vehicle],rated([task('1','2026-10-05')]),[wages],filtered,[]);
 const warning=rows.find(row=>row.activityGap)!;
 assert.deepEqual(warning.payrollPeriod,range);
 assert.equal(warning.dateFrom,filtered.dateFrom);
 assert.equal(warning.task,undefined);
 assert.equal(rows.find(row=>row.task)?.dateFrom,'2026-10-05');
 assert.equal(rows.find(row=>row.task)?.payrollPeriod,undefined);
});
test('manual income coverage unions inclusive dates and a deliberate zero resolves missing work',()=>{
 const wages={...record('labor',700),payroll:{fileName:'week.xlsx',fileHash:'hash',sheetName:'Original',candidate:{id:'x',label:'check',amount:700,cells:[]},originalAmount:700,confirmedAmount:700,warnings:[],note:''}};
 const records=[wages,record('income',0,{dateFrom:'2026-10-03',dateTo:'2026-10-05'}),record('income',400,{dateFrom:'2026-10-06',dateTo:'2026-10-09'})];
 assert.equal(incomeActivityGaps(records,[],range).length,0);
 assert.equal(incomeActivityGaps(records.slice(0,2),[],range).length,1);
 assert.equal(incomeActivityGaps([wages],[],{dateFrom:'2026-11-01',dateTo:'2026-11-02'}).length,0);
 assert.equal(summarizeVehicleIncome(buildVehicleIncomeRows([vehicle],[],records,range,[])).amount,400);
});

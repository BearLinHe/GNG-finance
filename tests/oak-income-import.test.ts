import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {PoolClient} from 'pg';
import {mergeIncomeWorkbook,validateIncomeSheetMappings} from '../lib/oak-income-import-db';
import {parseDriverWorkbook} from '../lib/oak-driver-import';
import ExcelJS from 'exceljs';
import {oakVehicleSeeds} from '../lib/oak-vehicles';
import type {DriverWorkbookPreview,DriverTask} from '../lib/oak-driver-types';
import type {VehicleAmount} from '../lib/oak-vehicle-amounts';
const vehicle=oakVehicleSeeds[4];
const task:DriverTask={driverName:vehicle.driverName,sheetName:vehicle.driverName,section:'海柜',sourceRow:3,workDate:'2026-10-03',reference:'REF',nature:'TCY1',fromLocation:'SFO',toLocation:'95206',miles:68,notes:null,rawCells:{G3:9999},payeeType:'driver'};
const preview:DriverWorkbookPreview={fileName:'week.xlsx',fileHash:'hash',tasks:[task],sheets:[{sheetName:task.sheetName,driverName:task.driverName,selected:true,taskCount:1,dateFrom:task.workDate,dateTo:task.workDate,warnings:[]}],warnings:[],skippedSheets:[],batchPeriod:{from:'2026-10-03',to:'2026-10-09'}};
function fake(options:{existing?:Record<string,unknown>[];previous?:DriverTask[];versionConflict?:boolean;versionTasks?:DriverTask[];wages?:VehicleAmount[]}={}){
 const queries:Array<{sql:string;values:unknown[]}>=[],added:DriverTask[]=[];
 const client={async query(sql:string,values:unknown[]=[]){queries.push({sql,values});let rows:unknown[]=[];
  if(sql.includes('where i.file_name=$1'))rows=options.versionConflict?[{id:'9',fileHash:'old-hash',dateFrom:preview.batchPeriod.from,dateTo:preview.batchPeriod.to}]:[];
  else if(sql.includes('from oak_driver_tasks where import_id=$1 and sheet_name=any'))rows=options.versionTasks||[];
  else if(sql.includes('from oak_vehicle_amounts where voided_at is null'))rows=options.wages||[];
  else if(sql.startsWith('update oak_vehicle_amounts set payroll_source'))rows=[{id:'70'}];
  else if(sql.includes('i.file_hash<>$1'))rows=options.previous||[];
  else if(sql.startsWith('select id::int'))rows=[{id:1}];
  else if(sql.startsWith('select sheet_name,section'))rows=options.existing||[];
  else if(sql.startsWith('insert into oak_driver_tasks'))added.push(...JSON.parse(values[1] as string));
  return{rows,rowCount:rows.length};
 }} as unknown as PoolClient;
 return{client,queries,added};
}
const mappings=[{sheetName:task.sheetName,vehicleId:vehicle.id,payeeType:'driver' as const}];
test('income synchronization inserts only work data, never wage amounts',async()=>{
 const f=fake(),result=await mergeIncomeWorkbook(f.client,preview,mappings,[structuredClone(vehicle)]);
 assert.deepEqual(result,{added:1,skipped:0});assert.equal(f.added[0].rawCells.G3,9999);assert.equal('income' in f.added[0],false);
 assert.equal(f.queries.some(query=>/insert into oak_vehicle_amounts|update oak_task_income_reviews|delete from/i.test(query.sql)),false);
});
test('same workbook synchronization preserves task IDs and manual reviews and adds only missing rows',async()=>{
 const next={...task,sourceRow:4,reference:'RETURN',fromLocation:'95206',toLocation:'SFO'};
 const f=fake({existing:[{sheet_name:task.sheetName,section:task.section,source_row:3,driver_name:task.driverName,payee_type:'driver'}]});
 const result=await mergeIncomeWorkbook(f.client,{...preview,tasks:[task,next]},mappings,[structuredClone(vehicle)]);
 assert.deepEqual(result,{added:1,skipped:1});assert.equal(f.added[0].sourceRow,4);assert.equal(f.queries.some(query=>/update oak_driver_tasks|delete|income_reviews/i.test(query.sql)),false);
});
test('conflicting existing ownership never overwrites previously imported work',async()=>{
 const f=fake({existing:[{sheet_name:task.sheetName,section:task.section,source_row:3,driver_name:oakVehicleSeeds[0].driverName,payee_type:'driver'}]});
 await assert.rejects(mergeIncomeWorkbook(f.client,preview,mappings,[structuredClone(vehicle),structuredClone(oakVehicleSeeds[0])]),/归属不同/);assert.equal(f.added.length,0);
});
test('different workbook versions and renamed overlapping work are blocked instead of counting twice',async()=>{
 const f=fake({versionConflict:true});await assert.rejects(mergeIncomeWorkbook(f.client,preview,mappings,[structuredClone(vehicle)]),/不同版本/);assert.equal(f.added.length,0);
 const renamed=fake({previous:[task]});await assert.rejects(mergeIncomeWorkbook(renamed.client,{...preview,fileName:'renamed.xlsx'},mappings,[structuredClone(vehicle)]),/已有其他文件/);assert.equal(renamed.added.length,0);
});
test('an equivalent resaved sheet links the existing jobs without duplicating work or rewriting payroll evidence',async()=>{
 const wage={id:'70',category:'labor',vehicleId:vehicle.id,dateFrom:preview.batchPeriod.from,dateTo:preview.batchPeriod.to,version:1,payroll:{fileHash:preview.fileHash,sheetName:task.sheetName}} as VehicleAmount;
 const f=fake({versionConflict:true,versionTasks:[{...task,id:'34',sourceRow:5,rawCells:{G5:100}}],wages:[wage]});
 assert.deepEqual(await mergeIncomeWorkbook(f.client,preview,mappings,[structuredClone(vehicle)]),{added:0,skipped:1});
 const update=f.queries.find(query=>query.sql.startsWith('update oak_vehicle_amounts set payroll_source'))!;
 assert.deepEqual(JSON.parse(String(update.values[2])),{vehicleId:vehicle.id,dateFrom:wage.dateFrom,dateTo:wage.dateTo,fileHash:'old-hash',sheetName:task.sheetName,taskIds:['34']});
 assert.equal(f.added.length,0);assert.equal(wage.payroll?.fileHash,preview.fileHash);
});
test('a changed route, missing leg, or different vehicle cannot reuse a resaved sheet',async()=>{
 for(const versionTasks of [[{...task,id:'34',miles:69}],[{...task,id:'34'},{...task,id:'35',sourceRow:4}],[{...task,id:'34',driverName:oakVehicleSeeds[0].driverName}]]){
  const f=fake({versionConflict:true,versionTasks});await assert.rejects(mergeIncomeWorkbook(f.client,preview,mappings,[structuredClone(vehicle),structuredClone(oakVehicleSeeds[0])]),/不同版本/);
  assert.equal(f.added.length,0);assert.equal(f.queries.some(query=>query.sql.startsWith('update oak_vehicle_amounts')),false);
 }
});
test('equal routes for different vehicles do not create a false duplicate',async()=>{
 const f=fake({previous:[{...task,driverName:oakVehicleSeeds[0].driverName}]});const result=await mergeIncomeWorkbook(f.client,preview,mappings,[structuredClone(vehicle),structuredClone(oakVehicleSeeds[0])]);assert.equal(result.added,1);
});
test('explicit sheet association records an alias, while an already-linked different vehicle is rejected',async()=>{
 const source='Unmapped worksheet',other={...preview,tasks:[{...task,driverName:source,sheetName:source}],sheets:[{...preview.sheets[0],driverName:source,sheetName:source}]};
 const f=fake(),vehicles=[structuredClone(vehicle)];await mergeIncomeWorkbook(f.client,other,[{...mappings[0],sheetName:source}],vehicles);assert.ok(vehicles[0].aliases.includes(source));assert.ok(f.queries.some(query=>query.sql.startsWith('update oak_vehicles')));
 await assert.rejects(mergeIncomeWorkbook(fake().client,preview,[{...mappings[0],vehicleId:oakVehicleSeeds[0].id}],[structuredClone(vehicle),structuredClone(oakVehicleSeeds[0])]),/已关联/);
});
test('worksheet selection preserves leading, trailing and full-width spaces as exact source keys',async()=>{
 const workbook=new ExcelJS.Workbook(),names=[' O王肃','Jay D ','　张晓澄　'];
 for(const name of names){const sheet=workbook.addWorksheet(name);sheet.addRow([name]);sheet.addRow(['Date','柜号','Nature','From','To','Miles','Driver']);sheet.addRow([new Date('2026-08-03'),`QA-${name}`,'TCY1','SFO','95206',68,160]);sheet.addRow(['Total']);}
 const parsed=await parseDriverWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()),'8_1-8_7.xlsx');
 const linkedVehicles=[structuredClone(oakVehicleSeeds[17]),structuredClone(oakVehicleSeeds[18]),structuredClone(vehicle)];
 const input=names.map((sheetName,index)=>({sheetName,vehicleId:linkedVehicles[index].id,payeeType:index===0?'owner':'driver'}));
 const validated=validateIncomeSheetMappings(input,parsed);assert.deepEqual(validated.map(item=>item.sheetName),names);
 const f=fake();await mergeIncomeWorkbook(f.client,parsed,validated,linkedVehicles);assert.deepEqual(f.added.map(item=>item.sheetName),names);
});
test('distinct original sheet names are not silently collapsed by trimming',()=>{
 const spaced={...preview,sheets:[preview.sheets[0],{...preview.sheets[0],sheetName:` ${task.sheetName}`}]};
 const rows=validateIncomeSheetMappings([mappings[0],{...mappings[0],sheetName:` ${task.sheetName}`}],spaced);assert.equal(rows.length,2);assert.notEqual(rows[0].sheetName,rows[1].sheetName);
 assert.throws(()=>validateIncomeSheetMappings([{...mappings[0],sheetName:`${task.sheetName} `}],spaced),/没有工作表/);
});
test('invalid, repeated and empty worksheet selections fail before any database writes',async()=>{
 for(const input of[null,[],[null],[{...mappings[0],sheetName:12}],[{...mappings[0],payeeType:'other'}]])assert.throws(()=>validateIncomeSheetMappings(input,preview));
 assert.throws(()=>validateIncomeSheetMappings([mappings[0],mappings[0]],preview),/被重复选择/);
 const f=fake();await assert.rejects(mergeIncomeWorkbook(f.client,{...preview,sheets:[{...preview.sheets[0],taskCount:0}]},mappings,[structuredClone(vehicle)]),/没有可导入/);assert.equal(f.queries.length,0);
});

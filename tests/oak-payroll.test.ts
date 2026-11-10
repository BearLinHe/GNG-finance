import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parsePayrollWorkbook, payrollRequestKey } from '../lib/oak-payroll-import';
import { parseDriverWorkbook } from '../lib/oak-driver-import';
import { validatePayrollSelection } from '../lib/oak-payroll';
import { oakVehicleSeeds } from '../lib/oak-vehicles';
import { allocateVehicleAmount, calculateDatedVehicleAccounting, type VehicleAmount } from '../lib/oak-vehicle-amounts';

const bytes = async (workbook: ExcelJS.Workbook) => Buffer.from(await workbook.xlsx.writeBuffer());
function addSheet(workbook: ExcelJS.Workbook, name = '张晓澄') {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow([name]);
  sheet.addRow(['Date','柜号','Nature','From','To','Miles','Driver','Owner','Amount',null,'Date','From','To','Nature','Miles','Driver','Owner','Amount']);
  sheet.addRow([new Date('2026-10-03'), 'trailer 1', 'TCY1', 'SFO', '95206',68,200]);
  sheet.addRow([null,'trailer 2',null,'95206','SFO',68]);
  sheet.mergeCells('G3:G4');
  sheet.getCell('A5').value='补助';sheet.getCell('G5').value=50;
  sheet.getCell('A6').value='Total';sheet.getCell('G6').value={formula:'SUM(G3:G5)',result:250};
  sheet.getCell('K3').value=new Date('2026-10-05');sheet.getCell('L3').value='SFO';sheet.getCell('M3').value='STK';sheet.getCell('N3').value='DEL';sheet.getCell('P3').value=100;
  sheet.getCell('K6').value='Total';sheet.getCell('P6').value={formula:'SUM(P3:P5)',result:100};
  sheet.getCell('F7').value='支票金额';sheet.getCell('G7').value=350;
  sheet.getCell('F8').value='减：W2';sheet.getCell('G8').value=20;
  sheet.getCell('F9').value='应付金额';sheet.getCell('G9').value=330;
  sheet.getCell('F10').value='车主薪水';sheet.getCell('G10').value=700;
  return sheet;
}
const parse = async (workbook: ExcelJS.Workbook) => parsePayrollWorkbook(await bytes(workbook),'10_3-10_9.xlsx',oakVehicleSeeds);

test('payroll imports sea-container plus Local gross amounts, not net payments, mileage or owner-salary multipliers',async()=>{
  const workbook=new ExcelJS.Workbook();addSheet(workbook);const preview=await parse(workbook),sheet=preview.sheets[0];
  assert.equal(sheet.amount,350);assert.equal(sheet.selected,true);assert.equal(sheet.vehicleId,'oak-05');assert.equal(sheet.payeeType,'driver');
  assert.equal(sheet.candidates.find(item=>item.id==='driver')?.amount,350);assert.equal(sheet.candidates.find(item=>item.id.startsWith('ownerSalary'))?.amount,700);
  assert.deepEqual([preview.dateFrom,preview.dateTo],['2026-10-03','2026-10-09']);
  assert.equal(sheet.candidates.find(item=>item.id==='driver')?.cells.filter(cell=>cell.address==='G3').length,1);
  assert.ok(!sheet.candidates.some(item=>item.cells.some(cell=>cell.address==='G4')));
});
test('cached formula zero remains a confirmed zero, while missing or erroneous results are not zero',async()=>{
  const workbook=new ExcelJS.Workbook(),sheet=addSheet(workbook);
  sheet.getCell('P3').value=null;sheet.getCell('P6').value={formula:'SUM(P3:P5)',result:0};sheet.getCell('G7').value={formula:'G6+P6',result:250};
  let preview=await parse(workbook);assert.equal(preview.sheets[0].amount,250);assert.equal(preview.sheets[0].selected,true);assert.deepEqual(preview.sheets[0].warnings,[]);
  sheet.getCell('P6').value={formula:'SUM(P3:P5)'};sheet.getCell('G7').value={formula:'G6+P6'};
  preview=await parse(workbook);assert.equal(preview.sheets[0].amount,null);assert.equal(preview.sheets[0].selected,false);
  sheet.getCell('G7').value={formula:'1/0',result:{error:'#DIV/0!'}};
  preview=await parse(workbook);assert.equal(preview.sheets[0].amount,null);
});
test('source mismatches require explicit confirmation instead of silently selecting either amount',async()=>{
  const workbook=new ExcelJS.Workbook(),sheet=addSheet(workbook);sheet.getCell('G7').value=400;
  const preview=await parse(workbook);assert.equal(preview.sheets[0].amount,400);assert.equal(preview.sheets[0].selected,false);assert.ok(preview.sheets[0].warnings.some(item=>item.includes('不同')));
});
test('owner markers use the full Amount when Driver and Owner are separate',async()=>{
  const workbook=new ExcelJS.Workbook(),sheet=addSheet(workbook,'O Don');
  sheet.getCell('H3').value=200;sheet.getCell('H5').value=50;sheet.getCell('I3').value=400;sheet.getCell('I5').value=100;sheet.getCell('I6').value=500;
  sheet.getCell('Q3').value=100;sheet.getCell('R3').value=200;sheet.getCell('R6').value=200;sheet.getCell('F7').value=null;sheet.getCell('G7').value=null;
  const preview=await parse(workbook);assert.equal(preview.sheets[0].amount,700);assert.equal(preview.sheets[0].payeeType,'owner');assert.equal(preview.sheets[0].candidateId,'amount');
});
test('aliases retain leading-zero vehicle IDs, unknown subjects stay unlinked, and duplicate worksheets are deselected',async()=>{
  const workbook=new ExcelJS.Workbook();for(const name of ['Jay D','Sam','刘志豪','0608'])addSheet(workbook,name);
  const preview=await parse(workbook);assert.equal(preview.sheets[0].vehicleId,'oak-19');assert.equal(preview.sheets[1].vehicleId,null);assert.equal(preview.sheets[1].selected,false);
  for(const sheet of preview.sheets.slice(2)){assert.equal(sheet.vehicleId,'oak-26');assert.equal(sheet.selected,false);assert.ok(sheet.warnings.some(item=>item.includes('多张')));}
});
test('the confirmed Xue name variant automatically links new payroll to 3183 without changing its source name',async()=>{
  const workbook=new ExcelJS.Workbook();addSheet(workbook,'薛艳明');const preview=await parse(workbook),sheet=preview.sheets[0];
  assert.equal(sheet.vehicleId,'oak-06');assert.equal(sheet.sheetName,'薛艳明');assert.equal(sheet.selected,true);assert.equal(sheet.amount,350);assert.deepEqual(sheet.warnings,[]);
});
test('date outliers never expand the filename payroll period and templates are ignored',async()=>{
  const workbook=new ExcelJS.Workbook();addSheet(workbook).getCell('A3').value=new Date('2026-10-11');addSheet(workbook,'模板');
  const preview=await parse(workbook);assert.equal(preview.dateTo,'2026-10-09');assert.deepEqual(preview.skippedSheets,['模板']);
});
function addCaliforniaRateSheet(workbook: ExcelJS.Workbook) {
  const sheet=workbook.addWorksheet('翁浩德');
  sheet.addRow(['CA payroll']);
  sheet.addRow(['Date','From','To','Nature','Miles','Rate',null,'CA','NV',null,'MILES','Gallon']);
  sheet.addRow([new Date('2026-08-03'),'SFO','95357','DEL',81,80]);
  sheet.addRow([null,'95357','SFO','EMPTY',96,120]);
  sheet.addRow(['Total',null,null,null,null,{formula:'SUM(F3:F4)',result:200}]);
  return sheet;
}
test('CA Rate total is recognized and empty oversized formatting does not block payroll or work preview',async()=>{
  const workbook=new ExcelJS.Workbook(),sheet=addCaliforniaRateSheet(workbook);
  const zipcode=workbook.addWorksheet('Zipcode');
  zipcode.getCell('A11').value='94587';
  zipcode.getCell('A13486').font={bold:true};
  sheet.getCell('CW90').numFmt='0.00';
  const buffer=await bytes(workbook),fileName='加州-8_1-8_7.xlsx';
  const payroll=await parsePayrollWorkbook(buffer,fileName,oakVehicleSeeds);
  assert.deepEqual([payroll.dateFrom,payroll.dateTo],['2026-08-01','2026-08-07']);
  assert.deepEqual(payroll.skippedSheets,['Zipcode']);
  assert.equal(payroll.sheets[0].amount,200);
  assert.equal(payroll.sheets[0].selected,true);
  assert.equal(payroll.sheets[0].candidates[0].label,'Local合计（Rate）');
  const work=await parseDriverWorkbook(buffer,fileName);
  assert.deepEqual(work.tasks.map(task=>[task.sourceRow,task.workDate,task.miles]),[[3,'2026-08-03',81],[4,'2026-08-03',96]]);
});
test('CA Rate does not infer pay without a matching total formula and a cached total',async()=>{
  const workbook=new ExcelJS.Workbook(),sheet=addCaliforniaRateSheet(workbook);
  sheet.getCell('F5').value={formula:'AVERAGE(F3:F4)',result:100};
  await assert.rejects(parse(workbook),/没有找到可识别的工资表/);
  sheet.getCell('F5').value={formula:'SUM(F3:F4)'};
  assert.equal((await parse(workbook)).sheets[0].amount,null);
  sheet.getCell('F3').value=0;sheet.getCell('F4').value=0;sheet.getCell('F5').value={formula:'SUM(F3:F4)',result:0};
  assert.equal((await parse(workbook)).sheets[0].amount,0);
});
test('real worksheet content outside the limits still names the affected sheet and cell',async()=>{
  const workbook=new ExcelJS.Workbook();addCaliforniaRateSheet(workbook);
  workbook.addWorksheet('Other').getCell('CW2').value={formula:'0',result:0};
  const buffer=await bytes(workbook);
  await assert.rejects(parsePayrollWorkbook(buffer,'8_1-8_7.xlsx',oakVehicleSeeds),/表格超出支持范围.*Other.*CW2/);
  await assert.rejects(parseDriverWorkbook(buffer,'8_1-8_7.xlsx'),/表格超出支持范围.*Other.*CW2/);
});
test('payroll confirmation rejects invalid vehicles, duplicate vehicle rows, negative and blank amounts, and unreasoned adjustments',async()=>{
  const workbook=new ExcelJS.Workbook();addSheet(workbook);addSheet(workbook,'Jay D');const preview=await parse(workbook);
  const selection={sheetName:'张晓澄',vehicleId:'oak-05',payeeType:'driver',candidateId:'check-G7',amount:350,note:''};
  const input={dateFrom:preview.dateFrom,dateTo:preview.dateTo,selections:[selection]};
  assert.equal(validatePayrollSelection(input,preview,oakVehicleSeeds).selections[0].amount,350);
  for(const change of [{vehicleId:'no-car'},{payeeType:null},{amount:-1},{amount:''},{amount:351},{candidateId:'fake'},{candidateId:'manual'}])assert.throws(()=>validatePayrollSelection({...input,selections:[{...selection,...change}]},preview,oakVehicleSeeds));
  assert.throws(()=>validatePayrollSelection({...input,selections:[selection,{...selection,sheetName:'Jay D'}]},preview,oakVehicleSeeds),/多张/);
  assert.equal(validatePayrollSelection({...input,selections:[{...selection,amount:0,note:'本周确认零工资'}]},preview,oakVehicleSeeds).selections[0].amount,0);
});
test('payroll request keys are stable across retries and distinct per workbook and worksheet',()=>{
  assert.equal(payrollRequestKey('hash','张晓澄'),payrollRequestKey('hash','张晓澄'));assert.notEqual(payrollRequestKey('hash','张晓澄'),payrollRequestKey('other','张晓澄'));assert.notEqual(payrollRequestKey('hash','张晓澄'),payrollRequestKey('hash','Jay D'));assert.ok(payrollRequestKey('hash','张晓澄').length<=80);
});
test('imported payroll replaces matching weekly wages and prorates inclusive dates without double-counting',()=>{
  const vehicle=oakVehicleSeeds[4],range={dateFrom:'2026-10-03',dateTo:'2026-10-09'};
  const record:VehicleAmount={...range,id:'1',vehicleId:vehicle.id,category:'labor',amount:700,payeeType:'driver',note:'工资表',version:1,requestKey:'payroll-test',sourceReviewId:null,updatedAt:''};
  const weekly={id:'1',subject:'张晓澄',weekStart:range.dateFrom,weekEnd:range.dateTo,payeeType:'driver' as const,baseAmount:700,adjustments:[],status:'confirmed' as const,taskIds:[]};
  const result=calculateDatedVehicleAccounting(vehicle,{dateFrom:'2026-10-05',dateTo:'2026-10-07'},[],[weekly],null,'hash',[record]);
  assert.equal(result.lines.labor.amount,300);assert.equal(result.laborSources[0].amount,0);
  assert.equal(allocateVehicleAmount(record,{dateFrom:'2026-10-03',dateTo:'2026-10-05'}).allocatedAmount+allocateVehicleAmount(record,{dateFrom:'2026-10-06',dateTo:'2026-10-09'}).allocatedAmount,700);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {payrollForms,payrollFormWarnings,updatePayrollSheetForm,selectedPayrollSheets,planPayrollBatch,PayrollBatchError,type PayrollBatchItem} from '../lib/oak-payroll-batch';
import {payrollWarningLabels} from '../lib/oak-payroll';
import {oakVehicleSeeds} from '../lib/oak-vehicles';
function item(id:string,from='2026-10-03',to='2026-10-09'):PayrollBatchItem{
  const preview={fileName:`${id}.xlsx`,fileHash:id,dateFrom:from,dateTo:to,skippedSheets:[],sheets:[{sheetName:'张晓澄',vehicleId:'oak-05',payeeType:'driver' as const,candidateId:'check',amount:350,selected:true,candidates:[{id:'check',label:'支票金额',amount:350,cells:[]}],warnings:[]}]};
  return{id,preview,vehicles:oakVehicleSeeds,range:{dateFrom:from,dateTo:to},forms:payrollForms(preview)};
}
test('multiple workbooks retain separate periods, same-named worksheets and confirmed amounts',()=>{
  const a=item('week1'),b=item('week2','2026-10-10','2026-10-16');b.forms['张晓澄'].amount='500';b.forms['张晓澄'].note='人工核对';
  const plans=planPayrollBatch([a,b]);assert.equal(plans.length,2);assert.equal(plans[0].input.selections[0].amount,350);assert.equal(plans[1].input.selections[0].amount,500);
  assert.equal(plans[0].input.dateFrom,'2026-10-03');assert.equal(plans[1].input.dateFrom,'2026-10-10');assert.equal(a.forms['张晓澄'].amount,'350.00');
});
test('all files validate before any submission, including notes, dates and vehicle identities',()=>{
  const a=item('week1'),b=item('week2','2026-10-10','2026-10-16');b.forms['张晓澄'].amount='500';
  assert.throws(()=>planPayrollBatch([a,b]),error=>error instanceof PayrollBatchError&&error.fileId==='week2'&&error.message.includes('核对备注'));
  b.forms['张晓澄'].amount='350';b.range.dateTo='2026-10-01';assert.throws(()=>planPayrollBatch([a,b]),/开始日期/);
  b.range.dateTo='2026-10-16';b.forms['张晓澄'].vehicleId='unknown';assert.throws(()=>planPayrollBatch([a,b]),/关联车辆/);
});
test('cross-file duplicate contents and inclusive overlapping periods cannot double-count wages',()=>{
  const a=item('week1'),b=item('week2','2026-10-10','2026-10-16');b.preview.fileHash=a.preview.fileHash;
  assert.throws(()=>planPayrollBatch([a,b]),/内容.*重复/);b.preview.fileHash='week2';b.range.dateFrom='2026-10-09';
  assert.throws(()=>planPayrollBatch([a,b]),/周期.*重叠/);b.range.dateFrom='2026-10-10';assert.equal(planPayrollBatch([a,b]).length,2);
});
test('different vehicles can have the same period, and excluded worksheets do not block another file',()=>{
  const a=item('week1'),b=item('week2');b.forms['张晓澄'].vehicleId='oak-19';assert.equal(planPayrollBatch([a,b]).length,2);
  b.forms['张晓澄'].selected=false;assert.equal(planPayrollBatch([a,b]).length,1);assert.equal(selectedPayrollSheets(b).length,0);
});
test('existing imported sheets and empty selections are never submitted again, while valid zero remains importable',()=>{
  const a=item('week1');a.preview.sheets[0].existingId='100';a.forms=payrollForms(a.preview);
  assert.equal(a.forms['张晓澄'].selected,false);a.forms['张晓澄'].selected=true;assert.throws(()=>planPayrollBatch([a]),/请选择/);
  const b=item('week2');b.forms['张晓澄'].amount='0';b.forms['张晓澄'].note='确认零工资';assert.equal(planPayrollBatch([a,b])[0].input.selections[0].amount,0);
});
test('manual vehicle association selects a valid missing row and clears only resolved identity warnings',()=>{
  const a=item('unlinked'),sheet=a.preview.sheets[0];sheet.vehicleId=null;sheet.selected=false;sheet.warnings=[payrollWarningLabels.vehicle];a.forms=payrollForms(a.preview);
  const next=updatePayrollSheetForm(a,sheet.sheetName,{vehicleId:'oak-06'});
  assert.equal(next.selected,true);assert.deepEqual(payrollFormWarnings(sheet,next,a.vehicles),[]);
  assert.deepEqual(sheet.warnings,[payrollWarningLabels.vehicle]);
  a.forms[sheet.sheetName]=next;assert.equal(planPayrollBatch([a])[0].input.selections[0].vehicleId,'oak-06');
  assert.equal(updatePayrollSheetForm(a,sheet.sheetName,{vehicleId:''}).selected,false);
});
test('association never silently selects amounts with a mismatch, missing amount, unknown role or existing record',()=>{
  const a=item('unlinked'),sheet=a.preview.sheets[0];sheet.vehicleId=null;sheet.selected=false;sheet.warnings=[payrollWarningLabels.vehicle,'合计金额不同，请核对'];a.forms=payrollForms(a.preview);
  let next=updatePayrollSheetForm(a,sheet.sheetName,{vehicleId:'oak-06'});assert.equal(next.selected,false);assert.deepEqual(payrollFormWarnings(sheet,next,a.vehicles),['合计金额不同，请核对']);
  sheet.warnings=[payrollWarningLabels.vehicle];a.forms[sheet.sheetName].amount='';assert.equal(updatePayrollSheetForm(a,sheet.sheetName,{vehicleId:'oak-06'}).selected,false);
  a.forms[sheet.sheetName].amount='350';a.forms[sheet.sheetName].payeeType='';assert.equal(updatePayrollSheetForm(a,sheet.sheetName,{vehicleId:'oak-06'}).selected,false);
  a.forms[sheet.sheetName].payeeType='driver';sheet.existingId='100';assert.equal(updatePayrollSheetForm(a,sheet.sheetName,{vehicleId:'oak-06'}).selected,false);
});

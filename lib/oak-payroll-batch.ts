import {payrollWarningLabels,validatePayrollSelection,type PayrollPreview,type PayrollImportInput,type PayrollSheet} from './oak-payroll';
import type {OakVehicle} from './oak-vehicles';
import type {VehicleRange} from './oak-vehicle-accounting';

export const maxPayrollFiles = 20;
export type PayrollSheetForm = {selected:boolean;vehicleId:string;payeeType:string;candidateId:string;amount:string;note:string};
export type PayrollBatchItem = {id:string;preview:PayrollPreview;vehicles:OakVehicle[];range:VehicleRange;forms:Record<string,PayrollSheetForm>};
export class PayrollBatchError extends Error {
  constructor(public fileId:string,message:string){super(message);}
}
export function payrollForms(preview:PayrollPreview):Record<string,PayrollSheetForm>{
  return Object.fromEntries(preview.sheets.map(sheet=>[sheet.sheetName,{selected:sheet.selected&&!sheet.existingId,vehicleId:sheet.vehicleId||'',payeeType:sheet.payeeType||'',candidateId:sheet.candidateId,amount:sheet.amount==null?'':sheet.amount.toFixed(2),note:''}]));
}
export function selectedPayrollSheets(item:Pick<PayrollBatchItem,'preview'|'forms'>){
  return item.preview.sheets.filter(sheet=>!sheet.existingId&&item.forms[sheet.sheetName]?.selected);
}
export function payrollFormWarnings(sheet:PayrollSheet,form:PayrollSheetForm,vehicles:OakVehicle[]){
  const linked=vehicles.some(vehicle=>vehicle.id===form.vehicleId);
  const typed=form.payeeType==='driver'||form.payeeType==='owner';
  return sheet.warnings.filter(warning=>!(warning===payrollWarningLabels.vehicle&&linked)&&!(warning===payrollWarningLabels.payeeType&&typed));
}
export function updatePayrollSheetForm(item:PayrollBatchItem,name:string,values:Partial<PayrollSheetForm>):PayrollSheetForm{
  const sheet=item.preview.sheets.find(sheet=>sheet.sheetName===name)!;
  const next={...item.forms[name],...values};
  if(sheet.existingId)return{...next,selected:false};
  if('vehicleId' in values||'payeeType' in values){
    if(!item.vehicles.some(vehicle=>vehicle.id===next.vehicleId)||(next.payeeType!=='driver'&&next.payeeType!=='owner'))next.selected=false;
    else if(!payrollFormWarnings(sheet,next,item.vehicles).length){
      try{validatePayrollSelection({...item.range,selections:[{...next,sheetName:name}]},item.preview,item.vehicles);next.selected=true;}
      catch{next.selected=false;}
    }
  }
  return next;
}
export function planPayrollBatch(items:PayrollBatchItem[]):Array<{id:string;input:PayrollImportInput}>{
  const plans:Array<{id:string;input:PayrollImportInput}>=[];
  const hashes=new Map<string,string>();
  const spans=new Map<string,Array<VehicleRange&{fileName:string}>>();
  for(const item of items){
    const selected=selectedPayrollSheets(item);if(!selected.length)continue;
    try{
      const previous=hashes.get(item.preview.fileHash);
      if(previous)throw new Error(`文件内容与 ${previous} 重复，请只选择一份`);
      const input=validatePayrollSelection({...item.range,selections:selected.map(sheet=>({...item.forms[sheet.sheetName],sheetName:sheet.sheetName}))},item.preview,item.vehicles);
      for(const selection of input.selections){
        const previous=(spans.get(selection.vehicleId)||[]).find(span=>span.dateFrom<=input.dateTo&&span.dateTo>=input.dateFrom);
        if(previous){const vehicle=item.vehicles.find(vehicle=>vehicle.id===selection.vehicleId)!;throw new Error(`${vehicle.vehicleNumber||vehicle.driverName} 的工资周期与 ${previous.fileName} 重叠，请核对后只选择一笔`);}
        spans.set(selection.vehicleId,[...(spans.get(selection.vehicleId)||[]),{dateFrom:input.dateFrom,dateTo:input.dateTo,fileName:item.preview.fileName}]);
      }
      hashes.set(item.preview.fileHash,item.preview.fileName);plans.push({id:item.id,input});
    }catch(error){throw new PayrollBatchError(item.id,`${item.preview.fileName}：${(error as Error).message}`);}
  }
  if(!plans.length)throw new Error('请选择要导入的工资工作表');
  return plans;
}

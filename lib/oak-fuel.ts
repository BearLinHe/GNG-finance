import type {VehicleRange} from './oak-vehicle-accounting';
import type {VehicleAmount} from './oak-vehicle-amounts';
import {vehicleForSubject,type OakVehicle} from './oak-vehicles';
import {matchesPayrollActivityLink,type PayrollActivityTarget} from './oak-payroll-activity';

export type FuelMileageDay={workDate:string;miles:number|null};
export type FuelMileageContext={days:FuelMileageDay[];coverage:VehicleRange[];gaps:Array<VehicleRange&{reason:string}>};
export type FuelMileageSource={driverName:string;sheetName:string;fileHash:string;fileName:string;dateFrom:string|null;dateTo:string|null;taskIds?:string[]};
export type FuelAllocation={allocatedAmount:number|null;overlapDays:number;totalDays:number;basis:'mileage';periodMiles:number|null;rangeMiles:number|null;unitPrice:number|null;pendingReason?:string};
export type FuelWorkMileage=VehicleRange&{miles:number|null;pendingReason?:string};
export type FuelLedgerSummary={amount:number;miles:number;rate:number|null};
const day=(date:string)=>Date.parse(`${date}T00:00:00Z`)/86400000;
const overlaps=(a:VehicleRange,b:VehicleRange)=>a.dateFrom<=b.dateTo&&a.dateTo>=b.dateFrom;
const validMiles=(miles:number|null):miles is number=>miles!=null&&Number.isFinite(miles)&&miles>=0;
const units=(item:FuelMileageDay)=>Math.round(item.miles!*100);

function mileageCoverageIssue(context:FuelMileageContext,range:VehicleRange){
 const gap=context.gaps.find(item=>overlaps(item,range));if(gap)return gap.reason;
 let cursor=day(range.dateFrom);
 for(const source of context.coverage.filter(item=>overlaps(item,range)).sort((a,b)=>a.dateFrom.localeCompare(b.dateFrom))){
  if(day(source.dateFrom)>cursor)break;cursor=Math.max(cursor,day(source.dateTo)+1);
 }
 if(cursor<=day(range.dateTo))return '作业周表未覆盖完整，请补齐该区间工单';
}

export function summarizeFuelWorkMileage(record:VehicleRange,filter?:VehicleRange|null,context?:FuelMileageContext):FuelWorkMileage|null{
 const dateFrom=filter&&filter.dateFrom>record.dateFrom?filter.dateFrom:record.dateFrom;
 const dateTo=filter&&filter.dateTo<record.dateTo?filter.dateTo:record.dateTo;
 if(dateFrom>dateTo)return null;
 const range={dateFrom,dateTo};
 if(!context)return {...range,miles:null,pendingReason:'未找到该车的工单里程'};
 const days=context.days.filter(item=>item.workDate>=dateFrom&&item.workDate<=dateTo);
 if(days.some(item=>!validMiles(item.miles)))return {...range,miles:null,pendingReason:'统计区间内有工单缺少有效里程'};
 const total=days.reduce((sum,item)=>sum+units(item),0);
 if(!Number.isSafeInteger(total))return {...range,miles:null,pendingReason:'统计区间里程数值异常，请核对'};
 const pendingReason=mileageCoverageIssue(context,range);
 return {...range,miles:pendingReason&&!days.length?null:total/100,pendingReason};
}

export function buildFuelMileageContexts(vehicles:OakVehicle[],days:Array<FuelMileageDay&{driverName:string}>,sources:FuelMileageSource[],wages:Pick<VehicleAmount,'vehicleId'|'dateFrom'|'dateTo'|'payroll'>[]):Record<string,FuelMileageContext>{
 const contexts:Record<string,FuelMileageContext>={};
 const get=(id:string)=>contexts[id]??={days:[],coverage:[],gaps:[]};
 const loaded=new Set<string>();
 const targets:PayrollActivityTarget[]=[];
 for(const source of sources){
  const vehicle=vehicleForSubject(vehicles,source.driverName);if(!vehicle)continue;
  loaded.add(JSON.stringify([vehicle.id,source.fileHash,source.sheetName]));
  if(source.taskIds)targets.push({...source,taskIds:source.taskIds,vehicleId:vehicle.id});
  if(source.dateFrom&&source.dateTo)get(vehicle.id).coverage.push({dateFrom:source.dateFrom,dateTo:source.dateTo});
 }
 for(const row of days){const vehicle=vehicleForSubject(vehicles,row.driverName);if(vehicle)get(vehicle.id).days.push({workDate:row.workDate,miles:row.miles});}
 for(const wage of wages){
  if(!wage.payroll||loaded.has(JSON.stringify([wage.vehicleId,wage.payroll.fileHash,wage.payroll.sheetName]))||targets.some(target=>matchesPayrollActivityLink(wage,target)))continue;
  get(wage.vehicleId).gaps.push({dateFrom:wage.dateFrom,dateTo:wage.dateTo,reason:`尚未同步作业：${wage.payroll.fileName}`});
 }
 for(const context of Object.values(contexts)){
  context.days.sort((a,b)=>a.workDate.localeCompare(b.workDate)||(a.miles??-1)-(b.miles??-1));
  context.coverage.sort((a,b)=>a.dateFrom.localeCompare(b.dateFrom)||a.dateTo.localeCompare(b.dateTo));
  context.gaps.sort((a,b)=>a.dateFrom.localeCompare(b.dateFrom)||a.reason.localeCompare(b.reason));
 }
 return contexts;
}

export function allocateFuelAmount(record:VehicleRange&{amount:number},range:VehicleRange,context?:FuelMileageContext):FuelAllocation{
 const from=record.dateFrom>range.dateFrom?record.dateFrom:range.dateFrom,to=record.dateTo<range.dateTo?record.dateTo:range.dateTo;
 const totalDays=day(record.dateTo)-day(record.dateFrom)+1,overlapDays=Math.max(0,day(to)-day(from)+1);
 const result:FuelAllocation={allocatedAmount:null,overlapDays,totalDays,basis:'mileage',periodMiles:null,rangeMiles:null,unitPrice:null};
 if(!overlapDays)return {...result,allocatedAmount:0};
 if(from===record.dateFrom&&to===record.dateTo)return {...result,allocatedAmount:record.amount};
 if(record.amount===0)return {...result,allocatedAmount:0};
 const pending=(pendingReason:string)=>({...result,pendingReason});
 if(!context)return pending('缺少完整费用周期的作业里程');
 const coverageIssue=mileageCoverageIssue(context,record);if(coverageIssue)return pending(coverageIssue);
 const days=context.days.filter(item=>item.workDate>=record.dateFrom&&item.workDate<=record.dateTo);
 if(days.some(item=>!validMiles(item.miles)))return pending('费用周期内有作业缺少有效里程');
 const total=days.reduce((sum,item)=>sum+units(item),0);
 if(!Number.isSafeInteger(total))return pending('费用周期里程数值异常，请核对');
 if(!total)return pending('费用周期总里程为 0，需核对里程');
 const before=days.filter(item=>item.workDate<from).reduce((sum,item)=>sum+units(item),0);
 const within=days.filter(item=>item.workDate>=from&&item.workDate<=to).reduce((sum,item)=>sum+units(item),0);
 const cents=Math.round(record.amount*100);
 // Round cumulative mileage shares so adjacent periods reconcile to the original cents.
 const prefix=(miles:number)=>Number((BigInt(cents)*BigInt(miles)*2n+BigInt(total))/(BigInt(total)*2n));
 return {...result,allocatedAmount:(prefix(before+within)-prefix(before))/100,periodMiles:total/100,rangeMiles:within/100,unitPrice:record.amount/(total/100)};
}

export function sumRecordedVehicleMiles(vehicles:OakVehicle[],rows:Array<{driverName:string;miles:number}>,vehicleId:string){
 return rows.reduce((total,row)=>{
  const vehicle=vehicleForSubject(vehicles,row.driverName);
  return vehicle&&(!vehicleId||vehicle.id===vehicleId)&&validMiles(row.miles)?total+Math.round(row.miles*100):total;
 },0)/100;
}

export function summarizeFuelLedger(records:Array<Pick<VehicleAmount,'amount'>>,miles:number):FuelLedgerSummary{
 const amount=records.reduce((sum,record)=>sum+Math.round(record.amount*100),0)/100;
 return {amount,miles,rate:records.length&&miles>0?amount/miles:null};
}

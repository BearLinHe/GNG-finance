import type {VehicleRange} from './oak-vehicle-accounting';
import type {VehicleAmount} from './oak-vehicle-amounts';
import {vehicleForSubject,type OakVehicle} from './oak-vehicles';

export type FuelMileageDay={workDate:string;miles:number|null};
export type FuelMileageContext={days:FuelMileageDay[];coverage:VehicleRange[];gaps:Array<VehicleRange&{reason:string}>};
export type FuelMileageSource={driverName:string;sheetName:string;fileHash:string;fileName:string;dateFrom:string|null;dateTo:string|null};
export type FuelAllocation={allocatedAmount:number|null;overlapDays:number;totalDays:number;basis:'mileage';periodMiles:number|null;rangeMiles:number|null;unitPrice:number|null;pendingReason?:string};
const day=(date:string)=>Date.parse(`${date}T00:00:00Z`)/86400000;
const overlaps=(a:VehicleRange,b:VehicleRange)=>a.dateFrom<=b.dateTo&&a.dateTo>=b.dateFrom;

export function buildFuelMileageContexts(vehicles:OakVehicle[],days:Array<FuelMileageDay&{driverName:string}>,sources:FuelMileageSource[],wages:Pick<VehicleAmount,'vehicleId'|'dateFrom'|'dateTo'|'payroll'>[]):Record<string,FuelMileageContext>{
 const contexts:Record<string,FuelMileageContext>={};
 const get=(id:string)=>contexts[id]??={days:[],coverage:[],gaps:[]};
 const loaded=new Set<string>();
 for(const source of sources){
  const vehicle=vehicleForSubject(vehicles,source.driverName);if(!vehicle)continue;
  loaded.add(JSON.stringify([vehicle.id,source.fileHash,source.sheetName]));
  if(source.dateFrom&&source.dateTo)get(vehicle.id).coverage.push({dateFrom:source.dateFrom,dateTo:source.dateTo});
 }
 for(const row of days){const vehicle=vehicleForSubject(vehicles,row.driverName);if(vehicle)get(vehicle.id).days.push({workDate:row.workDate,miles:row.miles});}
 for(const wage of wages){
  if(!wage.payroll||loaded.has(JSON.stringify([wage.vehicleId,wage.payroll.fileHash,wage.payroll.sheetName])))continue;
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
 const gap=context.gaps.find(item=>overlaps(item,record));if(gap)return pending(gap.reason);
 let cursor=day(record.dateFrom);
 for(const source of [...context.coverage].filter(item=>overlaps(item,record)).sort((a,b)=>a.dateFrom.localeCompare(b.dateFrom))){
  if(day(source.dateFrom)>cursor)break;cursor=Math.max(cursor,day(source.dateTo)+1);
 }
 if(cursor<=day(record.dateTo))return pending('费用周期的作业周表未覆盖完整，请补齐整月作业');
 const days=context.days.filter(item=>item.workDate>=record.dateFrom&&item.workDate<=record.dateTo);
 if(days.some(item=>item.miles==null||!Number.isFinite(item.miles)||item.miles<0))return pending('费用周期内有作业缺少有效里程');
 const units=(item:FuelMileageDay)=>Math.round(item.miles!*100);
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

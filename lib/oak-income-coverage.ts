import type{VehicleAmount}from'./oak-vehicle-amounts';
import type{VehicleRange}from'./oak-vehicle-accounting';
export type IncomeActivitySource={fileHash:string;sheetNames:string[]};
export type IncomeActivityGap=VehicleRange&{id:string;vehicleId:string;fileName:string;sheetName:string};
export function incomeActivityGaps(records:VehicleAmount[],sources:IncomeActivitySource[],range:VehicleRange):IncomeActivityGap[]{
  const loaded=new Set(sources.flatMap(source=>source.sheetNames.map(name=>JSON.stringify([source.fileHash,name]))));
  const manual=records.filter(record=>record.category==='income');
  return records.filter(record=>record.category==='labor'&&record.payroll&&record.dateFrom<=range.dateTo&&record.dateTo>=range.dateFrom).flatMap(record=>{
    const payroll=record.payroll!;if(loaded.has(JSON.stringify([payroll.fileHash,payroll.sheetName])))return[];
    const from=record.dateFrom>range.dateFrom?record.dateFrom:range.dateFrom,to=record.dateTo<range.dateTo?record.dateTo:range.dateTo;
    const end=Date.parse(to);let cursor=Date.parse(from);
    for(const entry of manual.filter(item=>item.vehicleId===record.vehicleId&&item.dateFrom<=to&&item.dateTo>=from).sort((a,b)=>a.dateFrom.localeCompare(b.dateFrom))){
      if(Date.parse(entry.dateFrom)>cursor)break;cursor=Math.max(cursor,Date.parse(entry.dateTo)+86400000);
    }
    return cursor>end?[]:[{id:record.id,vehicleId:record.vehicleId,dateFrom:from,dateTo:to,fileName:payroll.fileName,sheetName:payroll.sheetName}];
  });
}

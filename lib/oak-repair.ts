import type {OakVehicle} from './oak-vehicles';
import type {VehicleAmount} from './oak-vehicle-amounts';
export type RepairDetails={invoiceId:string;invoiceNumber:string;caseId:string;unitNumber:string;plate:string|null;company:string|null;paymentStatus:string;
 sourceAccount:{id:string;name:string|null;login:string|null};
 checkInDate:string|null;completedDate:string|null;issuedDate:string|null;dateBasis:'completed'|'issued';items:string[];
 parts:Array<{name:string;qty:number;unitPrice:number;amount:number}>;labor:Array<{name:string;hours:number;rate:number;amount:number}>;
 partsAmount:number;laborAmount:number;cleaningAmount:number;taxAmount:number;total:number};
export type RepairFeedStatus={configured:boolean;available:boolean;message:string;matchedVehicleIds:string[];warnings:string[];reviewVehicleIds?:string[]};
export type RepairFeed={records:VehicleAmount[];status:RepairFeedStatus};
// bearlinhe is a test account; cover both its legacy data owner and current app user ID.
export const excludedRepairOwnerIds=['user_3AVAzLh7mYN2WocTWCeJumCpsrB','45b19a33-1304-431d-8234-1895106b2400'];
const isExcludedRepairOwner=(value:unknown)=>typeof value==='string'&&excludedRepairOwnerIds.includes(value);
export function repairUnitKey(value:unknown){
 const key=typeof value==='string'?value.normalize('NFKC').trim().toUpperCase().replace(/\s+/g,' '):'';
 // Legacy Truck labels and California trucks use the roster number; keep GA/trailer/chassis distinct.
 return /^(?:CA )?TRUCK ([A-Z0-9]+)$/.exec(key)?.[1]||key;
}
export function repairUnitAliases(value:unknown){
 const key=repairUnitKey(value);
 return key?[key,`TRUCK ${key}`,`CA TRUCK ${key}`]:[];
}
export function repairLocalDate(value:unknown){
 if(value==null||!Number.isFinite(Number(value)))return null;
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(Number(value)));
 const get=(type:string)=>parts.find(part=>part.type===type)?.value;return `${get('year')}-${get('month')}-${get('day')}`;
}
const dollars=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value/100:null;
const list=(value:unknown)=>Array.isArray(value)?value:[];
export function normalizeRepairInvoices(vehicles:OakVehicle[],cases:Array<{unit_number:string;clerk_user_id?:string}>,invoices:Record<string,any>[]):RepairFeed{
 const matches=new Map<string,OakVehicle[]>();for(const vehicle of vehicles){const key=repairUnitKey(vehicle.vehicleNumber);if(key)matches.set(key,[...(matches.get(key)||[]),vehicle]);}
 const matchedVehicleIds=[...new Set(cases.filter(record=>!isExcludedRepairOwner(record.clerk_user_id)).flatMap(record=>{const found=matches.get(repairUnitKey(record.unit_number));return found?.length===1?[found[0].id]:[];}))];
 const records:VehicleAmount[]=[];const warnings:string[]=[];const reviewVehicleIds=new Set<string>();
 for(const invoice of invoices){
  if(isExcludedRepairOwner(invoice.clerk_user_id)||isExcludedRepairOwner(invoice.invoice_owner_id))continue;
  const found=matches.get(repairUnitKey(invoice.unit_number));if(found?.length!==1||invoice.case_status!=='COMPLETED'||invoice.payment_status==='VOID')continue;
  const amount=dollars(invoice.grand_total_cents);const completedDate=repairLocalDate(invoice.completed_ms),issuedDate=repairLocalDate(invoice.issued_ms);
  if(amount==null||(!completedDate&&!issuedDate)){warnings.push(`${invoice.invoice_number} 金额或日期待核对`);reviewVehicleIds.add(found[0].id);continue;}
  const date=completedDate||issuedDate!;const snapshot=invoice.snapshot&&typeof invoice.snapshot==='object'&&!Array.isArray(invoice.snapshot)?invoice.snapshot:{};
  const parts=list(Array.isArray(snapshot.parts)?snapshot.parts:invoice.parts).map((part:any)=>({name:String(part.name||''),qty:Number(part.qty)||0,unitPrice:dollars(part.unit_price_cents)??0,amount:dollars(part.line_total_cents)??0}));
  const labor=list(Array.isArray(snapshot.labor)?snapshot.labor:invoice.labor).map((item:any)=>({name:String(item.name||''),hours:Number(item.hours)||0,rate:dollars(item.rate_cents)??0,amount:dollars(item.line_total_cents)??0}));
  const details:RepairDetails={invoiceId:String(invoice.id),invoiceNumber:String(invoice.invoice_number),caseId:String(invoice.case_id),unitNumber:String(invoice.unit_number),plate:invoice.plate||null,company:invoice.bill_to_company||null,paymentStatus:String(invoice.payment_status),
   sourceAccount:{id:String(invoice.invoice_owner_id||invoice.clerk_user_id||''),name:typeof invoice.account_name==='string'?invoice.account_name:null,login:typeof invoice.account_login==='string'?invoice.account_login:null},
   checkInDate:repairLocalDate(invoice.check_in_ms),completedDate,issuedDate,dateBasis:completedDate?'completed':'issued',
   items:list(Array.isArray(snapshot.repair_items)?snapshot.repair_items:invoice.repair_items).map((item:any)=>String(item.name||'')).filter(Boolean),parts,labor,
   partsAmount:dollars(invoice.parts_revenue_cents)??0,laborAmount:dollars(invoice.labor_revenue_cents)??0,cleaningAmount:dollars(invoice.cleaning_fee_cents)??0,taxAmount:dollars(invoice.tax_cents)??0,total:amount};
  if(!completedDate)warnings.push(`${invoice.invoice_number} 缺少完工日期，暂按开票日期展示`);
  records.push({id:`repair-${invoice.id}`,vehicleId:found[0].id,category:'maintenance',dateFrom:date,dateTo:date,amount,payeeType:null,note:`${invoice.invoice_number} · ${details.items.join('、')||parts.map(part=>part.name).join('、')||'维修账单'}`,version:Math.max(1,Math.round(Number(invoice.updated_ms)||1)),requestKey:`repair-${invoice.id}`,sourceReviewId:null,updatedAt:new Date(Number(invoice.updated_ms)||0).toISOString(),source:'repair',repair:details});
 }
 records.sort((a,b)=>a.dateFrom.localeCompare(b.dateFrom)||a.id.localeCompare(b.id));
 return {records,status:{configured:true,available:true,message:'维修库已连接（已排除测试账户）',matchedVehicleIds,warnings,reviewVehicleIds:[...reviewVehicleIds]}};
}

import { randomUUID } from 'node:crypto';
import { vehicleRange } from './oak-vehicle-accounting';
import { incomeAmount } from './oak-income';
import { validateVehicleAmount, type VehicleAmount, type VehicleAmountInput } from './oak-vehicle-amounts';

export class AssistantInputError extends Error {}
export const writableKinds = ['fuel', 'insurance', 'other'] as const;
export const kindLabels = { fuel:'油费', insurance:'车辆保险', other:'其他费用', labor:'工资', maintenance:'维修费', income:'手工收入核定' } as const;
export type EditRow = { vehicleNumber: string; category: typeof writableKinds[number]; dateFrom: string; dateTo: string; oldAmount: number | null; recordId: string | null; amount: number; note: string };
export type PreparedEdit = { row: EditRow; input: VehicleAmountInput };
export type AssistantTurn = {role:'user'|'assistant'; content:string};
export type AssistantPage = { module: 'external'|'sav'|'oak-transport'; title: string; facts: string };
export function validateAssistantPage(raw:unknown):AssistantPage|undefined {
  if(raw===undefined)return undefined;
  const page=raw as Partial<AssistantPage>|null;
  if(!page||!['external','sav','oak-transport'].includes(page.module??'')||typeof page.title!=='string'||page.title.length>80||
    typeof page.facts!=='string'||page.facts.length>7000||/sk-(?:proj-)?[A-Za-z0-9_-]{20,}|postgres(?:ql)?:\/\//i.test(page.title+page.facts))
    throw new AssistantInputError('页面摘要无效，请刷新页面后重试');
  return {module:page.module!,title:page.title,facts:page.facts};
}
export type AssistantReply = { text:string; evidence?:string[]; draft?:{token:string;rows:EditRow[]} };

export function localAssistantRequest(request:Request, development:boolean) {
  if (!development) return false;
  const host=request.headers.get('host'), origin=request.headers.get('origin');
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) || request.headers.has('x-forwarded-for') && !/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(request.headers.get('x-forwarded-for')!)) return false;
  return request.method === 'GET' || (origin===`http://${host}` && request.headers.get('content-type')?.split(';')[0]==='application/json');
}

export function dateRange(value: Record<string,unknown>) {
  try { return vehicleRange(value); } catch { throw new AssistantInputError('请给出有效的开始日期和结束日期'); }
}

export function prepareEdit(raw:Record<string,unknown>,vehicles:{id:string;vehicleNumber:string|null}[],existing:VehicleAmount[]):PreparedEdit {
  const {vehicleNumber,category,recordId}=raw;
  const matches=vehicles.filter(v=>v.vehicleNumber===vehicleNumber && vehicleNumber);
  if(matches.length!==1) throw new AssistantInputError('无法唯一确定车号，请确认车号并保留前导零');
  const vehicle=matches[0];
  if(!writableKinds.includes(category as typeof writableKinds[number])) throw new AssistantInputError('只允许修改油费、保险和其他费用');
  if(recordId!==null && (typeof recordId!=='string' || !/^[1-9]\d{0,14}$/.test(recordId))) throw new AssistantInputError('修改必须指定已有明细编号');
  const range=dateRange(raw),rows=existing.filter(r=>r.vehicleId===vehicle.id && r.category===category);
  const old=recordId===null?null:rows.find(r=>r.id===recordId);
  if(recordId!==null && (!old || old.dateFrom!==range.dateFrom || old.dateTo!==range.dateTo || old.payroll || old.sourceReviewId || old.source==='repair')) throw new AssistantInputError('原记录的车号、类别或周期不符，或该明细由其他来源维护');
  if(!old && rows.some(r=>r.dateFrom<=range.dateTo && r.dateTo>=range.dateFrom)) throw new AssistantInputError(`${vehicleNumber} 有重叠周期的同类费用，请核对现有明细，不会重复新增`);
  let amount:number;try{amount=incomeAmount(raw.amount);}catch{throw new AssistantInputError('金额必须为非负美元，最多两位小数');}
  if(old?.amount===amount) throw new AssistantInputError('修改后的金额与原金额相同');
  const note=old?.note ?? (typeof raw.note==='string' ? raw.note.trim() : '');
  if(note.length>300 && !old) throw new AssistantInputError('备注过长');
  const input=validateVehicleAmount({...range,id:old?.id??null,version:old?.version??0,category,amount,note,requestKey:old?.requestKey??randomUUID(),vehicleId:vehicle.id,payeeType:null});
  return {row:{...range,vehicleNumber:vehicle.vehicleNumber!,category:category as EditRow['category'],recordId:input.id,oldAmount:old?.amount??null,amount,note},input};
}

export function checkBatch(items:PreparedEdit[]) {
  if(!items.length || items.length>40) throw new AssistantInputError('每批可核对 1 至 40 条明细');
  for(let i=0;i<items.length;i++) for(const b of items.slice(i+1)){
    const a=items[i].input,other=b.input;
    if(a.vehicleId===other.vehicleId && a.category===other.category && a.dateFrom<=other.dateTo && a.dateTo>=other.dateFrom && (!a.id || !other.id || a.id===other.id)) throw new AssistantInputError('草稿内有重复或周期重叠的明细，请拆分核对');
  }
}

export function recheckEdit(edit:PreparedEdit, vehicles:Parameters<typeof prepareEdit>[1], records:VehicleAmount[]) {
  const fresh=prepareEdit(edit.row,vehicles,records);
  if(fresh.input.version!==edit.input.version || fresh.input.vehicleId!==edit.input.vehicleId || fresh.row.oldAmount!==edit.row.oldAmount)
    throw new AssistantInputError('原始明细已变化，请重新生成草稿');
}

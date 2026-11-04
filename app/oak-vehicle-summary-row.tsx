"use client";
import {Fragment,useEffect,useRef,useState,type ReactNode} from "react";
import {GripVertical,RefreshCw,RotateCcw,Save} from "lucide-react";
import {incomeMoney,json} from "./oak-income-controls";
import {tableDrag} from "./oak-table-layout";
import {vehicleFields,type VehicleAccountingResponse,type VehicleAccountingRow,type VehicleField,type VehicleRange} from "@/lib/oak-vehicle-accounting";
import type {VehicleAmountCategory} from "@/lib/oak-vehicle-amounts";
import {vehicleTotalsPreview} from '@/lib/oak-vehicle-totals';
type Draft=Record<VehicleField,{mode:'auto'|'manual';value:string}>;
type State={row:VehicleAccountingRow;range:VehicleRange;draft:Draft;other:string;number:string;edited:VehicleField[];otherChanged:boolean};
const text=(value:number|null)=>value==null?'':value.toFixed(2);
const parse=(value:string)=>/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)?Number(value):null;
const draftFor=(row:VehicleAccountingRow):Draft=>Object.fromEntries(vehicleFields.map(key=>[key,{mode:(key==='income'||key==='labor')&&!row.amounts?.some(item=>item.category===key)?'auto':'manual',value:text(row.lines[key].amount)}])) as Draft;
const initialState=(row:VehicleAccountingRow):State=>({row,range:{dateFrom:row.dateFrom,dateTo:row.dateTo},draft:draftFor(row),other:String(row.otherAmount),number:row.vehicle.vehicleNumber||'',edited:[],otherChanged:false});
export default function VehicleSummaryRow({initial,hidden,columnOrder,onDirty,onUpdated,onOpenAmounts,onMoveRow,registerFlush}:{initial:VehicleAccountingRow;hidden:boolean;columnOrder:string[];onDirty:(id:string,dirty:boolean)=>void;onUpdated:(row:VehicleAccountingRow)=>void;onOpenAmounts:(category:VehicleAmountCategory,row:VehicleAccountingRow)=>void;onMoveRow:(from:string,to:string)=>void;registerFlush:(id:string,flush:(()=>Promise<boolean>)|null)=>void}){
 const [state,setState]=useState(()=>initialState(initial));const live=useRef(state);live.current=state;
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 const edits=useRef<Record<string,number>>({}),ready=useRef<Record<string,number>>({}),pending=useRef<Promise<boolean>|null>(null),queued=useRef(false),mounted=useRef(true);
 const setLive=(value:State)=>{live.current=value;if(mounted.current)setState(value);};
 const matching=state.range.dateFrom===state.row.dateFrom&&state.range.dateTo===state.row.dateTo;
 const dirty=state.edited.length>0||state.otherChanged||state.number!==(state.row.vehicle.vehicleNumber||'');
 useEffect(()=>{onDirty(initial.vehicle.id,dirty||!matching);},[dirty,matching,onDirty,initial.vehicle.id]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function read(range:VehicleRange){return(await json<VehicleAccountingResponse>(await fetch(`/api/oak-vehicle-accounting?${new URLSearchParams({vehicleId:initial.vehicle.id,dateFrom:range.dateFrom,dateTo:range.dateTo})}`,{cache:'no-store'}))).rows[0];}
 async function persistOnce():Promise<boolean>{
  const snapshot=live.current;
  const edited=snapshot.edited.filter(key=>ready.current[key]===edits.current[key]);
  const otherReady=snapshot.otherChanged&&ready.current.other===edits.current.other,numberReady=snapshot.number!==(snapshot.row.vehicle.vehicleNumber||'')&&ready.current.number===edits.current.number;
  if(!edited.length&&!otherReady&&!numberReady)return true;
  if(edited.some(key=>snapshot.draft[key].value!==''&&parse(snapshot.draft[key].value)==null)||(otherReady&&parse(snapshot.other)==null)){setError('金额需为非负数，最多两位小数');return false;}
  const versions={...edits.current};setSaving(true);setError('');let persisted=false;
  try{
   let base=snapshot.row;
   if(numberReady&&snapshot.number.trim()!==(base.vehicle.vehicleNumber||'')){
    await json(await fetch('/api/oak-vehicles',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...base.vehicle,vehicleNumber:snapshot.number.trim()})}));
    const next=await read(base);
    if(JSON.stringify(base.amounts?.map(item=>[item.id,item.version]))!==JSON.stringify(next.amounts?.map(item=>[item.id,item.version])))throw new Error('费用明细已变化，请核对后重新录入');
    base=next;
   }
   const other=parse(snapshot.other)!;const fallback=draftFor(base);const submitted=(key:VehicleField)=>edited.includes(key)?snapshot.draft[key]:fallback[key];
   await json(await fetch('/api/oak-vehicle-accounting',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vehicleId:base.vehicle.id,dateFrom:base.dateFrom,dateTo:base.dateTo,
    payeeType:submitted('labor').mode==='auto'?base.autoPayeeType:base.payeeType,entries:Object.fromEntries(vehicleFields.map(key=>[key,{mode:submitted(key).mode,amount:submitted(key).mode==='manual'?parse(submitted(key).value):null}])),
    otherExpenses:otherReady?(other>0?[{title:'其他周期费用',amount:other}]:[]):base.review?.otherExpenses||[],note:base.review?.note||'单车核算表自动保存',sourceHash:base.sourceHash,version:base.review?.version||0,changedFields:edited,otherChanged:otherReady})}));
   persisted=true;const next=await read(base);if(!mounted.current)return true;
   const current=live.current;const remaining=current.edited.filter(key=>!edited.includes(key)||edits.current[key]!==versions[key]);const nextDraft=draftFor(next);
   for(const key of remaining)nextDraft[key]=current.draft[key];
   const otherPending=Boolean(current.otherChanged&&(!otherReady||edits.current.other!==versions.other)),numberPending=current.number!==(next.vehicle.vehicleNumber||'')&&(!numberReady||edits.current.number!==versions.number);
   setLive({row:next,range:current.range,draft:nextDraft,edited:remaining,other:otherPending?current.other:String(next.otherAmount),otherChanged:otherPending,number:numberPending?current.number:next.vehicle.vehicleNumber||''});onUpdated(next);return true;
  }catch(e){if(mounted.current)setError(persisted?'已保存，重新读取失败，请核对后再试':(e as Error).message);return false;}
  finally{if(mounted.current)setSaving(false);}
 }
 function drain(fields?:string[]):Promise<boolean>{
  for(const field of fields||[...live.current.edited,...(live.current.otherChanged?['other']:[]),...(live.current.number!==(live.current.row.vehicle.vehicleNumber||'')?['number']:[])])ready.current[field]=edits.current[field];
  if(pending.current){queued.current=true;return pending.current;}
  const run=async()=>{let okay=true;do{queued.current=false;okay=await persistOnce();}while(okay&&queued.current);return okay;};
  const promise=run().finally(()=>{pending.current=null;});pending.current=promise;return promise;
 }
 async function readPeriod():Promise<boolean>{
  const target={...live.current.range};if(target.dateFrom===live.current.row.dateFrom&&target.dateTo===live.current.row.dateTo)return true;
  if(!target.dateFrom||!target.dateTo||target.dateFrom>target.dateTo){setError('起止日期无效');return false;}
  if(!await drain()){setLive({...live.current,range:{dateFrom:live.current.row.dateFrom,dateTo:live.current.row.dateTo}});return false;}
  setSaving(true);setError('');
  try{
   const next=await read(target);
   const body={vehicleId:next.vehicle.id,...target,payeeType:next.payeeType,entries:Object.fromEntries(vehicleFields.map(key=>[key,{mode:(key==='income'||key==='labor')&&!next.amounts?.some(item=>item.category===key)?'auto':'manual',amount:next.lines[key].amount}])),otherExpenses:next.review?.otherExpenses||[],note:next.review?.note||'核算周期自动保存',sourceHash:next.sourceHash,version:next.review?.version||0,changedFields:[],otherChanged:false};
   await json(await fetch('/api/oak-vehicle-accounting',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
   const saved=await read(target);if(mounted.current){setLive(initialState(saved));onUpdated(saved);}return true;
  }catch(e){if(mounted.current)setError((e as Error).message);return false;}finally{if(mounted.current)setSaving(false);}
 }
 async function flush(){if(!await drain())return false;return readPeriod();}
 useEffect(()=>{registerFlush(initial.vehicle.id,flush);return()=>registerFlush(initial.vehicle.id,null);},[initial.vehicle.id,registerFlush]);
 const change=(key:VehicleField,value:string)=>{edits.current[key]=(edits.current[key]||0)+1;const current=live.current;setLive({...current,draft:{...current.draft,[key]:{mode:'manual',value}},edited:[...new Set([...current.edited,key])]});setError('');};
 const amountCell=(key:VehicleField,label:string)=>{
  if(state.row.lines[key].notApplicable)return <td className="oak-inline-not-applicable" title={state.row.lines[key].basis}><span>不适用</span><small>车主车辆</small></td>;
  const line=state.row.lines[key],partial=line.amount==null&&line.knownAmount!=null&&!state.edited.includes(key),pendingFuel=key==='fuel'&&Boolean(line.pendingReason)&&!state.edited.includes(key);
  const records=state.row.amounts?.filter(item=>item.category===key)||[];const aggregate=partial||records.length>1||records.some(item=>item.source==='repair'||item.dateFrom!==state.row.dateFrom||item.dateTo!==state.row.dateTo);
  return <td className={`oak-inline-amount ${key==='income'?'oak-money-income':'oak-money-cost'}${partial||pendingFuel?' oak-inline-partial':''}`}><input aria-label={`${initial.vehicle.id} ${label}`} title={partial?`已入账 ${incomeMoney(line.knownAmount!)}，${line.pendingReason}；点击查看明细`:pendingFuel?`${line.pendingReason}；点击查看明细`:aggregate?`${records.length} 笔周期明细，点击查看`:line.basis} type="text" inputMode="decimal" placeholder={pendingFuel?'里程待补':'待填'} disabled={!matching} readOnly={aggregate} value={partial?text(line.knownAmount!):state.draft[key].value} onClick={()=>{if(aggregate)onOpenAmounts(key,state.row);}} onChange={event=>change(key,event.target.value)} onBlur={()=>void drain([key])}/>{partial?<small title={`${line.pendingReason}${line.missingWorkDates?.length?`：${line.missingWorkDates.join('、')}`:''}`}>已入账 · {line.missingWorkDates?.length?`${line.missingWorkDates.length} 日待补`:'待核对'}</small>:pendingFuel?<small title={line.pendingReason}>整月里程待补</small>:null}{(key==='income'||key==='labor')&&state.draft[key].mode==='manual'&&!aggregate?<button className="oak-inline-reset" title={`恢复${label}系统数据`} onClick={()=>{edits.current[key]=(edits.current[key]||0)+1;const current=live.current;setLive({...current,draft:{...current.draft,[key]:{mode:'auto',value:text(key==='income'?current.row.autoIncome:current.row.autoLabor)}},edited:[...new Set([...current.edited,key])]});void drain([key]);}}><RotateCcw size={12}/></button>:null}</td>;
 };
 const previewLines=Object.fromEntries(vehicleFields.map(key=>[key,{...state.row.lines[key],amount:parse(state.draft[key].value),knownAmount:state.edited.includes(key)?undefined:state.row.lines[key].knownAmount}])) as VehicleAccountingRow['lines'];
 const preview=vehicleTotalsPreview(previewLines,parse(state.other));
 const valid=matching&&vehicleFields.every(key=>state.draft[key].value===''||parse(state.draft[key].value)!=null);
 const cost=valid?preview.knownCost:null,net=valid&&state.number.trim()?preview.provisionalNet:null;
 const provisional=preview.missingCosts.length>0;
 const resultHint=provisional?`暂算 · 待补${preview.pendingCosts}`:net==null?'收入待核对':net<0?'亏损':net>0?'盈利':'持平';
 const resultTitle=Object.values(state.row.lines).filter(line=>line.amount==null).map(line=>line.pendingReason||line.basis).join('；');
 const drag=tableDrag('oak-summary','row',initial.vehicle.id,onMoveRow);
 const dateCell=(field:'dateFrom'|'dateTo')=><td><input aria-label={`${initial.vehicle.id} ${field==='dateFrom'?'开始日期':'结束日期'}`} className="oak-inline-date" type="date" value={state.range[field]} onChange={event=>setLive({...live.current,range:{...live.current.range,[field]:event.target.value}})} onBlur={event=>{if(!(event.relatedTarget as HTMLElement|null)?.classList.contains('oak-inline-date'))void readPeriod();}}/></td>;
 const cells:Record<string,ReactNode>={
  vehicle:<td className="oak-inline-number"><div className="oak-number-with-grip"><button className="oak-drag-handle" title={`拖动 ${state.number||initial.vehicle.driverName} 调整行顺序`} {...drag.drag}><GripVertical size={14}/></button><input aria-label={`${initial.vehicle.id} 车辆号码`} maxLength={30} placeholder="待补车号" value={state.number} onChange={event=>{edits.current.number=(edits.current.number||0)+1;setLive({...live.current,number:event.target.value});}} onBlur={()=>void drain(['number'])}/></div></td>,
  driver:<td className="oak-inline-driver" title={`作业归属：${state.row.subjects.join('、')}`}>{initial.vehicle.driverName}</td>,dateFrom:dateCell('dateFrom'),dateTo:dateCell('dateTo'),
  maintenance:amountCell('maintenance','车辆维修'),labor:amountCell('labor',state.row.payeeType==='owner'?'车主工资':'司机工资'),insurance:amountCell('insurance','车辆保险'),income:amountCell('income','周期收入'),fuel:amountCell('fuel','周期油费'),
  other:<td className="oak-inline-amount oak-money-cost"><input aria-label={`${initial.vehicle.id} 其他费用`} title="其他周期费用" inputMode="decimal" disabled={!matching} readOnly={(state.row.amounts?.filter(item=>item.category==='other').length||0)>1||state.row.amounts?.some(item=>item.category==='other'&&(item.dateFrom!==state.row.dateFrom||item.dateTo!==state.row.dateTo))} onDoubleClick={()=>onOpenAmounts('other',state.row)} value={state.other} onChange={event=>{edits.current.other=(edits.current.other||0)+1;setLive({...live.current,other:event.target.value,otherChanged:true});}} onBlur={()=>void drain(['other'])}/></td>,
  cost:<td className={`oak-inline-total${provisional&&cost!=null?' oak-inline-provisional':''}`} title={resultTitle}><strong>{cost==null?'—':incomeMoney(cost)}</strong>{provisional&&cost!=null?<small>已知支出 · 待补{preview.pendingCosts}</small>:null}</td>,net:<td className={`oak-inline-total ${net==null?'':provisional?'oak-inline-provisional':net<0?'loss':'profit'}`} title={resultTitle}><strong>{net==null?'—':incomeMoney(net)}</strong><small>{!matching?'重新核算中':resultHint}</small></td>,
  actions:<td className="oak-inline-save"><button className={`icon-button${dirty?' primary':''}`} title={`保存 ${state.number||initial.vehicle.driverName} 核算`} disabled={saving} onClick={()=>void flush()}><Save size={16}/></button>{error?<button className="icon-button" title="重新读取本行" onClick={async()=>{if(!window.confirm('重新读取将放弃本行未保存内容，继续？'))return;try{const next=await read(live.current.row);setLive(initialState(next));setError('');onUpdated(next);}catch(e){setError((e as Error).message);}}}><RefreshCw size={14}/></button>:null}<small className={error?'loss':saving?'pending':'muted'} title={error}>{error||(saving?'保存中':dirty?'待保存':state.row.review?'已保存':'')}</small></td>
 };
 return <tr hidden={hidden} className={dirty?'oak-inline-dirty':''} aria-busy={saving} {...drag.drop}>{columnOrder.map(id=><Fragment key={id}>{cells[id]}</Fragment>)}</tr>;
}

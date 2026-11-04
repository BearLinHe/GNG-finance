"use client";

import { forwardRef,useCallback,useEffect,useImperativeHandle,useMemo,useRef,useState } from "react";
import { flexRender,getCoreRowModel,useReactTable,type ColumnDef,type ColumnSizingState } from "@tanstack/react-table";
import { Download,FileText,GripVertical,Plus,Save,Search,Trash2,X } from "lucide-react";
import { incomeMoney,json } from "./oak-income-controls";
import { allocateVehicleAmount,amountCategoryLabels,validateVehicleAmount,type VehicleAmountCategory,type VehicleAmountsResponse,type VehicleAmount } from "@/lib/oak-vehicle-amounts";
import type { VehicleRange } from "@/lib/oak-vehicle-accounting";
import type { OakVehicle } from "@/lib/oak-vehicles";
import {tableDrag,useTableOrder} from "./oak-table-layout";
import OakRepairDetails from './oak-repair-details';
import type {RepairDetails} from '@/lib/oak-repair';
import OakPayrollUpload,{PayrollSourceDetails} from './oak-payroll-upload';
import type {PayrollSource} from '@/lib/oak-payroll';

export type AmountSelection=VehicleRange&{vehicleId:string;payeeType?:"driver"|"owner"};
type Form={key:string;id:string|null;vehicleId:string;dateFrom:string;dateTo:string;amount:string;note:string;payeeType:"driver"|"owner";version:number;requestKey:string;source?:'manual'|'repair';repair?:RepairDetails;payroll?:PayrollSource};
type Meta={forms:Record<string,Form>;vehicles:OakVehicle[];range:VehicleRange|null;category:VehicleAmountCategory;dirty:Record<string,boolean>;busy:Record<string,boolean>;errors:Record<string,string>;
  update:(key:string,field:keyof Form,value:string)=>void;save:(key:string,force?:boolean)=>void;remove:(key:string)=>void;moveRow:(from:string,to:string)=>void;openRepair:(repair:RepairDetails)=>void;openPayroll:(source:PayrollSource)=>void};
const toForm=(record:VehicleAmount):Form=>({key:`entry-${record.requestKey}`,id:record.id,vehicleId:record.vehicleId,dateFrom:record.dateFrom,dateTo:record.dateTo,amount:record.amount.toFixed(2),note:record.note,payeeType:record.payeeType||"driver",version:record.version,requestKey:record.requestKey,source:record.source,repair:record.repair,payroll:record.payroll});
function Field({record,field,meta}:{record:Form;field:"vehicleId"|"dateFrom"|"dateTo"|"amount"|"note"|"payeeType";meta:Meta}){
  const form=meta.forms[record.key]||record;const label=field==='vehicleId'?'车辆':field==='dateFrom'?'开始日期':field==='dateTo'?'结束日期':field==='amount'?'金额':field==='payeeType'?'报酬类型':'备注';
  if(form.source==='repair'){
    const vehicle=meta.vehicles.find(item=>item.id===form.vehicleId);const value=field==='vehicleId'?`${vehicle?.vehicleNumber||form.repair?.unitNumber||'暂无'} · ${vehicle?.driverName||''}`:String(form[field]||'');
    return <input aria-label={`${record.key} ${label}`} title={`维修库只读 · ${value}`} readOnly value={value} onClick={()=>{if(form.repair)meta.openRepair(form.repair);}}/>;
  }
  if(field==='vehicleId')return <select aria-label={`${record.key} ${label}`} value={form.vehicleId} onChange={event=>meta.update(record.key,field,event.target.value)} onBlur={()=>meta.save(record.key)}><option value="">选择车号</option>{meta.vehicles.map(vehicle=><option key={vehicle.id} value={vehicle.id}>{vehicle.vehicleNumber||'暂无'} · {vehicle.driverName}</option>)}</select>;
  if(field==='payeeType')return <select aria-label={`${record.key} ${label}`} value={form.payeeType} onChange={event=>meta.update(record.key,field,event.target.value)} onBlur={()=>meta.save(record.key)}><option value="driver">司机工资</option><option value="owner">车主工资</option></select>;
  return <input aria-label={`${record.key} ${label}`} type={field==='dateFrom'||field==='dateTo'?'date':field==='amount'?'number':'text'} min={field==='amount'?0:undefined} max={field==='amount'?'9999999999.99':undefined} step={field==='amount'?'0.01':undefined} maxLength={field==='note'?1000:undefined} placeholder={field==='amount'?'0.00':field==='note'?'单据 / 说明':''} value={form[field]} onChange={event=>meta.update(record.key,field,event.target.value)} onBlur={event=>{if((field==='dateFrom'||field==='dateTo')&&(event.relatedTarget as HTMLInputElement|null)?.type==='date'&&event.currentTarget.closest('tr')?.contains(event.relatedTarget as Node))return;meta.save(record.key);}}/>;
}
export type VehicleAmountsHandle={flush:()=>Promise<boolean>};
type Props={category:VehicleAmountCategory;selection:AmountSelection|null;onDirtyChange:(dirty:boolean)=>void};
export default forwardRef<VehicleAmountsHandle,Props>(function OakVehicleAmounts({category,selection,onDirtyChange},ref){
  const [data,setData]=useState<VehicleAmountsResponse|null>(null);
  const [forms,setForms]=useState<Record<string,Form>>({});const [dirty,setDirty]=useState<Record<string,boolean>>({});const [newKeys,setNewKeys]=useState<string[]>([]);
  const [busy,setBusy]=useState<Record<string,boolean>>({});const [errors,setErrors]=useState<Record<string,string>>({});
  const [vehicleId,setVehicleId]=useState(selection?.vehicleId||'');const [dateFrom,setDateFrom]=useState(selection?.dateFrom||'');const [dateTo,setDateTo]=useState(selection?.dateTo||'');const [search,setSearch]=useState('');
  const [page,setPage]=useState(1);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  const [repairDetails,setRepairDetails]=useState<RepairDetails|null>(null);
  const [payrollDetails,setPayrollDetails]=useState<PayrollSource|null>(null),[reload,setReload]=useState(0);
  const latest=useRef({forms,dirty});latest.current={forms,dirty};const sequence=useRef(0);
  const revisions=useRef<Record<string,number>>({}),saves=useRef<Partial<Record<string,Promise<boolean>>>>({}),queued=useRef<Record<string,boolean>>({});
  const readyForms=useRef<Record<string,{form:Form;revision:number;force:boolean}>>({});
  const range=dateFrom&&dateTo?{dateFrom,dateTo}:null;
  const load=useCallback(async()=>{
    const id=++sequence.current;setLoading(true);setError('');
    try{
      if((dateFrom&&!dateTo)||(!dateFrom&&dateTo)||dateFrom>dateTo)throw new Error('请填写有效的起止日期');
      const params=new URLSearchParams({category,vehicleId,dateFrom,dateTo,search,page:String(page)});
      const result=await json<VehicleAmountsResponse>(await fetch(`/api/oak-vehicle-amounts?${params}`,{cache:'no-store'}));
      if(id!==sequence.current)return;
      setData(result);setPage(result.page);
      setForms(previous=>{const next={...previous};for(const record of result.records){const form=toForm(record);if(!latest.current.dirty[form.key])next[form.key]=form;}latest.current.forms=next;return next;});
    }catch(e){if(id===sequence.current){setError((e as Error).message);throw e;}}
    finally{if(id===sequence.current)setLoading(false);}
  },[category,vehicleId,dateFrom,dateTo,search,page,reload]);
  const currentLoad=useRef(load);currentLoad.current=load;
  useEffect(()=>{const timer=window.setTimeout(()=>void load().catch(()=>{}),250);return()=>{window.clearTimeout(timer);sequence.current++;};},[load]);
  const dirtyCount=Object.values(dirty).filter(Boolean).length;
  useEffect(()=>{onDirtyChange(Boolean(dirtyCount));if(!dirtyCount)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirtyCount,onDirtyChange]);
  useEffect(()=>()=>onDirtyChange(false),[onDirtyChange]);
  const update=(key:string,field:keyof Form,value:string)=>{const next={...latest.current.forms,[key]:{...latest.current.forms[key],[field]:value}};latest.current.forms=next;setForms(next);latest.current.dirty={...latest.current.dirty,[key]:true};setDirty(latest.current.dirty);revisions.current[key]=(revisions.current[key]||0)+1;setErrors(previous=>({...previous,[key]:''}));};
  async function persistOnce(key:string,force=false):Promise<boolean>{
    const current=latest.current.forms[key],snapshot=readyForms.current[key];if(!current||!latest.current.dirty[key])return true;
    const form={...(snapshot?.form||current),id:current.id,version:current.version};force=snapshot?.force||force;
    if(!force&&!form.id&&(!form.vehicleId||!form.dateFrom||!form.dateTo||form.amount===''))return false;
    try{validateVehicleAmount({...form,category});}catch(e){setErrors(previous=>({...previous,[key]:(e as Error).message}));return false;}
    const revision=snapshot?.revision??revisions.current[key]??0;
    setBusy(previous=>({...previous,[key]:true}));setErrors(previous=>({...previous,[key]:''}));let persisted=false;
    try{
      const result=await json<{id:string;version:number}>(await fetch('/api/oak-vehicle-amounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,category}),keepalive:true}));persisted=true;
      const changed=(revisions.current[key]||0)!==revision;
      latest.current.forms={...latest.current.forms,[key]:{...latest.current.forms[key],id:result.id,version:result.version}};setForms(latest.current.forms);
      latest.current.dirty={...latest.current.dirty,[key]:changed};setDirty(latest.current.dirty);
      await currentLoad.current();return true;
    }catch(e){setErrors(previous=>({...previous,[key]:persisted?'已保存，请重新打开明细确认，勿重复提交':(e as Error).message}));return false;}
    finally{setBusy(previous=>({...previous,[key]:false}));}
  }
  function save(key:string,force=false):Promise<boolean>{
    const form=latest.current.forms[key];if(form)readyForms.current[key]={form:{...form},revision:revisions.current[key]||0,force};
    const active=saves.current[key];if(active){queued.current[key]=true;return active;}
    const run=async()=>{let okay=true;do{queued.current[key]=false;okay=await persistOnce(key,force);}while(okay&&queued.current[key]);return okay;};
    const promise=run().finally(()=>{delete saves.current[key];});saves.current[key]=promise;return promise;
  }
  useImperativeHandle(ref,()=>({flush:async()=>{const keys=Object.keys(latest.current.dirty).filter(key=>latest.current.dirty[key]);const result=await Promise.all(keys.map(key=>save(key,true)));return result.every(Boolean)&&!Object.values(latest.current.dirty).some(Boolean);}}));
  async function remove(key:string){
    const form=latest.current.forms[key];if(!form)return;
    if(!form.id){setNewKeys(previous=>previous.filter(value=>value!==key));setDirty(previous=>({...previous,[key]:false}));return;}
    if(!window.confirm('删除这笔周期明细？主表会重新汇总，历史变更记录会保留。'))return;
    setBusy(previous=>({...previous,[key]:true}));
    try{await json(await fetch('/api/oak-vehicle-amounts',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:form.id,version:form.version})}));latest.current.dirty={...latest.current.dirty,[key]:false};setDirty(latest.current.dirty);setNewKeys(previous=>previous.filter(value=>value!==key));await load();}
    catch(e){setErrors(previous=>({...previous,[key]:(e as Error).message}));}finally{setBusy(previous=>({...previous,[key]:false}));}
  }
  const rowMove=useRef<(from:string,to:string)=>void>(()=>{});
  const meta:Meta={forms,vehicles:data?.vehicles||[],range,category,dirty,busy,errors,update,save:(key,force)=>void save(key,force),remove:key=>void remove(key),moveRow:(from,to)=>rowMove.current(from,to),openRepair:setRepairDetails,openPayroll:setPayrollDetails};
  const scrollRef=useRef<HTMLDivElement>(null);const [containerWidth,setContainerWidth]=useState(1200);
  useEffect(()=>{const node=scrollRef.current;if(!node)return;const observer=new ResizeObserver(()=>{const width=Math.floor(node.getBoundingClientRect().width-2);if(width>0)setContainerWidth(width);});observer.observe(node);return()=>observer.disconnect();},[]);
  const columns=useMemo<ColumnDef<Form>[]>(()=>[
    {id:'vehicle',header:'车辆 / 司机',size:220,cell:context=>{const meta=context.table.options.meta as Meta;const record=context.row.original;const drag=tableDrag(`oak-amount-${meta.category}`,'row',record.key,meta.moveRow);return <div className="oak-number-with-grip"><button className="oak-drag-handle" title={`拖动明细 ${record.key}`} {...drag.drag}><GripVertical size={14}/></button><Field record={record} field="vehicleId" meta={meta}/></div>;}},
    {id:'dateFrom',header:category==='income'?'收入开始日期':'费用开始日期',size:145,cell:context=><Field record={context.row.original} field="dateFrom" meta={context.table.options.meta as Meta}/>},
    {id:'dateTo',header:category==='income'?'收入结束日期':'费用结束日期',size:145,cell:context=><Field record={context.row.original} field="dateTo" meta={context.table.options.meta as Meta}/>},
    ...(category==='labor'?[{id:'payeeType',header:'报酬类型',size:120,cell:(context:any)=><Field record={context.row.original} field="payeeType" meta={context.table.options.meta as Meta}/>}]:[]),
    {id:'amount',header:category==='income'?'本笔收入 / USD':'本笔费用 / USD',size:140,cell:context=><Field record={context.row.original} field="amount" meta={context.table.options.meta as Meta}/>},
    ...(category==='maintenance'?[]:[{id:'allocation',header:'计入核算金额',size:155,cell:(context:any)=>{const meta=context.table.options.meta as Meta;const form=meta.forms[context.row.original.key]||context.row.original;const valid=form.dateFrom&&form.dateTo&&form.dateFrom<=form.dateTo&&form.amount!==''&&Number.isFinite(Number(form.amount));const result=meta.range&&valid?allocateVehicleAmount({...form,amount:Number(form.amount)},meta.range):null;return <div className="oak-allocation-cell"><strong>{result?incomeMoney(result.allocatedAmount):valid?incomeMoney(Number(form.amount)):'—'}</strong><small>{result?`${result.overlapDays} / ${result.totalDays} 天`:'全部日期'}</small></div>;}}]),
    {id:'note',header:'单据 / 备注',size:Math.max(260,containerWidth-(category==='labor'?1025:category==='maintenance'?750:905)),cell:context=>{const record=context.row.original;const meta=context.table.options.meta as Meta;return <div className="oak-payroll-note"><Field record={record} field="note" meta={meta}/>{record.payroll?<button className="icon-button" title={`查看工资原表 ${record.payroll.sheetName}`} onClick={()=>meta.openPayroll(record.payroll!)}><FileText size={15}/></button>:null}</div>;}},
    {id:'actions',header:'保存状态',size:100,cell:context=>{const record=context.row.original,key=record.key;const meta=context.table.options.meta as Meta;if(record.source==='repair'&&record.repair)return <div className="oak-amount-actions"><button className="icon-button" title={`查看维修账单 ${record.repair.invoiceNumber}`} onClick={()=>meta.openRepair(record.repair!)}><FileText size={16}/></button><small className="oak-source-tag">维修库</small></div>;return <div className="oak-amount-actions"><button className="icon-button" title={`保存明细 ${key}`} disabled={meta.busy[key]} onClick={()=>meta.save(key,true)}><Save size={16}/></button><button className="icon-button danger-icon" title={`删除明细 ${key}`} disabled={meta.busy[key]} onMouseDown={event=>event.preventDefault()} onClick={()=>meta.remove(key)}><Trash2 size={15}/></button><small className={meta.errors[key]?'loss':meta.busy[key]||meta.dirty[key]?'pending':'profit'}>{meta.errors[key]||(meta.busy[key]?'保存中':meta.dirty[key]?'待保存':'已保存')}</small></div>;}}
  ],[category,containerWidth]);
  const tableData=useMemo(()=>{const records=(data?.records||[]).map(record=>toForm(record));const keys=new Set(records.map(record=>record.key));const pinned=newKeys.map(key=>forms[key]).filter(form=>form&&(!form.id||dirty[form.key]||keys.has(form.key)));return [...new Map([...pinned,...records].map(form=>[form.key,form])).values()];},[newKeys,forms,data,dirty]);
  const columnLayout=useTableOrder(`oak-amount-${category}-columns`,columns.map(column=>column.id!));
  const rowLayout=useTableOrder(`oak-amount-${category}-rows`,tableData.map(row=>row.key));
  const orderedData=useMemo(()=>rowLayout.order.map(key=>tableData.find(row=>row.key===key)).filter((row):row is Form=>Boolean(row)),[rowLayout.order,tableData]);
  const [columnSizing,setColumnSizing]=useState<ColumnSizingState>({});
  const table=useReactTable({data:orderedData,columns,defaultColumn:{minSize:90,maxSize:850},state:{columnOrder:columnLayout.order,columnSizing},onColumnSizingChange:setColumnSizing,columnResizeMode:'onChange',getCoreRowModel:getCoreRowModel(),getRowId:row=>row.key,meta});
  rowMove.current=rowLayout.move;
  function add(){
    const requestKey=crypto.randomUUID();const key=`entry-${requestKey}`;const form:Form={key,id:null,vehicleId,dateFrom:dateFrom||data?.defaultRange.dateFrom||'',dateTo:dateTo||data?.defaultRange.dateTo||'',amount:'',note:'',payeeType:selection?.payeeType||'driver',version:0,requestKey};
    latest.current.forms={...latest.current.forms,[key]:form};setForms(latest.current.forms);setNewKeys(previous=>[key,...previous]);latest.current.dirty={...latest.current.dirty,[key]:true};setDirty(latest.current.dirty);
  }
  function exportCsv(){
    if(!data)return;const cell=(value:unknown)=>`"${(typeof value==='number'?String(value):String(value??'').replace(/^[\s]*[=+@-]/,"'$&")).replace(/"/g,'""')}"`;
    const lines=[['车号','司机','开始日期','结束日期','本笔金额',...(category==='maintenance'?[]:['计入核算金额']),'备注'],...data.records.map(record=>{const vehicle=data.vehicles.find(item=>item.id===record.vehicleId);return[vehicle?.vehicleNumber,vehicle?.driverName,record.dateFrom,record.dateTo,record.amount,...(category==='maintenance'?[]:[record.allocation?.allocatedAmount??record.amount]),record.note];})];
    const url=URL.createObjectURL(new Blob(['\uFEFF',lines.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`${amountCategoryLabels[category]}-当前页.csv`;anchor.click();URL.revokeObjectURL(url);
  }
  return <section className="oak-vehicle-workspace oak-amount-workspace" aria-label={`${amountCategoryLabels[category]}周期明细`}>
    <div className="oak-inline-toolbar"><div className="oak-ledger-title"><h2>{amountCategoryLabels[category]}</h2><span>{data?.totalCount||0} 笔 <b>USD</b>{dirtyCount?` · ${dirtyCount} 笔未保存`:''}</span></div><div className="oak-accounting-search"><Search size={17}/><input aria-label="搜索费用明细" placeholder="搜索车号、司机、单据或备注" value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}}/>{search?<button className="icon-button" title="清空明细搜索" onClick={()=>setSearch('')}><X size={14}/></button>:null}</div><button className="button ghost" disabled={loading||Boolean(dirtyCount)} onClick={exportCsv}><Download size={15}/>导出</button><button className="button primary" disabled={!data} onClick={add}><Plus size={16}/>新增明细</button>{category==='labor'?<OakPayrollUpload disabled={!data||loading||Boolean(dirtyCount)} onImported={range=>{setVehicleId('');setDateFrom(range.dateFrom);setDateTo(range.dateTo);setSearch('');setPage(1);setReload(value=>value+1);}}/>:null}</div>
    <div className="oak-amount-filters"><label>车辆<select aria-label="明细车辆筛选" value={vehicleId} onChange={event=>{setVehicleId(event.target.value);setPage(1);}}><option value="">全部车辆</option>{data?.vehicles.map(vehicle=><option key={vehicle.id} value={vehicle.id}>{vehicle.vehicleNumber||'暂无'} · {vehicle.driverName}</option>)}</select></label><label>核算区间开始<input aria-label="明细核算开始" type="date" value={dateFrom} onChange={event=>{setDateFrom(event.target.value);setPage(1);}}/></label><label>核算区间结束<input aria-label="明细核算结束" type="date" value={dateTo} onChange={event=>{setDateTo(event.target.value);setPage(1);}}/></label><button className="icon-button" title="清空核算区间" onClick={()=>{setDateFrom('');setDateTo('');setPage(1);}}><X size={15}/></button><div className={`oak-amount-filter-total ${category==='income'?'profit':'oak-cost-color'}`}><span>{loading?'读取中':range?'区间分摊合计':'明细合计'}</span><strong>{loading?'—':data?.totalAmount==null?'待核对':incomeMoney(data.totalAmount)}</strong></div></div>
    {error?<div className="error" role="alert">{error}</div>:null}
    {data?.repairStatus?<div className={`oak-repair-status${data.repairStatus.available?'':' pending'}`} role="status"><span className="oak-source-dot"/>{data.repairStatus.message}{data.repairStatus.available?` · ${data.repairStatus.matchedVehicleIds.length} 辆车号匹配 · 完工日期计入核算`:''}{data.repairStatus.warnings.length?` · ${data.repairStatus.warnings.length} 项待核对`:''}</div>:null}
    {data?.hasRepairOverlap?<div className="error" role="alert">人工维修总额与维修库账单周期重叠，合计及盈亏暂不确认，请核对是否重复。</div>:null}
    <div ref={scrollRef} className="oak-stan-table oak-amount-table-scroll"><table className={`oak-amount-table${category==='labor'?' has-labor':''}`} style={{width:table.getTotalSize(),minWidth:'100%'}} aria-label={`${amountCategoryLabels[category]}明细表`} aria-busy={loading}><colgroup>{table.getVisibleLeafColumns().map(column=><col key={column.id} style={{width:column.getSize()}}/>)}</colgroup><thead>{table.getHeaderGroups().map(group=><tr key={group.id}>{group.headers.map(header=>{const drag=tableDrag(`oak-amount-${category}`,'column',header.id,columnLayout.move);return <th key={header.id} style={{width:header.getSize()}} {...drag.drop} data-column-id={header.id} className={`oak-col-${header.id} ${header.id==='amount'||header.id==='allocation'?category==='income'?'oak-head-income':'oak-head-cost':''}`}><button className="oak-drag-column" title={`拖动调整${String(header.column.columnDef.header)}列顺序`} {...drag.drag}>{flexRender(header.column.columnDef.header,header.getContext())}</button><div className="oak-column-resizer" role="separator" aria-label={`调整${String(header.column.columnDef.header)}列宽`} aria-orientation="vertical" onMouseDown={header.getResizeHandler()} onTouchStart={header.getResizeHandler()}/></th>;})}</tr>)}</thead><tbody>{table.getRowModel().rows.map(row=><tr key={row.id} data-entry-id={row.id} className={dirty[row.id]?'oak-inline-dirty':''} {...tableDrag(`oak-amount-${category}`,'row',row.id,rowLayout.move).drop}>{row.getVisibleCells().map(cell=><td key={cell.id} className={cell.column.id==='amount'||cell.column.id==='allocation'?category==='income'?'oak-money-income':'oak-money-cost':''}>{flexRender(cell.column.columnDef.cell,cell.getContext())}</td>)}</tr>)}{!tableData.length?<tr><td colSpan={columns.length} className="oak-inline-empty">{loading?'读取中...':'暂无周期明细'}</td></tr>:null}</tbody></table></div>
    <div className="pagination"><span>{data?.totalCount||0} 笔 · 每页 100 笔</span><button className="button ghost" disabled={loading||page<=1} onClick={()=>setPage(value=>value-1)}>上一页</button><span>{page} / {Math.max(1,Math.ceil((data?.totalCount||0)/100))}</span><button className="button ghost" disabled={loading||page>=Math.max(1,Math.ceil((data?.totalCount||0)/100))} onClick={()=>setPage(value=>value+1)}>下一页</button></div>
    {repairDetails?<OakRepairDetails repair={repairDetails} onClose={()=>setRepairDetails(null)}/>:null}
    {payrollDetails?<PayrollSourceDetails source={payrollDetails} onClose={()=>setPayrollDetails(null)}/>:null}
  </section>;
});

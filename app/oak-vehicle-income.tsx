"use client";
import {forwardRef,useCallback,useEffect,useImperativeHandle,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {ArrowDown,ArrowRight,ArrowUp,Download,FileText,Link2,Map as MapIcon,Pencil,Search,Settings2,Wallet,X} from 'lucide-react';
import {IncomeDialog,IncomeReviewDialog,OakIncomeRules,incomeMoney,json} from './oak-income-controls';
import OakVehicleAmounts,{type AmountSelection,type VehicleAmountsHandle} from './oak-vehicle-amounts';
import {vehicleIncomeStatuses,vehicleIncomeStatusLabels,type VehicleIncomeDateOrder,type VehicleIncomeRow,type VehicleIncomeResponse} from '@/lib/oak-vehicle-income';
import {locationKey,type DriverLocations} from '@/lib/oak-route-types';
import type {DriverDay} from '@/lib/oak-driver-types';
import OakIncomeUpload from './oak-income-upload';
import OakIncomePagination from './oak-income-pagination';
import PayrollActivityDialog from './oak-payroll-activity-dialog';

const RouteMap=dynamic(()=>import('./oak-driver-route-map'),{ssr:false,loading:()=> <div className="oak-map-loading" role="status">正在准备地图...</div>});
type Props={selection:AmountSelection|null;onDirtyChange:(dirty:boolean)=>void};
export default forwardRef<VehicleAmountsHandle,Props>(function OakVehicleIncome({selection,onDirtyChange},ref){
  const [data,setData]=useState<VehicleIncomeResponse|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [vehicleId,setVehicleId]=useState(selection?.vehicleId||''),[dateFrom,setDateFrom]=useState(selection?.dateFrom||''),[dateTo,setDateTo]=useState(selection?.dateTo||'');
  const [search,setSearch]=useState(''),[status,setStatus]=useState('all'),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(100),[revision,setRevision]=useState(0);
  const [dateOrder,setDateOrder]=useState<VehicleIncomeDateOrder>('asc');
  const [review,setReview]=useState<VehicleIncomeRow|null>(null),[source,setSource]=useState<VehicleIncomeRow|null>(null),[link,setLink]=useState<VehicleIncomeRow|null>(null),[linkVehicle,setLinkVehicle]=useState(''),[linkBusy,setLinkBusy]=useState(false);
  const [manual,setManual]=useState(false),[manualSelection,setManualSelection]=useState<AmountSelection|null>(null),[rules,setRules]=useState(false);const manualRef=useRef<VehicleAmountsHandle>(null);
  const [activity,setActivity]=useState<VehicleIncomeRow|null>(null);
  const [mapData,setMapData]=useState<{name:string;days:DriverDay[];locations:DriverLocations;taskId?:string}|null>(null),[mapDate,setMapDate]=useState(''),[mapBusy,setMapBusy]=useState(false);
  const sequence=useRef(0),scroll=useRef<HTMLDivElement>(null),uploadInput=useRef<HTMLInputElement>(null);
  useImperativeHandle(ref,()=>({flush:async()=>manualRef.current?manualRef.current.flush():true}),[]);
  const load=useCallback(async()=>{
    const id=++sequence.current;setLoading(true);setError('');
    try{
      if(Boolean(dateFrom)!==Boolean(dateTo)||dateFrom>dateTo)throw Error('请填写有效的起止日期');
      const params=new URLSearchParams({vehicleId,dateFrom,dateTo,search,status,dateOrder,page:String(page),pageSize:String(pageSize)});
      const next=await json<VehicleIncomeResponse>(await fetch(`/api/oak-vehicle-income?${params}`,{cache:'no-store'}));
      if(id===sequence.current){setData(next);setPage(next.page);}
    }catch(e){if(id===sequence.current){setError((e as Error).message);setData(null);}}
    finally{if(id===sequence.current)setLoading(false);}
  },[vehicleId,dateFrom,dateTo,search,status,dateOrder,page,pageSize,revision]);
  useEffect(()=>{const timer=setTimeout(()=>void load(),250);return()=>{clearTimeout(timer);sequence.current++;};},[load]);
  useEffect(()=>{scroll.current?.scrollTo({top:0,left:0});},[page,pageSize]);
  async function closeManual(){if(manualRef.current&&!await manualRef.current.flush())return;setManual(false);onDirtyChange(false);setRevision(value=>value+1);}
  function openManual(row?:VehicleIncomeRow){
    const id=row?.vehicleId||vehicleId,scope=row?{dateFrom:row.dateFrom,dateTo:row.dateTo}:dateFrom&&dateTo?{dateFrom,dateTo}:id?data?.range:null;
    setManualSelection(scope?{vehicleId:id||'',...scope}:null);setManual(true);
  }
  async function openMap(row?:VehicleIncomeRow){
    const id=row?.vehicleId||vehicleId,from=row?.dateFrom||dateFrom,to=row?.dateTo||dateTo;
    if(!id||!from||!to||Date.parse(to)-Date.parse(from)>30*86400000){setError('地图请选择一辆车及最多 31 天的周期');return;}
    setMapBusy(true);setError('');
    try{
      const result=await json<VehicleIncomeResponse>(await fetch(`/api/oak-vehicle-income?${new URLSearchParams({vehicleId:id,dateFrom:from,dateTo:to,days:'1'})}`,{cache:'no-store'}));
      const days=result.days||[],codes=[...new Set(days.flatMap(day=>day.tasks.flatMap(task=>[task.fromLocation,task.toLocation])).filter((code):code is string=>Boolean(code)))];
      let locations:DriverLocations={};
      for(let index=0;index<codes.length;index+=300){const part=await json<{locations:DriverLocations}>(await fetch('/api/oak-driver-locations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({codes:codes.slice(index,index+300).map(locationKey)})}));locations={...locations,...part.locations};}
      setMapDate('');setMapData({name:result.vehicles.find(vehicle=>vehicle.id===id)?.driverName||'',days,locations,taskId:row?.task?.id});
    }catch(e){setError((e as Error).message);}finally{setMapBusy(false);}
  }
  async function saveLink(){
    const vehicle=data?.vehicles.find(vehicle=>vehicle.id===linkVehicle);if(!vehicle||!link?.task)return;setLinkBusy(true);
    try{await json(await fetch('/api/oak-vehicles',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...vehicle,aliases:[...new Set([...vehicle.aliases,link.task.driverName])]})}));setLink(null);await load();}
    catch(e){setError((e as Error).message);}finally{setLinkBusy(false);}
  }
  function exportCsv(){
    if(!data)return;const cell=(value:unknown)=>`"${String(value??'').replace(/^[\s]*[=+@-]/,"'$&").replace(/"/g,'""')}"`;
    const rows=[['日期','车号','司机','作业','柜号/参考号','起点','终点','计入收入','状态','依据'],...data.rows.map(row=>[row.dateFrom,row.vehicleNumber,row.driverName,row.label,row.reference,row.fromLocation,row.toLocation,row.amount,vehicleIncomeStatusLabels[row.status],row.basis])];
    const url=URL.createObjectURL(new Blob(['\uFEFF',rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='车辆作业收入-当前页.csv';anchor.click();URL.revokeObjectURL(url);
  }
  return <section className="oak-vehicle-workspace oak-income-workspace" aria-label="车辆作业收入">
    <div className="oak-inline-toolbar"><div className="oak-ledger-title"><h2>车辆收入</h2><span>{data?.totalCount||0} 笔 <b>USD</b></span></div><div className="oak-accounting-search"><Search size={17}/><input aria-label="搜索车辆作业收入" placeholder="车号、司机、柜号或作业" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>{search?<button className="icon-button" title="清空收入搜索" onClick={()=>{setSearch('');setPage(1);}}><X size={14}/></button>:null}</div><button className="icon-button" title="收入计价标准" onClick={()=>setRules(true)}><Settings2 size={17}/></button><button className="icon-button" title="周期收入核定" onClick={()=>openManual()}><Wallet size={17}/></button><button className="icon-button" title="查看周期线路地图" disabled={mapBusy} onClick={()=>void openMap()}><MapIcon size={17}/></button><button className="icon-button" title="导出当前页收入" disabled={loading||!data?.rows.length} onClick={exportCsv}><Download size={17}/></button><OakIncomeUpload inputRef={uploadInput} disabled={loading} onImported={()=>setRevision(value=>value+1)}/></div>
    <div className="oak-amount-filters"><label>车辆<select aria-label="收入车辆筛选" value={vehicleId} onChange={e=>{setVehicleId(e.target.value);setPage(1);}}><option value="">全部车辆</option>{data?.vehicles.map(vehicle=><option key={vehicle.id} value={vehicle.id}>{vehicle.vehicleNumber||'暂无'} · {vehicle.driverName}</option>)}</select></label><label>开始日期<input aria-label="收入核算开始" type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setPage(1);}}/></label><label>结束日期<input aria-label="收入核算结束" type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setPage(1);}}/></label><label>计价状态<select aria-label="收入计价状态" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="all">全部状态</option>{vehicleIncomeStatuses.map(value=><option key={value} value={value}>{vehicleIncomeStatusLabels[value]}</option>)}</select></label><button className="icon-button" title="清空收入日期" onClick={()=>{setDateFrom('');setDateTo('');setPage(1);}}><X size={15}/></button></div>
    <div className="oak-income-strip" aria-label="车辆收入汇总" aria-busy={loading}><div><span>当前范围已确认收入</span><strong className={data?.summary.pendingCount&&data.summary.knownAmount===0?'oak-income-pending':undefined}>{loading?'—':data?.summary.pendingCount&&data.summary.knownAmount===0?'待核算':data?.summary.taskCount||data?.summary.manualCount?incomeMoney(data!.summary.knownAmount):'—'}</strong></div><div><span>待审核项目</span><strong className="oak-income-pending">{data?.summary.pendingCount??'—'}<small>项</small></strong></div><div><span>已含整趟</span><strong>{data?.summary.includedCount??'—'}<small>段</small></strong></div><div><span>周期核定</span><strong>{data?.summary.manualCount??'—'}<small>笔</small></strong></div></div>
    {error?<div className="error" role="alert">{error}</div>:null}
    <div className="oak-income-table-frame">
    <div ref={scroll} className="oak-stan-table oak-income-ledger-scroll" data-loading={loading}><table className="oak-income-ledger-table" aria-label="车辆作业收入明细" aria-busy={loading}><thead><tr><th aria-sort={dateOrder==='asc'?'ascending':'descending'}><button type="button" className="oak-income-date-sort" title={dateOrder==='asc'?'切换为最新优先':'切换为最早优先'} onClick={()=>{setLoading(true);setPage(1);setDateOrder(order=>order==='asc'?'desc':'asc');scroll.current?.scrollTo({top:0});}}>日期{dateOrder==='asc'?<ArrowUp size={13}/>:<ArrowDown size={13}/>}</button></th><th>车辆 / 司机</th><th>作业 / 柜号</th><th>线路</th><th>计入收入 / USD</th><th>计价状态 / 依据</th><th aria-label="审核与地图"/></tr></thead><tbody>{data?.rows.map(row=><tr key={row.id} data-income-id={row.id}><td>{row.dateFrom}{row.dateFrom!==row.dateTo?<small>至 {row.dateTo}</small>:null}</td><td><strong>{row.vehicleNumber||'未关联'}</strong><small>{row.driverName}</small></td><td><strong>{row.label}</strong><small>{row.reference||'—'}</small></td><td><div className="oak-income-route"><span>{row.fromLocation||'—'}</span><ArrowRight size={13}/><span>{row.toLocation||'—'}</span></div><small>{row.task?.miles==null?'':`${row.task.miles.toLocaleString('en-US')} mi · 原表`}</small></td><td className="oak-numeric"><strong className={row.amount==null?'oak-income-pending':'oak-income-amount'}>{row.amount==null?'待核对':incomeMoney(row.amount)}</strong>{row.status==='replaced'?<small>不重复计入</small>:null}</td><td><span className={`oak-income-status ${row.amount==null?'pending':row.status==='included'||row.status==='replaced'?'included':'priced'}`}>{vehicleIncomeStatusLabels[row.status]}</span><small>{row.basis}</small></td><td><div className="oak-income-row-actions">{row.activityGap?<button className="icon-button" title={`核对周表作业 ${row.reference}`} disabled={loading} onClick={()=>setActivity(row)}><Link2 size={15}/></button>:row.task&&row.day?<button className="icon-button" title={`审核作业 ${row.reference||row.id}`} onClick={()=>setReview(row)}><Pencil size={15}/></button>:<button className="icon-button" title="修改周期收入核定" onClick={()=>openManual(row)}><Pencil size={15}/></button>}{row.task?<button className="icon-button" title={`查看作业地图 ${row.reference||row.id}`} disabled={!row.vehicleId||mapBusy} onClick={()=>void openMap(row)}><MapIcon size={15}/></button>:null}{row.status==='unlinked'?<button className="icon-button" title={`关联车辆 ${row.driverName}`} onClick={()=>{setLink(row);setLinkVehicle('');}}><Link2 size={15}/></button>:null}<button className="icon-button" title={`查看收入依据 ${row.id}`} onClick={()=>setSource(row)}><FileText size={15}/></button></div></td></tr>)}{!data?.rows.length?<tr><td colSpan={7} className="oak-inline-empty">{loading?'读取中...':'暂无符合条件的作业收入'}</td></tr>:null}</tbody></table></div>
      <OakIncomePagination page={page} pageSize={pageSize} totalCount={data?.totalCount??null} loading={loading} onPageChange={value=>{setLoading(true);setPage(value);}} onPageSizeChange={value=>{setLoading(true);setPageSize(value);setPage(1);}}/>
    </div>
    {review?.task&&review.day?<IncomeReviewDialog task={review.task} day={review.day} onClose={()=>setReview(null)} onSaved={load}/>:null}
    {activity?<PayrollActivityDialog wageId={activity.id.slice('gap-'.length)} vehicle={activity.vehicleNumber||activity.driverName}
      onClose={()=>setActivity(null)} onSaved={()=>{setActivity(null);setRevision(value=>value+1);}}
      onUpload={()=>{setActivity(null);uploadInput.current?.click();}}/>:null}
    {manual?<IncomeDialog title="周期收入核定" wide busy={false} onClose={()=>void closeManual()}><div className="oak-income-manual-host"><OakVehicleAmounts ref={manualRef} category="income" selection={manualSelection} onDirtyChange={onDirtyChange}/></div></IncomeDialog>:null}
    {rules?<IncomeDialog title="收入计价标准" wide busy={false} onClose={()=>{setRules(false);void load();}}><div className="oak-income-rules-host"><OakIncomeRules embedded onChange={()=>setRevision(value=>value+1)}/></div></IncomeDialog>:null}
    {mapData?<IncomeDialog title={`${mapData.name} · 作业线路`} wide busy={false} onClose={()=>setMapData(null)}><div className="oak-income-map-host"><div className="oak-income-map-date"><label>作业日期<select aria-label="地图作业日期" value={mapDate} onChange={e=>setMapDate(e.target.value)}><option value="">全部日期</option>{mapData.days.map(day=><option key={day.workDate} value={day.workDate}>{day.workDate} · {day.taskCount} 段</option>)}</select></label></div><RouteMap days={mapDate?mapData.days.filter(day=>day.workDate===mapDate):mapData.days} locations={mapData.locations} driverName={mapData.name} initialTaskId={mapData.taskId} allDates={!mapDate&&mapData.days.length>1} onSelectDate={setMapDate}/></div></IncomeDialog>:null}
    {link?<IncomeDialog title="关联作业车辆" busy={linkBusy} onClose={()=>setLink(null)}><div className="oak-income-fields"><strong>源表：{link.task?.driverName}</strong><label className="field">车辆<select aria-label="作业关联车辆" value={linkVehicle} onChange={e=>setLinkVehicle(e.target.value)}><option value="">选择车辆</option>{data?.vehicles.map(vehicle=><option key={vehicle.id} value={vehicle.id}>{vehicle.vehicleNumber||'暂无'} · {vehicle.driverName}</option>)}</select></label></div><footer className="oak-dialog-actions"><button className="button primary" disabled={!linkVehicle||linkBusy} onClick={()=>void saveLink()}>确认关联</button></footer></IncomeDialog>:null}
    {source?<IncomeDialog title="收入原始依据" busy={false} onClose={()=>setSource(null)}><div className="oak-payroll-evidence"><strong>{source.activityGap?source.reference:source.task?.fileName||'人工周期核定'}</strong><span>{source.task?`${source.task.sheetName} · ${source.task.section} · 原表第 ${source.task.sourceRow} 行`:source.dateFrom+' 至 '+source.dateTo}</span><p>{source.basis}</p>{source.task?<div className="table-wrap"><table><thead><tr><th>单元格</th><th>原始内容</th></tr></thead><tbody>{Object.entries(source.task.rawCells).map(([key,value])=><tr key={key}><td>{key}</td><td>{value}</td></tr>)}</tbody></table></div>:null}</div></IncomeDialog>:null}
  </section>;
});

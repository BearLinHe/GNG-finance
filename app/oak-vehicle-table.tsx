"use client";

import { forwardRef,useCallback,useEffect,useImperativeHandle,useMemo,useRef,useState } from "react";
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { ArrowUpDown, Download, MoveHorizontal, Search, X } from "lucide-react";
import { incomeMoney, json } from "./oak-income-controls";
import { vehicleViewLabels, type VehicleAccountingView, type VehicleAccountingResponse, type VehicleAccountingRow, type VehicleField } from "@/lib/oak-vehicle-accounting";
import type { VehicleAmountCategory } from "@/lib/oak-vehicle-amounts";
import VehicleRow from "./oak-vehicle-summary-row";
import {tableDrag,useResponsiveTableSizing,useTableOrder} from "./oak-table-layout";
import {moveTableItem} from "@/lib/oak-table-order";
import {createAsyncReadCache} from "@/lib/async-read-cache";
import {vehicleTotalsPreview} from '@/lib/oak-vehicle-totals';
import {vehicleDriverLabel,vehicleDriverPeriods,type VehicleDriverChange} from '@/lib/oak-vehicle-drivers';
import VehicleDriverHistory from './oak-vehicle-driver-history';

const accountingReads = createAsyncReadCache<VehicleAccountingResponse>({ttlMs:0});
const driverLabel = (row: VehicleAccountingRow) => vehicleDriverLabel(row.vehicle.driverName, row.driverPeriods);

function exportRows(rows: VehicleAccountingRow[], view: VehicleAccountingView) {
  const cell = (value: unknown) => `"${(typeof value === "number" ? String(value) : String(value ?? "").replace(/^[\s]*[=+@-]/, "'$&")).replace(/"/g, '""')}"`;
  const wageView=view==='vehicles'||view==='labor';
  const header = ["车辆号码", "周期司机", "计算起始日期", "计算结束日期", ...(view === "vehicles" ? ["维修费", "司机工资/车主工资（已入账）", "车辆保险", "车辆收入", "周期油费", "其他费用", "周期总花费", "周期盈亏"] : [vehicleViewLabels[view]]),...(wageView?['工资核对状态']:[]),...(view==='vehicles'?['已知支出合计','暂算盈亏','核算状态']:[])];
  const data = rows.map(row => [row.vehicle.vehicleNumber, driverLabel(row), row.dateFrom, row.dateTo, ...(view === "vehicles" ? [row.lines.maintenance.amount, row.lines.labor.amount??row.lines.labor.knownAmount,
    row.lines.insurance.amount, row.lines.income.amount, row.lines.fuel.amount, row.otherAmount, row.totalCost, row.net] : [row.lines[view].amount??(view==='labor'?row.lines.labor.knownAmount:undefined)]),...(wageView?[row.lines.labor.amount==null?row.lines.labor.pendingReason||'待核对':'已核对']:[]),...(view==='vehicles'?[vehicleTotalsPreview(row.lines,row.otherAmount).knownCost,row.net==null?vehicleTotalsPreview(row.lines,row.otherAmount).provisionalNet:null,row.net!=null?'已核对':`待核对${vehicleTotalsPreview(row.lines,row.otherAmount).pendingCosts?`：${vehicleTotalsPreview(row.lines,row.otherAmount).pendingCosts}`:''}`]:[])]);
  const url = URL.createObjectURL(new Blob(["\uFEFF", [header, ...data].map(row => row.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `OAK-${vehicleViewLabels[view]}.csv`; anchor.click(); URL.revokeObjectURL(url);
}

export type VehicleSummaryHandle={flush:()=>Promise<boolean>};
type Props={view:VehicleAccountingView;active:boolean;onOpenAmounts:(category:VehicleAmountCategory,row:VehicleAccountingRow)=>void};
export default forwardRef<VehicleSummaryHandle,Props>(function OakVehicleAccounting({ view, active, onOpenAmounts },ref) {
  const [data, setData] = useState<VehicleAccountingResponse | null>(null);
  const [driverHistoryRow, setDriverHistoryRow] = useState<VehicleAccountingRow | null>(null);
  const currentData=useRef(data);currentData.current=data;
  const [search, setSearch] = useState(""); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  const [dirtyRows, setDirtyRows] = useState<Record<string, boolean>>({});
  const sequence = useRef(0);
  const rowSavers=useRef(new Map<string,()=>Promise<boolean>>());
  const registerFlush=useCallback((id:string,flush:(()=>Promise<boolean>)|null)=>{if(flush)rowSavers.current.set(id,flush);else rowSavers.current.delete(id);},[]);
  useImperativeHandle(ref,()=>({flush:async()=>{const results=await Promise.all([...rowSavers.current.values()].map(flush=>flush()));return results.every(Boolean);}}),[]);
  const dirtyCount = Object.values(dirtyRows).filter(Boolean).length;
  const markDirty = useCallback((id: string, dirty: boolean) => setDirtyRows(previous => previous[id] === dirty ? previous : { ...previous, [id]: dirty }), []);
  const updateRow = (row: VehicleAccountingRow) => setData(previous => previous ? { ...previous, rows: previous.rows.map(value => value.vehicle.id === row.vehicle.id ? row : value) } : previous);
  const updateDriverHistory = (vehicleId: string, changes: VehicleDriverChange[]) => setData(previous => previous ? {
    ...previous, rows: previous.rows.map(row => row.vehicle.id === vehicleId
      ? { ...row, driverPeriods: vehicleDriverPeriods(row.vehicle.driverName, changes, row) } : row)
  } : previous);
  const load = useCallback(async () => {
    const id = ++sequence.current; setLoading(true); setError("");
    try {
      const ranges=currentData.current?Object.fromEntries(currentData.current.rows.map(row=>[row.vehicle.id,{dateFrom:row.dateFrom,dateTo:row.dateTo}])):{};
      const url = `/api/oak-vehicle-accounting?${new URLSearchParams({ranges:JSON.stringify(ranges)})}`;
      const next = await accountingReads.read(url, async () => json<VehicleAccountingResponse>(await fetch(url, { cache: "no-store" })));
      if (id === sequence.current) { setData(next); setGeneration(value => value + 1); setDirtyRows({}); }
    } catch (e) { if (id === sequence.current) setError((e as Error).message); }
    finally { if (id === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (active) void load();
    return () => { sequence.current++; };
  }, [active, load]);
  useEffect(() => {
    if (!dirtyCount) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigation = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest(".nav-module")) return;
      if (!window.confirm("存在未保存的核算行，放弃填写并切换页面？")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", warn); document.addEventListener("click", navigation, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", navigation, true); };
  }, [dirtyCount]);
  const tableScroll = useRef<HTMLDivElement>(null);
  useEffect(() => { tableScroll.current?.scrollTo({ left: 0 }); }, [view]);
  const summary = view === "vehicles";
  const [sorting,setSorting]=useState<SortingState>([]);
  const columns=useMemo<ColumnDef<VehicleAccountingRow>[]>(()=>{
    const rows=data?.rows||[];
    const numberMinimum=(field:VehicleField,minimum:number)=>Math.max(minimum,...rows.map(row=>{const value=row.lines[field].amount??row.lines[field].knownAmount;return value==null?0:Math.ceil(value.toFixed(2).length*8+24);}));
    const resultValue=(row:VehicleAccountingRow,field:'totalCost'|'net')=>row[field]??vehicleTotalsPreview(row.lines,row.otherAmount)[field==='totalCost'?'knownCost':'provisionalNet'];
    const resultMinimum=(field:'totalCost'|'net',minimum:number)=>Math.max(minimum,...rows.map(row=>resultValue(row,field)==null?0:incomeMoney(resultValue(row,field)!).length*8+16));
    const vehicleMinimum=Math.max(84,...rows.map(row=>(row.vehicle.vehicleNumber?.length||0)*8+46));
    return [
    {id:'vehicle',header:'车号',size:Math.max(90,vehicleMinimum),minSize:vehicleMinimum,accessorFn:row=>row.vehicle.vehicleNumber,sortingFn:'alphanumeric'},
    {id:'driver',header:'周期司机',size:140,minSize:98,accessorFn:driverLabel},
    {id:'dateFrom',header:'核算开始',size:140,minSize:110,accessorKey:'dateFrom'}, {id:'dateTo',header:'核算结束',size:140,minSize:110,accessorKey:'dateTo'},
    ...(['maintenance','labor','insurance','income','fuel'] as VehicleField[]).map(key=>{const minSize=numberMinimum(key,key==='labor'?108:key==='income'?92:84);return {id:key,header:key==='labor'?'司机 / 车主工资':vehicleViewLabels[key as Exclude<VehicleAccountingView,'vehicles'>],size:Math.max(key==='labor'?125:110,minSize),minSize,accessorFn:(row:VehicleAccountingRow)=>row.lines[key].amount};}),
    {id:'other',header:'其他费用',size:100,minSize:Math.max(84,...rows.map(row=>row.otherAmount.toFixed(2).length*8+24)),accessorKey:'otherAmount'},{id:'cost',header:'总支出',size:120,minSize:resultMinimum('totalCost',96),accessorFn:row=>resultValue(row,'totalCost')},{id:'net',header:'净盈亏',size:130,minSize:resultMinimum('net',104),accessorFn:row=>resultValue(row,'net')},{id:'actions',header:'保存状态',size:85,minSize:68,enableSorting:false}
  ];},[data?.rows]);
  const columnLayout=useTableOrder('oak-main-columns',columns.map(column=>column.id!));
  const rowLayout=useTableOrder('oak-main-rows',data?.rows.map(row=>row.vehicle.id)||[]);
  const orderedRows=useMemo(()=>rowLayout.order.map(id=>data?.rows.find(row=>row.vehicle.id===id)).filter((row):row is VehicleAccountingRow=>Boolean(row)),[rowLayout.order,data]);
  const sizing=useResponsiveTableSizing(tableScroll,columns.map(column=>({id:column.id!,size:column.size||115,minSize:column.minSize||84,maxSize:column.maxSize||650})),'oak-main-column-sizes');
  const table=useReactTable({data:orderedRows,columns,defaultColumn:{size:115,minSize:68,maxSize:650},state:{sorting,columnOrder:columnLayout.order,columnSizing:sizing.columnSizing},onColumnSizingChange:sizing.onColumnSizingChange,columnResizeMode:'onChange',onSortingChange:setSorting,getCoreRowModel:getCoreRowModel(),getSortedRowModel:getSortedRowModel()});
  const moveRow=(from:string,to:string)=>{rowLayout.update(moveTableItem(table.getRowModel().rows.map(row=>row.original.vehicle.id),from,to));setSorting([]);};
  const matches = (row: VehicleAccountingRow) => `${row.vehicle.vehicleNumber || ""} ${driverLabel(row)}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const visible = data?.rows.filter(matches) || [];
  return <section className="oak-vehicle-workspace oak-inline-workspace" aria-label={vehicleViewLabels[view]}>
    <div className="oak-inline-toolbar"><div className="oak-ledger-title"><h2>{vehicleViewLabels[view]}</h2><span>{data?.rows.length || 26} 辆 <b>USD</b>{dirtyCount ? ` · ${dirtyCount} 行未保存` : ""}</span></div><div className="oak-accounting-search"><Search size={17} /><input aria-label="筛选车号或司机" placeholder="搜索车号、司机姓名" value={search} onChange={event => setSearch(event.target.value)} />{search?<button className="icon-button" title="清空搜索" onClick={()=>setSearch('')}><X size={14}/></button>:null}</div><button className="icon-button" title="自动适应列宽" onClick={()=>sizing.resetSizing()} disabled={!sizing.hasManualSizing}><MoveHorizontal size={17}/></button><button className="button ghost" title={dirtyCount ? "请先保存修改，再导出" : `导出${vehicleViewLabels[view]}`} disabled={loading || Boolean(dirtyCount) || !visible.length} onClick={() => exportRows(visible, view)}><Download size={15} />导出</button></div>
    {error ? <div className="error" role="alert">{error}</div> : null}
    {data?.repairStatus?<div className={`oak-repair-status${data.repairStatus.available?'':' pending'}`} role="status"><span className="oak-source-dot"/>{data.repairStatus.message}{data.repairStatus.available?` · ${data.repairStatus.matchedVehicleIds.length} 辆车号匹配`:''}</div>:null}
    <div ref={tableScroll} className="oak-inline-table-scroll oak-stan-table"><table className="oak-inline-table" style={{width:table.getTotalSize()}} aria-label="单车核算表" aria-busy={loading}><colgroup>{table.getVisibleLeafColumns().map(column=><col key={column.id} style={{width:column.getSize()}}/>)}</colgroup><thead>{table.getHeaderGroups().map(group=><tr key={group.id}>{group.headers.map(header=>{const drag=tableDrag('oak-summary','column',header.id,columnLayout.move);return <th key={header.id} style={{width:header.getSize()}} {...drag.drop} data-column-id={header.id} className={header.column.id==='income'?'oak-head-income':['maintenance','labor','insurance','fuel','other','cost'].includes(header.column.id)?'oak-head-cost':header.column.id==='net'?'oak-head-net':''} aria-sort={header.column.getIsSorted()==='asc'?'ascending':header.column.getIsSorted()==='desc'?'descending':undefined}><button {...drag.drag} title={`拖动调整${String(header.column.columnDef.header)}列顺序`} onClick={header.column.getCanSort()?header.column.getToggleSortingHandler():undefined}>{flexRender(header.column.columnDef.header,header.getContext())}{header.column.getCanSort()?<ArrowUpDown size={12}/>:null}</button><div className="oak-column-resizer" role="separator" aria-label={`调整${String(header.column.columnDef.header)}列宽`} aria-orientation="vertical" title="拖动调整列宽，双击恢复自动" onDoubleClick={()=>sizing.resetSizing(header.column.id)} onMouseDown={header.getResizeHandler()} onTouchStart={header.getResizeHandler()}/></th>;})}</tr>)}</thead><tbody>
      {table.getRowModel().rows.map(item => <VehicleRow key={`${generation}-${item.original.vehicle.id}`} initial={item.original} hidden={!matches(item.original)} columnOrder={columnLayout.order} onDirty={markDirty} onUpdated={updateRow} onOpenAmounts={onOpenAmounts} onOpenDriverHistory={setDriverHistoryRow} onMoveRow={moveRow} registerFlush={registerFlush} />)}
      {!visible.length ? <tr><td colSpan={summary ? 13 : 7} className="oak-inline-empty">{loading ? "读取中..." : "没有匹配的车辆"}</td></tr> : null}
    </tbody></table></div>
    {driverHistoryRow ? <VehicleDriverHistory vehicle={driverHistoryRow.vehicle} onClose={()=>setDriverHistoryRow(null)} onChange={changes=>updateDriverHistory(driverHistoryRow.vehicle.id,changes)} /> : null}
  </section>;
});

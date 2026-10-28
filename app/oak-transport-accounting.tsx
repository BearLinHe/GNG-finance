"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowRight, Banknote, CalendarRange, Check, ChevronRight, FileSpreadsheet, FileText, Layers3, List, Map as MapIcon, Pencil, RefreshCw, Search, Trash2, TriangleAlert, Truck, Upload, UserRound, Wallet, X, XCircle } from "lucide-react";
import { driverSubjectLabel, driverTaskLabel, summarizeDriverPeriods, summarizeDriverTasks, type DriverActivitiesResponse, type DriverDay, type DriverPeriod, type DriverTask, type DriverWorkbookPreview } from "@/lib/oak-driver-types";
import { locationKey, type DriverLocations } from "@/lib/oak-route-types";
import OakLocationLabel from "./oak-location-label";
import { incomeMoney, IncomeReviewDialog, IncomeTotal, OakIncomeRules } from "./oak-income-controls";
import OakTransportJobs from "./oak-transport-jobs";
import OakWeeklySettlements from "./oak-weekly-settlements";
import { payeeIdentity, summarizePayeeTypes, type PayeeType } from "@/lib/oak-payee";

const DriverRouteMap = dynamic(() => import("./oak-driver-route-map"), { ssr: false, loading: () => <div className="oak-map-loading" role="status">正在准备地图...</div> });
const locationCache: DriverLocations = {};

const emptyData: DriverActivitiesResponse = {
  periods: [], dateRange: { from: null, to: null }, totalCount: 0, page: 1, pageSize: 100, drivers: [], imports: [],
  summary: { driverCount: 0, dayCount: 0, taskCount: 0, miles: null }
};
const number = (value: number | null) => value == null ? "-" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const rangeText = (from: string | null, to: string | null) => from && to ? `${from} 至 ${to}` : from ? `${from} 起` : to ? `截至 ${to}` : "暂无作业日期";
const shortDate = (value: string) => value.slice(5).replace("-", "/");
const weekday = (value: string) => new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
type PeriodSelection = { period: DriverPeriod; from: string; to: string; batchPeriod?: { from: string; to: string } };

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "请求失败");
  return body;
}

function TaskCounts({ period }: { period: DriverPeriod }) {
  return <div className="oak-work-counts">{period.taskTypes.map(type => <span className="oak-work-count" key={type.label}><b>{type.label}</b><span>{type.count} 段</span></span>)}</div>;
}
function periodIdentity(period: DriverPeriod) {
  const identity = summarizePayeeTypes(period.days.flatMap(day => day.tasks));
  return identity.conflict ? "身份待核对" : payeeIdentity(period.driverName, period.driverName, identity.type).label;
}

function PeriodsTable({ periods, onSelect, emptyText, busy = false }: {
  periods: DriverPeriod[]; onSelect: (period: DriverPeriod) => void; emptyText: string; busy?: boolean;
}) {
  return <table className="oak-periods-table" aria-label="司机周期作业汇总" aria-busy={busy}>
    <thead><tr><th>司机 / 车主 / 车辆</th><th>期间作业</th><th className="oak-numeric">作业天数</th><th className="oak-numeric">作业路段</th><th className="oak-numeric">里程 / mi</th><th className="oak-numeric">已计价作业收入</th><th aria-label="周期详情" /></tr></thead>
    <tbody>
      {periods.map(period => <tr key={period.driverName}>
        <td className="oak-period-subject"><div className="oak-subject-identity"><span className="oak-subject-icon">{periodIdentity(period) === "司机" ? <UserRound size={17} /> : <Truck size={17} />}</span><div><button className="oak-driver-name" disabled={busy} onClick={() => onSelect(period)}>{period.driverName}</button><span className={`oak-payee-tag${periodIdentity(period) === "车主" ? " owner" : ""}`}>{periodIdentity(period)}</span><span className="oak-subject-dates" title={`实际作业日期：${rangeText(period.dateFrom, period.dateTo)}`}>{shortDate(period.dateFrom)} 至 {shortDate(period.dateTo)}</span></div></div></td>
        <td className="oak-period-work"><TaskCounts period={period} /></td>
        <td className="oak-numeric" data-label="作业天数">{period.dayCount}</td>
        <td className="oak-numeric" data-label="作业路段">{period.taskCount}</td>
        <td className="oak-numeric" data-label="里程 / mi">{number(period.miles)}</td>
        <td className="oak-numeric oak-period-income" data-label="已计价作业收入"><IncomeTotal value={period.revenue} /></td>
        <td className="oak-period-open"><button className="icon-button" title={`查看 ${period.driverName} 周期作业`} onClick={() => onSelect(period)} disabled={busy}><ChevronRight size={16} /></button></td>
      </tr>)}
      {!periods.length ? <tr className="oak-empty-row"><td colSpan={7} className="oak-empty-cell"><FileSpreadsheet size={28} /><span>{emptyText}</span></td></tr> : null}
    </tbody>
  </table>;
}

function DayTasks({ day, outsideBatch, locations, onReview }: { day: DriverDay; outsideBatch: boolean; locations: DriverLocations; onReview: (task: DriverTask, day: DriverDay) => void }) {
  const [sourceIndex, setSourceIndex] = useState<number | null>(null);
  return <tbody className="oak-period-day" data-work-date={day.workDate} aria-label={`${day.workDate} 作业`}>
    <tr className="oak-date-heading-row"><th colSpan={6} scope="rowgroup"><div className="oak-period-day-head"><h3>{day.workDate}<span>{weekday(day.workDate)}</span>{outsideBatch ? <em>批次外</em> : null}</h3><span>{day.taskCount} 段作业 <b>{number(day.miles)} mi</b>{day.revenue ? <span className="oak-day-income">收入 {day.revenue.pricedCount ? incomeMoney(day.revenue.amount) : "—"}{day.revenue.pendingCount ? ` · 待计价 ${day.revenue.pendingCount} 段` : ""}</span> : null}</span></div></th></tr>
      {day.tasks.map((task, index) => <Fragment key={index}>
        <tr className="oak-task-row">
          <td className="oak-task-label">{task.income?.workLabel || driverTaskLabel(task)}</td>
          <td className="oak-task-reference">{task.reference || "-"}</td>
          <td className="oak-task-route-cell"><div className="oak-period-route"><OakLocationLabel code={task.fromLocation} locations={locations} /><ArrowRight size={14} /><OakLocationLabel code={task.toLocation} locations={locations} /></div>{task.notes ? <p className="oak-task-note">{task.notes}</p> : null}</td>
          <td className="oak-numeric oak-task-miles">{number(task.miles)}<small> mi</small></td>
          <td className="oak-task-income"><span className={`oak-income-status ${task.income?.status || "pending"}`}>{task.income?.status === "priced" ? task.income.source === "manual" ? "人工核定" : "按标准计价" : task.income?.status === "included" ? "已并入整趟" : task.income?.status === "conflict" ? "标准冲突" : "待计价"}</span>{task.income?.status === "priced" ? <strong className="oak-income-amount">{incomeMoney(task.income.amount!)}</strong> : null}<small className="oak-income-basis">{task.income?.basis || "导入后核算收入"}</small>{task.income?.review?.note ? <small className="oak-income-review-note">{task.income.review.note}</small> : null}</td>
          <td className="oak-task-source-button"><div className="oak-income-row-actions">{task.id ? <button className="icon-button" title={`核对收入 ${task.reference || task.sheetName + " 第 " + task.sourceRow + " 行"}`} onClick={() => onReview(task, day)}><Pencil size={15} /></button> : null}<button className="icon-button" title={`查看原表 ${task.sheetName} 第 ${task.sourceRow} 行`} aria-expanded={sourceIndex === index} onClick={() => setSourceIndex(value => value === index ? null : index)}><FileText size={15} /></button></div></td>
        </tr>
        {sourceIndex === index ? <tr className="oak-source-row"><td colSpan={6}><div className="oak-source-details"><strong>{task.fileName ? `${task.fileName} · ` : ""}{task.sheetName} · 第 {task.sourceRow} 行</strong><dl>{Object.entries(task.rawCells).map(([cell, value]) => <div key={cell}><dt>{cell}</dt><dd>{value ?? "-"}</dd></div>)}</dl></div></td></tr> : null}
      </Fragment>)}
  </tbody>;
}

function PeriodDetails({ selection, onClose, onIncomeSaved }: { selection: PeriodSelection; onClose: () => void; onIncomeSaved: () => Promise<void> }) {
  const [reviewing, setReviewing] = useState<{ task: DriverTask; day: DriverDay } | null>(null);
  const [activeDate, setActiveDate] = useState("");
  const [view, setView] = useState<"list" | "map">("list");
  const [mapOpened, setMapOpened] = useState(false);
  const [locations, setLocations] = useState<DriverLocations>(locationCache);
  const [locationError, setLocationError] = useState("");
  const [locationAttempt, setLocationAttempt] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const { period, batchPeriod } = selection;
  const days = useMemo(() => activeDate ? period.days.filter(day => day.workDate === activeDate) : period.days, [activeDate, period.days]);
  const visibleTasks = days.reduce((sum, day) => sum + day.taskCount, 0);
  useEffect(() => {
    const codes = [...new Set(period.days.flatMap(day => day.tasks.flatMap(task => [task.fromLocation, task.toLocation])).filter((code): code is string => Boolean(code)).map(locationKey))];
    const missing = codes.filter(code => !locationCache[code]);
    if (!missing.length) { setLocations({ ...locationCache }); return; }
    const controller = new AbortController();
    let disposed = false;
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    setLocationError("");
    void (async () => {
      for (let i = 0; i < missing.length; i += 300) {
        const result = await readJson<{ locations: DriverLocations }>(await fetch("/api/oak-driver-locations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codes: missing.slice(i, i + 300) }), signal: controller.signal }));
        if (!controller.signal.aborted) { Object.assign(locationCache, result.locations); setLocations({ ...locationCache }); }
      }
    })().catch(() => { if (!disposed) setLocationError("城市信息读取失败"); })
      .finally(() => window.clearTimeout(timeout));
    return () => { disposed = true; controller.abort(); window.clearTimeout(timeout); };
  }, [period, locationAttempt]);
  useEffect(() => { scroll.current?.scrollTo({ top: 0, left: 0 }); }, [activeDate]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>(".oak-detail-close")?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || dialog.current?.querySelector("[data-income-dialog]")) return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), select, a[href], input:not(:disabled), [tabindex='0']") || []).filter(element => element.getClientRects().length);
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", trapFocus);
    return () => { document.removeEventListener("keydown", trapFocus); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="oak-task-backdrop" onMouseDown={onClose}>
    <section ref={dialog} className="oak-task-drawer" role="dialog" aria-modal="true" aria-label="周期作业详情" onMouseDown={event => event.stopPropagation()}>
      <header className="oak-detail-header">
        <div className="oak-detail-identity"><span className="oak-subject-icon">{periodIdentity(period) === "司机" ? <UserRound size={22} /> : <Truck size={22} />}</span><div><span className="oak-detail-kicker">{periodIdentity(period)}作业明细</span><h2>{period.driverName}</h2><div className="oak-period-range"><CalendarRange size={14} /><span>统计周期</span><strong>{rangeText(selection.from, selection.to)}</strong></div></div></div>
        <dl className="oak-detail-metrics"><div><dt>作业天数</dt><dd>{period.dayCount}<small>天</small></dd></div><div><dt>作业路段</dt><dd>{period.taskCount}<small>段</small></dd></div><div><dt>记录里程</dt><dd>{number(period.miles)}<small>mi</small></dd></div></dl>
        <button className="icon-button oak-detail-close" title="关闭作业详情" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="oak-detail-layout">
        <aside className="oak-date-rail"><div className="oak-date-rail-title">作业日期<span>{period.dayCount} 天</span></div>
          <nav className="oak-day-nav" aria-label="作业日期"><button aria-pressed={!activeDate} className={!activeDate ? "active" : ""} onClick={() => setActiveDate("")}><span className="oak-date-name">{view === "map" ? "全部日期总览" : "全部日期"}</span><span className="oak-date-meta">{period.dayCount} 天 · {period.taskCount} 段作业</span></button>{period.days.map(day => <button key={day.workDate} aria-pressed={activeDate === day.workDate} className={activeDate === day.workDate ? "active" : ""} onClick={() => setActiveDate(day.workDate)}><span className="oak-date-name">{shortDate(day.workDate)}<small>{weekday(day.workDate)}</small></span><span className="oak-date-meta">{day.taskCount} 段作业 · {number(day.miles)} mi</span>{batchPeriod && (day.workDate < batchPeriod.from || day.workDate > batchPeriod.to) ? <em>批次外</em> : null}</button>)}</nav>
          <div className="oak-mobile-date"><label htmlFor="oak-detail-date">作业日期</label><select id="oak-detail-date" value={activeDate} onChange={event => setActiveDate(event.target.value)}><option value="">{view === "map" ? "全部日期总览" : "全部日期"} · {period.dayCount} 天 / {period.taskCount} 段</option>{period.days.map(day => <option key={day.workDate} value={day.workDate}>{day.workDate} · {day.taskCount} 段作业</option>)}</select></div>
        </aside>
        <div className="oak-detail-work"><div className="oak-detail-work-head"><div className="oak-detail-views" role="group" aria-label="作业视图"><button aria-pressed={view === "list"} className={view === "list" ? "active" : ""} onClick={() => setView("list")}><List size={15} />作业明细</button><button aria-pressed={view === "map"} className={view === "map" ? "active" : ""} onClick={() => { if (!mapOpened && !activeDate) setActiveDate(period.days[0]?.workDate || ""); setView("map"); setMapOpened(true); }}><MapIcon size={15} />路线地图</button></div><span>{days.length} 个作业日 · {visibleTasks} 段作业</span></div>
          {locationError ? <div className="oak-location-error" role="status">{locationError}<button className="icon-button" title="重新读取城市信息" onClick={() => setLocationAttempt(value => value + 1)}><RefreshCw size={14} /></button></div> : null}
          {mapOpened ? <div className="oak-map-host" hidden={view !== "map"}><DriverRouteMap days={days} locations={locations} driverName={period.driverName} allDates={!activeDate} onSelectDate={setActiveDate} /></div> : null}
          <div ref={scroll} className="oak-period-days" hidden={view !== "list"}><table className="oak-period-task-table oak-income-task-table" aria-label="周期作业明细表"><thead><tr><th>作业</th><th>柜号 / 参考号</th><th>路线</th><th className="oak-numeric">里程 / mi</th><th>作业收入 / USD</th><th aria-label="核对及原表" /></tr></thead>{days.map(day => <DayTasks key={day.workDate} day={day} locations={locations} onReview={(task, day) => setReviewing({ task, day })} outsideBatch={Boolean(batchPeriod && (day.workDate < batchPeriod.from || day.workDate > batchPeriod.to))} />)}</table></div>
        </div>
      </div>
      <footer className="oak-period-detail-footer"><span>{activeDate ? `${activeDate} · ${visibleTasks} 段作业` : `显示全部 ${period.dayCount} 个作业日`}</span><span>周期已计价收入 <strong>{period.revenue?.pricedCount ? incomeMoney(period.revenue.amount) : "—"}</strong>{period.revenue?.pendingCount ? ` · 待计价 ${period.revenue.pendingCount} 段` : ""}</span></footer>
      {reviewing ? <IncomeReviewDialog task={reviewing.task} day={reviewing.day} onClose={() => setReviewing(null)} onSaved={onIncomeSaved} /> : null}
    </section>
  </div>;
}

export default function OakTransportAccounting() {
  const [workspaceView, setWorkspaceView] = useState<"activities" | "rules" | "jobs" | "settlements">("activities");
  const [data, setData] = useState(emptyData);
  const [driverName, setDriverName] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [importId, setImportId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<DriverWorkbookPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewTab, setPreviewTab] = useState<"sheets" | "periods">("sheets");
  const [mappings, setMappings] = useState<Record<string, { selected: boolean; driverName: string; payeeType: PayeeType | null }>>({});
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodSelection | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadFile = useRef<File | null>(null);
  const requestSequence = useRef(0);
  const ledgerScroll = useRef<HTMLDivElement>(null);
  const initialBatchChosen = useRef(false);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true); setError("");
    try {
      if (dateFrom && dateTo && dateFrom > dateTo) throw new Error("开始日期不能晚于结束日期");
      const params = new URLSearchParams({ driverName, dateFrom, dateTo, search, importId, page: String(page), pageSize: String(pageSize) });
      const next = await readJson<DriverActivitiesResponse>(await fetch(`/api/oak-driver-activities?${params}`, { cache: "no-store" }));
      if (sequence === requestSequence.current) {
        setData(next);
        setSelectedPeriod(current => {
          const updated = current && next.periods.find(period => period.driverName === current.period.driverName);
          return current && updated ? { ...current, period: updated } : current;
        });
        if (!initialBatchChosen.current) {
          initialBatchChosen.current = true;
          const latest = next.imports[0];
          if (latest && !importId && !dateFrom && !dateTo && !driverName && !search) {
            setImportId(String(latest.id)); setDateFrom(latest.dateFrom); setDateTo(latest.dateTo); setPage(1);
          }
        }
        return true;
      }
    } catch (err) {
      if (sequence === requestSequence.current) {
        setError(err instanceof Error ? err.message : "读取作业失败");
        setData(value => ({ ...emptyData, drivers: value.drivers, imports: value.imports }));
      }
    } finally { if (sequence === requestSequence.current) setLoading(false); }
    return false;
  }, [driverName, dateFrom, dateTo, search, importId, page, pageSize]);

  useEffect(() => {
    setLoading(true); setSelectedPeriod(null);
    const timeout = window.setTimeout(() => void load(), 250);
    return () => { window.clearTimeout(timeout); requestSequence.current += 1; };
  }, [load, reload]);

  useEffect(() => { ledgerScroll.current?.scrollTo({ top: 0, left: 0 }); }, [data.periods]);

  useEffect(() => {
    if (!preview && !selectedPeriod) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || saving) return;
      if (selectedPeriod) setSelectedPeriod(null); else setPreview(null);
    };
    window.addEventListener("keydown", escape);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", escape); };
  }, [preview, selectedPeriod, saving]);

  const selectedTasks = useMemo(() => (preview?.tasks || [])
    .filter(task => mappings[task.sheetName]?.selected)
    .map(task => ({ ...task, driverName: mappings[task.sheetName].driverName.trim(), payeeType: mappings[task.sheetName].payeeType })), [preview, mappings]);
  const previewDays = useMemo(() => summarizeDriverTasks(selectedTasks), [selectedTasks]);
  const previewPeriods = useMemo(() => summarizeDriverPeriods(previewDays), [previewDays]);
  const selectedBatch = data.imports.find(item => String(item.id) === importId);
  const scopeFrom = dateFrom || data.dateRange.from;
  const scopeTo = dateTo || data.dateRange.to;
  const totalPages = Math.max(1, Math.ceil(data.totalCount / pageSize));

  function selectBatch(value: string) {
    setImportId(value); setPage(1);
    const batch = data.imports.find(item => String(item.id) === value);
    if (batch) { setDateFrom(batch.dateFrom); setDateTo(batch.dateTo); }
  }

  async function previewFile(file: File) {
    setUploading(true); setError(""); setMessage("");
    try {
      if (!/\.xlsx$/i.test(file.name)) throw new Error("请选择 .xlsx 格式的 Excel 文件");
      if (file.size > 4 * 1024 * 1024) throw new Error("文件超过 4 MB，请拆分后上传");
      const form = new FormData(); form.append("file", file);
      const body = await readJson<{ preview: DriverWorkbookPreview }>(await fetch("/api/oak-driver-imports", { method: "POST", body: form }));
      uploadFile.current = file;
      setMappings(Object.fromEntries(body.preview.sheets.map(sheet => [sheet.sheetName, { selected: sheet.selected, driverName: sheet.driverName, payeeType: sheet.payeeType || payeeIdentity(sheet.sheetName).type }])));
      setPreviewError(""); setPreviewTab("sheets"); setSelectedPeriod(null); setPreview(body.preview);
    } catch (err) { setError(err instanceof Error ? err.message : "读取 Excel 失败"); }
    finally { setUploading(false); }
  }

  async function confirmImport() {
    if (!preview || !uploadFile.current) return;
    setSaving(true); setPreviewError("");
    try {
      const form = new FormData(); form.append("file", uploadFile.current); form.append("action", "import");
      form.append("mappings", JSON.stringify(preview.sheets.filter(sheet => mappings[sheet.sheetName]?.selected)
        .map(sheet => ({ sheetName: sheet.sheetName, driverName: mappings[sheet.sheetName].driverName, payeeType: mappings[sheet.sheetName].payeeType }))));
      const result = await readJson<{ importId: number; duplicate: boolean }>(await fetch("/api/oak-driver-imports", { method: "POST", body: form }));
      const savedBatch = data.imports.find(item => item.id === result.importId);
      const range = savedBatch ? { from: savedBatch.dateFrom, to: savedBatch.dateTo } : preview.batchPeriod;
      setPreview(null); uploadFile.current = null;
      setImportId(String(result.importId)); setDriverName(""); setDateFrom(range.from); setDateTo(range.to); setSearch(""); setPage(1); setReload(value => value + 1);
      setMessage(result.duplicate ? "该文件已导入，已定位到原批次，未重复计数" : "导入完成");
    } catch (err) { setPreviewError(err instanceof Error ? err.message : "导入失败"); }
    finally { setSaving(false); }
  }

  async function removeImport() {
    if (!selectedBatch || !window.confirm(`删除“${selectedBatch.fileName}”及该批次的全部作业？`)) return;
    try {
      await readJson(await fetch(`/api/oak-driver-imports/${selectedBatch.id}`, { method: "DELETE" }));
      setImportId(""); setPage(1); setReload(value => value + 1); setMessage("导入批次已删除");
    } catch (err) { setError(err instanceof Error ? err.message : "删除失败"); }
  }

  return (
    <section className="oak-driver-workspace" aria-label="OAK 运输部司机周期作业">
      <div className="oak-income-tabs" role="tablist" aria-label="运输部核算视图"><button role="tab" aria-selected={workspaceView === "activities"} className={workspaceView === "activities" ? "active" : ""} onClick={() => setWorkspaceView("activities")}><List size={16} />作业收入</button><button role="tab" aria-selected={workspaceView === "jobs"} className={workspaceView === "jobs" ? "active" : ""} onClick={() => { setSelectedPeriod(null); setWorkspaceView("jobs"); }}><Layers3 size={16} />运输任务</button><button role="tab" aria-selected={workspaceView === "settlements"} className={workspaceView === "settlements" ? "active" : ""} onClick={() => { setSelectedPeriod(null); setWorkspaceView("settlements"); }}><Wallet size={16} />周结算</button><button role="tab" aria-selected={workspaceView === "rules"} className={workspaceView === "rules" ? "active" : ""} onClick={() => { setSelectedPeriod(null); setWorkspaceView("rules"); }}><Banknote size={16} />收入计价标准</button></div>
      {workspaceView === "rules" ? <OakIncomeRules onChange={() => setReload(value => value + 1)} /> : null}
      {workspaceView === "settlements" ? <OakWeeklySettlements initialDate={dateFrom || selectedBatch?.dateFrom || ""} drivers={data.drivers} subjects={data.subjects} /> : null}
      <div className="oak-income-activities" hidden={workspaceView !== "activities" && workspaceView !== "jobs"}>
      <div className="oak-driver-actions">
        <div><h2>{workspaceView === "jobs" ? "运输任务归集" : "司机 / 车主周期作业"}</h2>{selectedBatch ? <span className="muted">{selectedBatch.fileName}</span> : null}</div>
        <div className="oak-command-buttons">
          <button className="icon-button" title="刷新作业" onClick={() => setReload(value => value + 1)} disabled={loading}><RefreshCw size={16} /></button>
          {selectedBatch ? <button className="icon-button danger-icon" title="删除当前导入批次" onClick={() => void removeImport()}><Trash2 size={16} /></button> : null}
          <button className="button primary" onClick={() => fileInput.current?.click()} disabled={uploading}><Upload size={16} />{uploading ? "正在识别..." : "上传 Excel"}</button>
          <input ref={fileInput} type="file" accept=".xlsx" aria-label="上传作业 Excel" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void previewFile(file); event.target.value = ""; }} />
        </div>
      </div>
      <div className="oak-driver-filters">
        <div className="field"><label htmlFor="oak-driver">司机 / 车主 / 车辆</label><select id="oak-driver" value={driverName} onChange={e => { setDriverName(e.target.value); setPage(1); }}><option value="">全部司机 / 车主 / 车辆</option>{data.drivers.map(name => { const identity = data.subjects?.find(subject => subject.name === name); return <option key={name} value={name}>{name}（{identity?.conflict ? "身份待核对" : payeeIdentity(name, name, identity?.payeeType).label}）</option>; })}</select></div>
        <div className="field"><label htmlFor="oak-from">开始日期</label><input id="oak-from" type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} /></div>
        <div className="field"><label htmlFor="oak-to">结束日期</label><input id="oak-to" type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} /></div>
        <div className="field"><label htmlFor="oak-import">导入批次</label><select id="oak-import" value={importId} onChange={e => selectBatch(e.target.value)}><option value="">全部批次</option>{data.imports.map(item => <option key={item.id} value={item.id}>{item.dateFrom.slice(0, 4)} · {shortDate(item.dateFrom)} - {shortDate(item.dateTo)} · {item.fileName}</option>)}</select></div>
        <div className="field oak-driver-search"><label htmlFor="oak-search">柜号 / 路线 / 作业</label><div className="input-with-icon"><Search size={15} /><input id="oak-search" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="柜号、地点或作业名称" /></div></div>
        <button className="icon-button" title="清空筛选" onClick={() => { setDriverName(""); setDateFrom(""); setDateTo(""); setSearch(""); setImportId(""); setPage(1); }}><XCircle size={17} /></button>
      </div>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <div className="oak-success" role="status"><Check size={16} />{message}</div> : null}
      {selectedBatch?.hasOutOfPeriodRecords ? <div className="oak-batch-notice"><TriangleAlert size={15} /><span>文件含批次外日期的作业，原始日期已保留。</span><button onClick={() => { const normal = dateFrom === selectedBatch.dateFrom && dateTo === selectedBatch.dateTo; setDateFrom(normal ? selectedBatch.recordDateFrom : selectedBatch.dateFrom); setDateTo(normal ? selectedBatch.recordDateTo : selectedBatch.dateTo); setPage(1); }}>{dateFrom === selectedBatch.dateFrom && dateTo === selectedBatch.dateTo ? "查看全部日期" : "恢复批次周期"}</button></div> : null}
      <div className="oak-income-strip" aria-label="作业收入汇总" aria-busy={loading}><div><span>已计价作业收入 / USD</span><strong>{data.summary.revenue?.pricedCount ? incomeMoney(data.summary.revenue.amount) : "—"}</strong></div><div><span>已计价作业</span><strong>{data.summary.revenue?.pricedCount || 0}<small>段</small></strong></div><div><span>待计价作业</span><strong className="oak-income-pending">{data.summary.revenue?.pendingCount ?? data.summary.taskCount}<small>段</small></strong></div><div><span>已并入整趟</span><strong>{data.summary.revenue?.includedCount || 0}<small>段</small></strong></div></div>
      <div className="oak-driver-ledger">
        <div className="oak-ledger-head"><div><h3>司机周期汇总</h3><div className="oak-period-range"><CalendarRange size={14} /><strong>{rangeText(scopeFrom, scopeTo)}</strong>{search.trim() ? <span>匹配：{search.trim()}</span> : null}{loading ? <span className="oak-load-status" role="status">读取中</span> : null}</div></div><dl className="oak-overview-metrics" aria-label="周期汇总"><div><dt>司机 / 车辆</dt><dd>{number(data.summary.driverCount)}<small>个</small></dd></div><div><dt>作业日期</dt><dd>{number(data.summary.dayCount)}<small>天</small></dd></div><div><dt>作业路段</dt><dd>{number(data.summary.taskCount)}<small>段</small></dd></div><div><dt>记录里程</dt><dd>{number(data.summary.miles)}<small>mi</small></dd></div></dl></div>
        {workspaceView === "jobs" ? <OakTransportJobs tasks={data.periods.flatMap(period => period.days.flatMap(day => day.tasks))} busy={loading} onSaved={async () => { if (!await load()) throw new Error("已保存归集，请刷新作业核对最新结果"); }} /> : <div ref={ledgerScroll} className="table-wrap oak-driver-scroll"><PeriodsTable periods={data.periods} onSelect={period => setSelectedPeriod({ period, from: scopeFrom || period.dateFrom, to: scopeTo || period.dateTo, batchPeriod: selectedBatch ? { from: selectedBatch.dateFrom, to: selectedBatch.dateTo } : undefined })} busy={loading} emptyText={loading ? "正在读取作业..." : data.imports.length ? "没有符合筛选条件的作业" : "暂无作业记录"} /></div>}
        <div className="pagination">
          <span className="pagination-info">共 {data.totalCount} 个</span>
          <select className="page-size" aria-label="作业每页条数" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}><option value={50}>50 / 页</option><option value={100}>100 / 页</option><option value={300}>300 / 页</option></select>
          <button className="button ghost" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><span className="page-current">{page} / {totalPages}</span><button className="button ghost" disabled={loading || page >= totalPages} onClick={() => setPage(value => value + 1)}>下一页</button>
        </div>
      </div>
      </div>

      {preview ? <div className="oak-modal-backdrop" onMouseDown={() => !saving && setPreview(null)}>
        <section className="oak-import-dialog" role="dialog" aria-modal="true" aria-label="确认 Excel 导入" onMouseDown={event => event.stopPropagation()}>
          <div className="oak-dialog-head"><div><h2>确认 Excel 导入</h2><span>{preview.fileName}</span></div><button className="icon-button" title="关闭导入预览" onClick={() => setPreview(null)} disabled={saving}><X size={18} /></button></div>
          <div className="oak-import-period"><CalendarRange size={15} /><span>批次周期</span><strong>{rangeText(preview.batchPeriod.from, preview.batchPeriod.to)}</strong></div>
          <div className="oak-import-meta"><span>已选 {previewPeriods.length} 个司机 / 车主 / 车辆</span><span>{selectedTasks.length} 段作业</span><span>{previewDays.length} 条每日记录</span></div>
          {previewError ? <div className="error" role="alert">{previewError}</div> : null}
          {preview.warnings.length ? <div className="oak-import-warnings">{preview.warnings.map(item => <p key={item}>{item}</p>)}</div> : null}
          <div className="oak-preview-tabs" role="tablist" aria-label="导入预览视图">
            <button role="tab" aria-selected={previewTab === "sheets"} className={previewTab === "sheets" ? "active" : ""} onClick={() => setPreviewTab("sheets")}>作业归属</button>
            <button role="tab" aria-selected={previewTab === "periods"} className={previewTab === "periods" ? "active" : ""} onClick={() => setPreviewTab("periods")}>作业预览</button>
          </div>
          <div className="oak-import-scroll table-wrap">
            {previewTab === "sheets" ? <table className="oak-import-table"><thead><tr><th>导入</th><th>工作表</th><th>归属姓名 / 身份</th><th>日期范围</th><th>路段</th><th>核对信息</th></tr></thead>
              <tbody>{preview.sheets.map(sheet => <tr key={sheet.sheetName}>
                <td><input type="checkbox" aria-label={`导入 ${sheet.sheetName}`} disabled={!sheet.taskCount} checked={mappings[sheet.sheetName]?.selected || false} onChange={e => setMappings(value => ({ ...value, [sheet.sheetName]: { ...value[sheet.sheetName], selected: e.target.checked } }))} /></td>
                <td><strong>{sheet.sheetName}</strong>{driverSubjectLabel(mappings[sheet.sheetName]?.driverName || sheet.driverName) === "车辆编号" ? <small className="oak-subject-kind">车辆编号</small> : null}</td>
                <td><input aria-label={`${sheet.sheetName} 的司机或车辆编号`} maxLength={120} value={mappings[sheet.sheetName]?.driverName || ""} disabled={!sheet.taskCount} onChange={e => setMappings(value => ({ ...value, [sheet.sheetName]: { ...value[sheet.sheetName], driverName: e.target.value } }))} /><select className="oak-import-payee-type" aria-label={`${sheet.sheetName} 的结算身份`} disabled={!sheet.taskCount} value={mappings[sheet.sheetName]?.payeeType || ""} onChange={e => setMappings(value => ({ ...value, [sheet.sheetName]: { ...value[sheet.sheetName], payeeType: e.target.value === "owner" || e.target.value === "driver" ? e.target.value : payeeIdentity(value[sheet.sheetName].driverName, sheet.sheetName).type } }))}><option value="">按姓名识别 / 车辆待指定</option><option value="driver">司机 · 司机工资</option><option value="owner">车主 · 车主价格</option></select></td>
                <td>{sheet.dateFrom ? `${sheet.dateFrom} 至 ${sheet.dateTo}` : "无作业日期"}</td><td>{sheet.taskCount}</td><td className="oak-import-note">{sheet.warnings.join("；") || (sheet.taskCount ? "-" : "没有作业记录")}</td>
              </tr>)}</tbody></table> : <PeriodsTable periods={previewPeriods} onSelect={period => setSelectedPeriod({ period, from: preview.batchPeriod.from, to: preview.batchPeriod.to, batchPeriod: preview.batchPeriod })} emptyText="请先选择作业工作表" />}
          </div>
          {preview.skippedSheets.length ? <div className="oak-skipped-sheets">已跳过：{preview.skippedSheets.map(sheet => `${sheet.sheetName}（${sheet.reason}）`).join("；")}</div> : null}
          <div className="oak-dialog-actions"><button className="button ghost" onClick={() => setPreview(null)} disabled={saving}>取消</button><button className="button primary" onClick={() => void confirmImport()} disabled={saving || !selectedTasks.length || selectedTasks.some(task => !task.driverName)}><Upload size={16} />{saving ? "正在导入..." : `确认导入 ${selectedTasks.length} 段作业`}</button></div>
        </section>
      </div> : null}

      {selectedPeriod ? <PeriodDetails key={`${selectedPeriod.period.driverName}:${selectedPeriod.from}:${selectedPeriod.to}`} selection={selectedPeriod} onClose={() => setSelectedPeriod(null)} onIncomeSaved={async () => { if (!await load()) throw new Error("已保存，但读取最新收入失败，请刷新后核对"); }} /> : null}
    </section>
  );
}

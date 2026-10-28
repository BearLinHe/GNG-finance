"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download, FileText, RefreshCw, Search, Settings2, TriangleAlert, Truck, X } from "lucide-react";
import type { SavAccountingResult, SavContainerResult, SavCostLine, SavGoodsStatus, SavPricingRule, SavTripResult } from "@/lib/sav-accounting-types";
import "./sav-accounting.css";

type TripOverride = { miles?: number | null; stopCount?: number | null; explicitAmount?: number | null; note: string };
type IncomeOverride = { amount: number; note: string };
type GoodsOverride = { status: SavGoodsStatus; method?: string; note: string };
type ReconciliationRow = { containerNumber: string; actualIncome: number | null; actualExpense: number | null; expectedIncome: number | null; expectedExpense: number | null; incomeDifference: number | null; expenseDifference: number | null; status: "matched" | "different" | "pending" | "source_only" | "baseline_only" };
type ResponseData = SavAccountingResult & {
  source: { snapshotAt: string | null; notes: string[] };
  pagination: { page: number; pageSize: number; totalCount: number; totalPages: number };
  operationModes: Array<{ operationMode: string; count: number }>;
  settings: { pricing: SavPricingRule; tripOverrides: Record<string, TripOverride>; incomeOverrides: Record<string, IncomeOverride>; goodsOverrides?: Record<string, GoodsOverride>; baseline?: { containers: unknown[]; sourceName: string; importedAt: string; transport?: { sourceName: string; goodsCount: number; knownExpense: number } } };
  reconciliation?: { rows: ReconciliationRow[]; summary: { matched: number; different: number; pending: number; sourceOnly: number; baselineOnly: number } };
};
type View = "containers" | "trips" | "stock" | "rules" | "reconciliation";
type Scope = "all" | "excel";
type Filters = { dateFrom: string; dateTo: string; search: string; customer: string; scope: Scope; operationMode: string };
const defaultFilters: Filters = { dateFrom: "", dateTo: "", search: "", customer: "", scope: "all", operationMode: "all" };
const baselineFilters: Filters = { ...defaultFilters, dateFrom: "2026-09-07", dateTo: "2026-10-25", scope: "excel" };
const money = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantity = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const statusText = (status: string) => ({ transport: "已归入运输", in_stock: "在库", returned: "退运", pending: "状态待核对" }[status] || status);
const operationText = (value: string | null | undefined) => ({ unload: "拆柜", direct_delivery: "直送", pickup: "提柜", storage: "仓储", __none__: "未分类" }[value || "__none__"] || value || "未分类");
const orderStatusText = (value: string | null | undefined) => ({ pending: "待处理", completed: "已完成", archived: "已归档", cancelled: "已取消", canceled: "已取消", processing: "处理中", in_progress: "进行中", draft: "草稿" }[value || ""] || value || "状态未填");
const incomeCategoryText: Record<string, string> = { delivery: "派送收入", labor: "出库收入", other: "其他账单收入", excluded: "未纳入本次核算", unclassified: "待确认归类" };

async function json<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "读取失败，请重试");
  return body as T;
}

function Modal({ title, subtitle, children, onClose, wide = false, busy = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean; busy?: boolean }) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>(".sav-dialog-close")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]") || []).filter(element => element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); if (previous?.isConnected) previous.focus(); };
  }, [busy, onClose]);
  return <div className="sav-modal-backdrop" onMouseDown={() => !busy && onClose()}><section className={`sav-dialog${wide ? " sav-dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={dialog} onMouseDown={event => event.stopPropagation()}><header className="sav-dialog-head"><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button className="icon-button sav-dialog-close" onClick={onClose} disabled={busy} aria-label="关闭"><X size={18} /></button></header>{children}</section></div>;
}

function Warnings({ values }: { values: string[] }) {
  return values.length ? <ul className="sav-warning-list">{[...new Set(values)].map(value => <li key={value}><TriangleAlert size={13} /><span>{value}</span></li>)}</ul> : null;
}

function ContainerDetail({ row, scope, onClose, onIncome, onGoods }: { row: SavContainerResult; scope: Scope; onClose: () => void; onIncome: () => void; onGoods: (id: string) => void }) {
  const [detailView, setDetailView] = useState<"cost" | "income">("cost");
  const balance = scope === "all" ? row.transportBalance : row.profit;
  return <Modal title={row.containerNumber} subtitle={`${row.customerName || "客户未填写"} · ${operationText(row.operationMode)} · ${orderStatusText(row.status)} · 提柜 ${row.pickupDate || "日期未填写"}`} onClose={onClose} wide>
    <div className="sav-detail-metrics"><div><span>{scope === "all" ? "有效账单已记录收入" : "派送及出库已记录收入"}</span><strong>{money(row.knownIncome)}</strong><small>{row.incomeStatus === "complete" ? "收入已归集" : "收入待核对"}</small></div><div><span>已计价运输支出</span><strong>{money(row.knownExpense)}</strong><small>{row.expenseStatus === "complete" ? "运输支出已计价" : "仍有支出待确认"}</small></div><div><span>{scope === "all" ? "收入减运输支出" : row.provisional ? "阶段核算利润" : "单柜利润"}</span><strong className={balance != null && balance < 0 ? "sav-negative" : ""}>{money(balance)}</strong><small>{scope === "all" ? "整柜利润待其他成本补齐" : balance == null ? "待收入与成本依据齐全后计算" : "收入减当前运输支出"}</small></div></div>
    <div className="sav-detail-warning"><Warnings values={row.warnings} /></div>
    <div className="sav-detail-tabs"><div role="group" aria-label="单柜明细"><button className={detailView === "cost" ? "active" : ""} onClick={() => setDetailView("cost")}>运输与货物明细 <span>{row.goods.length}</span></button><button className={detailView === "income" ? "active" : ""} onClick={() => setDetailView("income")}>收入来源 <span>{row.incomeLines.length}</span></button></div><button className="button ghost" onClick={onIncome}><FileText size={14} />核对收入</button></div>
    <div className="sav-detail-body sav-table-scroll">
      {detailView === "cost" ? <table className="sav-table sav-detail-table"><thead><tr><th>货物 / 趟次</th><th>目的地 / 日期</th><th>方式 / 状态</th><th className="sav-numeric">装运 / 拒收 / 净板数</th><th className="sav-numeric">分摊成本</th><th>计价依据</th><th /></tr></thead><tbody>{row.goods.map(goods => <tr key={goods.id}><td><strong>{goods.id}</strong><small>{goods.tripId || "尚未关联趟次"}</small><small>{goods.sourceReference}</small></td><td>{goods.warehousePoint || "—"}<small className="sav-wrap">{goods.address}</small><small>{goods.deliveryDate || "—"}</small></td><td>{goods.method || "—"}<small>{statusText(goods.status)}</small></td><td className="sav-numeric">{quantity(goods.loadedPallets)} / {quantity(goods.rejectedPallets)} / {quantity(goods.netPallets)}</td><td className="sav-numeric">{money(goods.amount)}</td><td className="sav-basis-cell">{goods.pricingBasis}<Warnings values={goods.warnings} /></td><td><button className="button ghost" onClick={() => onGoods(goods.id)}>核对状态</button></td></tr>)}{!row.goods.length ? <tr><td colSpan={7} className="sav-empty">没有可关联的货物明细，支出需核对</td></tr> : null}</tbody></table> : <table className="sav-table"><thead><tr><th>费用项目</th><th>核算归类</th><th className="sav-numeric">金额</th><th>来源</th></tr></thead><tbody>{row.incomeLines.map(line => <tr key={line.id}><td>{line.label}</td><td>{incomeCategoryText[line.category] || line.category}</td><td className="sav-numeric">{money(line.amount)}</td><td className="sav-wrap">{line.sourceReference || "—"}</td></tr>)}{!row.incomeLines.length ? <tr><td colSpan={4} className="sav-empty">未找到本核算口径的收入，请核对账单或补充收入依据</td></tr> : null}</tbody></table>}
    </div><footer className="sav-dialog-footer"><span>在库 {quantity(row.inStockPallets)} 板 · 退运 {quantity(row.returnedPallets)} 板</span><button className="button ghost" onClick={onClose}>关闭</button></footer>
  </Modal>;
}

function IncomeEditor({ row, scope, existing, save, onClose }: { row: SavContainerResult; scope: Scope; existing?: IncomeOverride; save: (patch: unknown) => Promise<void>; onClose: () => void }) {
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [note, setNote] = useState(existing?.note || "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(reset = false) {
    setError("");
    if (!reset && (!amount.trim() || !Number.isFinite(Number(amount)) || !note.trim())) { setError("请填写有效的收入金额和核对依据"); return; }
    setBusy(true);
    try { await save({ incomeOverrides: { [row.id]: reset ? null : { amount: Number(amount), note: note.trim() } } }); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title="核对单柜收入" subtitle={row.containerNumber} onClose={onClose} busy={busy}><form className="sav-editor" onSubmit={event => { event.preventDefault(); void submit(); }}><p className="sav-form-note">核定金额将替代该柜在当前口径下自动归集的收入。{scope === "all" ? "请核对所有有效账单的收入合计。" : "请按派送费、出库费口径填写。"}请记录对应账单或 Excel 依据。</p><div className="field"><label htmlFor="sav-income-amount">合计收入 / USD</label><input id="sav-income-amount" type="number" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} required /></div><div className="field"><label htmlFor="sav-income-note">核对依据</label><textarea id="sav-income-note" value={note} onChange={event => setNote(event.target.value)} placeholder="账单号、来源行号及确认原因" required maxLength={1000} /></div>{error ? <div className="sav-error" role="alert">{error}</div> : null}<footer className="sav-editor-actions">{existing ? <button type="button" className="button ghost" disabled={busy} onClick={() => void submit(true)}>恢复源系统收入</button> : null}<button type="button" className="button ghost" onClick={onClose} disabled={busy}>取消</button><button type="submit" className="button primary" disabled={busy}>{busy ? "保存中…" : "保存核对"}</button></footer></form></Modal>;
}

function TripEditor({ trip, existing, save, onClose }: { trip: SavTripResult; existing?: TripOverride; save: (patch: unknown) => Promise<void>; onClose: () => void }) {
  const [miles, setMiles] = useState(existing?.miles != null ? String(existing.miles) : "");
  const [stops, setStops] = useState(existing?.stopCount != null ? String(existing.stopCount) : "");
  const [amount, setAmount] = useState(existing?.explicitAmount != null ? String(existing.explicitAmount) : "");
  const [note, setNote] = useState(existing?.note || "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(reset = false) {
    setError("");
    const entries = { miles: miles.trim() ? Number(miles) : undefined, stopCount: stops.trim() ? Number(stops) : undefined, explicitAmount: amount.trim() ? Number(amount) : undefined };
    if (!reset && (!note.trim() || Object.values(entries).every(value => value == null) || Object.values(entries).some(value => value != null && (!Number.isFinite(value) || value < 0)) || (entries.stopCount != null && (!Number.isInteger(entries.stopCount) || entries.stopCount < 1)))) { setError("请填写有效的计价补充数据和依据；卸货点数须为正整数"); return; }
    setBusy(true);
    try { await save({ tripOverrides: { [trip.id]: reset ? null : { ...entries, note: note.trim() } } }); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title="补充趟次计价依据" subtitle={trip.id} onClose={onClose} busy={busy}><form className="sav-editor" onSubmit={event => { event.preventDefault(); void submit(); }}><p className="sav-form-note">未填写的项目沿用源数据。填写整趟核定金额后，将优先使用该金额分摊；可用于 LTL 运单金额。更改会影响该趟关联的所有柜。</p><div className="sav-form-grid"><div className="field"><label htmlFor="sav-trip-miles">单程英里</label><input id="sav-trip-miles" type="number" min="0" step="0.01" placeholder={quantity(trip.miles)} value={miles} onChange={event => setMiles(event.target.value)} /></div><div className="field"><label htmlFor="sav-trip-stops">实际卸货点数</label><input id="sav-trip-stops" type="number" min="1" step="1" placeholder={quantity(trip.stopCount)} value={stops} onChange={event => setStops(event.target.value)} /></div></div><div className="field"><label htmlFor="sav-trip-amount">整趟核定金额 / USD</label><input id="sav-trip-amount" type="number" min="0" step="0.01" placeholder="留空按里程及多卸规则计算" value={amount} onChange={event => setAmount(event.target.value)} /></div><div className="field"><label htmlFor="sav-trip-note">补充依据</label><textarea id="sav-trip-note" required maxLength={1000} value={note} onChange={event => setNote(event.target.value)} placeholder="里程查询、运单号、核对说明" /></div>{error ? <div className="sav-error" role="alert">{error}</div> : null}<footer className="sav-editor-actions">{existing ? <button type="button" className="button ghost" disabled={busy} onClick={() => void submit(true)}>恢复源数据</button> : null}<button type="button" className="button ghost" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={busy}>{busy ? "保存中…" : "保存并重算"}</button></footer></form></Modal>;
}

function GoodsEditor({ goods, existing, save, onClose }: { goods: SavCostLine; existing?: GoodsOverride; save: (patch: unknown) => Promise<void>; onClose: () => void }) {
  const [status, setStatus] = useState<SavGoodsStatus>(existing?.status || goods.status), [method, setMethod] = useState(existing?.method || ""), [note, setNote] = useState(existing?.note || "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(reset = false) {
    setError(""); if (!reset && !note.trim()) { setError("请填写状态核对依据"); return; }
    setBusy(true);
    try { await save({ goodsOverrides: { [goods.id]: reset ? null : { status, ...(method ? { method } : {}), note: note.trim() } } }); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title="核对货物状态" subtitle={`${goods.id} · ${goods.warehousePoint || goods.address || "目的地未填写"}`} onClose={onClose} busy={busy}><form className="sav-editor" onSubmit={event => { event.preventDefault(); void submit(); }}><p className="sav-form-note">原装运板数 {quantity(goods.loadedPallets)} 板。这里保存 Finance 核对依据，不修改 CoreFlow。归入正常运输后，仍须具备对应方式的计价依据。</p><div className="field"><label htmlFor="sav-goods-status">核算状态</label><select id="sav-goods-status" value={status} onChange={event => setStatus(event.target.value as SavGoodsStatus)}><option value="transport">正常运输</option><option value="in_stock">在库</option><option value="returned">退运</option><option value="pending">待核对</option></select></div><div className="field"><label htmlFor="sav-goods-method">运输方式</label><select id="sav-goods-method" value={method} onChange={event => setMethod(event.target.value)}><option value="">沿用源数据（{goods.method || "未填写"}）</option>{["自提", "私仓", "卡派", "LTL", "直送"].map(value => <option key={value} value={value}>{value}</option>)}</select></div><div className="field"><label htmlFor="sav-goods-note">核对依据</label><textarea id="sav-goods-note" required maxLength={1000} value={note} onChange={event => setNote(event.target.value)} placeholder="在库确认、退运记录或自提依据" /></div>{error ? <div className="sav-error" role="alert">{error}</div> : null}<footer className="sav-editor-actions">{existing ? <button type="button" className="button ghost" disabled={busy} onClick={() => void submit(true)}>恢复源数据</button> : null}<button type="button" className="button ghost" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={busy}>{busy ? "保存中…" : "保存并重算"}</button></footer></form></Modal>;
}

const pricingFields: Array<{ key: keyof SavPricingRule; label: string; unit: string }> = [
  { key: "perMile", label: "每英里费用", unit: "USD / mi" }, { key: "roundingUnit", label: "四舍五入单位", unit: "USD" }, { key: "minimumTrip", label: "最低基础费用", unit: "USD / 趟" }, { key: "additionalStop", label: "每多一卸费用", unit: "USD / 点" }, { key: "pickupPerPallet", label: "自提每板费用", unit: "USD / 板" }
];

function PricingEditor({ pricing, save, scope }: { pricing: SavPricingRule; save: (patch: unknown) => Promise<void>; scope: Scope }) {
  const [form, setForm] = useState<Record<string, string>>(Object.fromEntries(pricingFields.map(field => [field.key, String(pricing[field.key])])));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  async function submit() {
    setError(""); setSaved(false);
    const values = Object.fromEntries(pricingFields.map(field => [field.key, Number(form[field.key])]));
    if (pricingFields.some(field => !form[field.key]?.trim() || !Number.isFinite(values[field.key]) || values[field.key] < 0) || values.roundingUnit <= 0) { setError("费用不得小于零，四舍五入单位须大于零"); return; }
    setBusy(true);
    try { await save({ pricing: values }); setSaved(true); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="sav-rules"><div className="sav-rules-copy"><h2>运输计价规则</h2><p>沿用 Excel 的运输核算口径，按整趟计价后分摊到货物和柜号。</p><ol><li>基础费用：单程英里 × 每英里费用，按设定金额四舍五入，且不低于最低基础费用。</li><li>多卸费用：第一个卸货点以外，每个实际卸货点另计一次。</li><li>分摊：按原装运板数，包含拒收板数；同趟跨日期、跨柜货物共同参与分摊。</li><li>自提按板数计费，LTL 按运单或核定金额。缺少依据时保留待核对状态。</li></ol><p>{scope === "all" ? "全部订单口径汇总有效账单收入；本页规则仅计算运输支出。其他成本未完整接入，收入减运输支出不作为整柜最终利润。" : "Excel 口径核算派送费及出库费与运输支出的差额。仓租、工资等其他支出尚不在本口径中。"}</p></div><form className="sav-rules-form" onSubmit={event => { event.preventDefault(); void submit(); }}>{pricingFields.map(field => <div className="field" key={field.key}><label htmlFor={`sav-price-${field.key}`}>{field.label}<span>{field.unit}</span></label><input id={`sav-price-${field.key}`} type="number" step="0.01" min={field.key === "roundingUnit" ? "0.01" : "0"} value={form[field.key]} onChange={event => { setForm(current => ({ ...current, [field.key]: event.target.value })); setSaved(false); }} required /></div>)}{error ? <div className="sav-error" role="alert">{error}</div> : null}{saved ? <div className="sav-save-status" role="status">计价规则已保存，结果已重新计算</div> : null}<button className="button primary" disabled={busy} type="submit">{busy ? "正在保存…" : "保存规则并重算"}</button></form></section>;
}

export default function SavContainerAccounting() {
  const [filters, setFilters] = useState<Filters>(defaultFilters), [applied, setApplied] = useState<Filters>(defaultFilters);
  const [view, setView] = useState<View>("containers"), [status, setStatus] = useState("all"), [page, setPage] = useState(1);
  const [sourcePage, setSourcePage] = useState(1), [sourcePageSize, setSourcePageSize] = useState(100);
  const [data, setData] = useState<ResponseData | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [revision, setRevision] = useState(0), [selected, setSelected] = useState<string | null>(null), [incomeEditing, setIncomeEditing] = useState<string | null>(null), [tripEditing, setTripEditing] = useState<string | null>(null), [goodsEditing, setGoodsEditing] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false), [uploading, setUploading] = useState(false);
  const [calibrating, setCalibrating] = useState(false), [calibrationNote, setCalibrationNote] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const params = useMemo(() => new URLSearchParams(Object.entries(applied).filter(([, value]) => value.trim())).toString(), [applied]);
  const pageParams = useMemo(() => `${params}&page=${sourcePage}&pageSize=${sourcePageSize}`, [params, sourcePage, sourcePageSize]);
  const request = useRef(0);
  const load = useCallback(async (signal?: AbortSignal) => {
    const id = ++request.current;
    setLoading(true); setError(""); setData(null);
    try {
      const next = await json<ResponseData>(await fetch(`/api/sav-accounting?${pageParams}${revision ? "&refresh=1" : ""}`, { signal, cache: "no-store" }));
      if (request.current === id && !signal?.aborted) {
        setData(next);
        if (next.pagination && next.pagination.page !== sourcePage) setSourcePage(next.pagination.page);
      }
    } catch (e) { if (request.current === id && !signal?.aborted) setError((e as Error).message); }
    finally { if (request.current === id && !signal?.aborted) setLoading(false); }
  }, [pageParams, revision, sourcePage]);
  useEffect(() => { const controller = new AbortController(); setSelected(null); setPage(1); void load(controller.signal); return () => controller.abort(); }, [load]);
  const save = useCallback(async (patch: unknown) => {
    await json(await fetch(`/api/sav-accounting/settings?scope=${applied.scope}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }));
    try {
      const next = await json<ResponseData>(await fetch(`/api/sav-accounting?${pageParams}&refresh=1`, { cache: "no-store" }));
      setData(next);
    } catch { throw new Error("核对已保存，但重新读取结果失败。请关闭后刷新核算结果。"); }
  }, [pageParams, applied.scope]);
  const rows = useMemo(() => (data?.rows || []).filter(row => {
    if (status === "all") return true;
    if (status === "pending") return applied.scope === "all" ? row.transportBalance == null : row.profit == null;
    if (status === "loss") { const amount = applied.scope === "all" ? row.transportBalance : row.profit; return amount != null && amount < 0; }
    if (status === "missing-income") return row.incomeStatus !== "complete";
    return row.inStockPallets > 0;
  }), [data, status, applied.scope]);
  const stock = useMemo(() => (data?.rows || []).flatMap(row => row.goods.filter(goods => goods.status === "in_stock" || goods.status === "returned" || goods.status === "pending").map(goods => ({ row, goods }))), [data]);
  const pages = Math.max(1, Math.ceil((view === "trips" ? data?.trips.length || 0 : view === "stock" ? stock.length : view === "reconciliation" ? data?.reconciliation?.rows.length || 0 : rows.length) / 50));
  const pagination = data?.pagination || { page: sourcePage, pageSize: sourcePageSize, totalCount: data?.rows.length || 0, totalPages: 1 };
  const sourceStart = pagination.totalCount ? (pagination.page - 1) * pagination.pageSize + 1 : 0;
  const sourceEnd = Math.min(pagination.page * pagination.pageSize, pagination.totalCount);
  useEffect(() => { setPage(value => Math.min(value, pages)); }, [pages]);
  const detail = data?.rows.find(row => row.id === selected), incomeRow = data?.rows.find(row => row.id === incomeEditing), editingTrip = data?.trips.find(trip => trip.id === tripEditing);
  const editingGoods = data?.rows.flatMap(row => row.goods).find(goods => goods.id === goodsEditing);
  async function exportFile() {
    setExporting(true); setError("");
    try {
      const response = await fetch(`/api/sav-accounting/export?${params}&status=${status === "missing-income" ? "missing_income" : status}`, { cache: "no-store" });
      if (!response.ok) { await json(response); return; }
      const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `SAV单柜核算_${applied.dateFrom || "全部"}_${applied.dateTo || "全部"}.csv`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError((e as Error).message); } finally { setExporting(false); }
  }
  const changeView = (next: View) => { setView(next); setPage(1); };
  const applyFilters = (next: Filters) => {
    setFilters(next); setApplied(next); setSourcePage(1); setPage(1); setStatus("all"); setRevision(value => value + 1);
  };
  const useBaseline = () => { applyFilters({ ...baselineFilters }); setSourcePageSize(300); setView("reconciliation"); };
  async function uploadBaseline(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true); setError("");
    try { const body = new FormData(); Array.from(files).forEach(file => body.append("files", file)); await json(await fetch("/api/sav-accounting/baseline", { method: "POST", body })); await load(); setView("reconciliation"); setPage(1); }
    catch (e) { setError((e as Error).message); } finally { setUploading(false); if (fileInput.current) fileInput.current.value = ""; }
  }
  async function calibrate() {
    setCalibrating(true); setError(""); setCalibrationNote("");
    try { const result = await json<{ appliedCount: number; skippedCount: number; notes: string[] }>(await fetch(`/api/sav-accounting/calibrate?${pageParams}`, { method: "POST" })); await load(); setCalibrationNote(`当前查询范围关联趟次已补齐 ${result.appliedCount} 条，跳过 ${result.skippedCount} 条。${result.notes.join("；")}`); }
    catch (e) { setError((e as Error).message); } finally { setCalibrating(false); }
  }
  return <div className="sav-accounting">
    <form className="sav-filters" onSubmit={event => { event.preventDefault(); if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) { setError("开始日期不能晚于结束日期"); return; } applyFilters({ ...filters }); }}>
      <div className="field"><label htmlFor="sav-scope">查询范围</label><select id="sav-scope" value={filters.scope} onChange={event => setFilters(current => ({ ...current, scope: event.target.value as Scope }))}><option value="all">全部 SAV 订单</option><option value="excel">Excel 私仓口径</option></select></div>
      <div className="field"><label htmlFor="sav-operation-mode">业务类型</label><select id="sav-operation-mode" value={filters.operationMode} onChange={event => setFilters(current => ({ ...current, operationMode: event.target.value }))}><option value="all">全部类型</option>{(data?.operationModes || [{ operationMode: "unload", count: 0 }, { operationMode: "direct_delivery", count: 0 }]).map(item => <option key={item.operationMode} value={item.operationMode}>{operationText(item.operationMode)}{item.count ? `（${item.count}）` : ""}</option>)}</select></div>
      <div className="field sav-search"><label htmlFor="sav-search">柜号 / 客户</label><div className="input-with-icon"><Search size={16} /><input id="sav-search" value={filters.search} onChange={event => setFilters(current => ({ ...current, search: event.target.value }))} placeholder="搜索柜号或客户" /></div></div><div className="field"><label htmlFor="sav-date-from">提柜日期从</label><input id="sav-date-from" type="date" value={filters.dateFrom} onChange={event => setFilters(current => ({ ...current, dateFrom: event.target.value }))} /></div><div className="field"><label htmlFor="sav-date-to">至</label><input id="sav-date-to" type="date" value={filters.dateTo} onChange={event => setFilters(current => ({ ...current, dateTo: event.target.value }))} /></div><button type="submit" className="button primary" disabled={loading}><Search size={15} />查询</button><button type="button" className="button ghost" onClick={() => setRevision(value => value + 1)} disabled={loading} aria-label="刷新 SAV 核算"><RefreshCw size={15} className={loading ? "sav-spin" : ""} />刷新</button><button type="button" className="button ghost" onClick={() => void exportFile()} disabled={loading || !data || exporting} title="导出符合查询条件的所有订单页"><Download size={15} />{exporting ? "导出中…" : "导出 CSV"}</button>
    </form>
    <div className="sav-coverage-note"><div><strong>{applied.scope === "all" ? "全部 SAV 订单" : "Excel 私仓核算口径"}</strong><span>{applied.scope === "all" ? "涵盖所有业务类型，未提柜、无货物明细及费用待补的订单也保留在列表中。收入汇总全部有效账单，支出当前为运输模型；其他成本未完整接入，整柜利润保持待核对。" : "沿用原 Excel 的私仓、非亚马逊拆柜范围，仅计派送费及出库费收入。"}</span></div><button type="button" className="button ghost" disabled={loading} onClick={useBaseline}>按原 Excel 日期比对</button>{applied.scope === "excel" ? <button type="button" className="button ghost" disabled={loading} onClick={() => { applyFilters({ ...defaultFilters }); setView("containers"); }}>查看全部 SAV 订单</button> : null}</div>
    {error ? <div className="sav-error" role="alert"><TriangleAlert size={16} /><span>{error}</span><button className="button ghost" onClick={() => setRevision(value => value + 1)}>重试</button></div> : null}
    {loading ? <div className="sav-loading" role="status"><RefreshCw size={22} className="sav-spin" /><strong>正在读取 SAV 数据并计算…</strong><span>整趟货物共同参与成本分摊</span></div> : null}
    {data ? <>
      <div className="sav-query-meta"><strong>符合条件 {quantity(pagination.totalCount)} 个订单</strong><span>{applied.dateFrom || applied.dateTo ? `提柜日期 ${applied.dateFrom || "不限"} 至 ${applied.dateTo || "不限"}` : "全部历史日期，含未填写提柜日期的订单"}</span><span>本页第 {sourceStart}–{sourceEnd} 个订单</span></div>
      <div className="sav-summary"><div><span>本页订单数</span><strong>{data.summary.containerCount}</strong><small>收入待核对 {data.summary.missingIncomeCount} 柜</small></div><div><span>本页已记录收入 / USD</span><strong>{money(data.summary.knownIncome)}</strong><small>{applied.scope === "all" ? "全部有效账单收入" : "派送费及出库费"}</small></div><div><span>本页已计运输支出 / USD</span><strong>{money(data.summary.knownExpense)}</strong><small>成本待核对 {data.summary.pendingCostCount} 条</small></div><div><span>{applied.scope === "all" ? "本页收入减运输支出 / USD" : "本页可计算柜利润 / USD"}</span><strong className={(applied.scope === "all" ? data.summary.transportBalance || 0 : data.summary.comparableProfit) < 0 ? "sav-negative" : ""}>{applied.scope === "all" ? money(data.summary.transportBalance) : data.summary.completeCount ? money(data.summary.comparableProfit) : "—"}</strong><small>{applied.scope === "all" ? `仅计 ${data.summary.calculatedBalanceCount || 0} 柜；其他成本待补齐` : `可计算 ${data.summary.completeCount} 柜；含在库 / 退运 ${data.summary.provisionalCount} 柜`}</small></div></div>
      <section className="sav-workspace"><div className="sav-workspace-head"><nav className="sav-view-tabs" aria-label="SAV 核算视图"><button className={view === "containers" ? "active" : ""} onClick={() => changeView("containers")}>单柜核算 <span>{data.rows.length}</span></button><button className={view === "trips" ? "active" : ""} onClick={() => changeView("trips")}><Truck size={15} />趟次计价 <span>{data.trips.length}</span></button><button className={view === "stock" ? "active" : ""} onClick={() => changeView("stock")}>在库与待核对 <span>{stock.length}</span></button><button className={view === "reconciliation" ? "active" : ""} onClick={() => changeView("reconciliation")}><FileText size={15} />Excel 比对</button><button className={view === "rules" ? "active" : ""} onClick={() => changeView("rules")}><Settings2 size={15} />计价规则</button></nav>{view === "containers" ? <select aria-label="筛选本页核算状态" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="all">本页全部状态</option><option value="pending">{applied.scope === "all" ? "本页收入/运输待核对" : "本页待核对"}</option><option value="missing-income">本页收入待核对</option><option value="loss">{applied.scope === "all" ? "本页运输差额为负" : "本页可计算亏损"}</option><option value="stock">本页含在库货物</option></select> : null}</div>
      {view === "reconciliation" ? <div className="sav-reconciliation-head"><div><strong>按柜金额与 Excel 基准比对</strong><p>{applied.scope !== "excel" ? "全部订单包含全部有效账单，需切换为原 Excel 口径后比较金额。" : data.reconciliation ? `金额一致 ${data.reconciliation.summary.matched} 柜 · 有差额 ${data.reconciliation.summary.different} 柜 · 待核对 ${data.reconciliation.summary.pending} 柜 · 仅系统 ${data.reconciliation.summary.sourceOnly} 柜 · 当前筛选无系统记录 ${data.reconciliation.summary.baselineOnly} 柜` : "尚未上传比对基准"}</p><small>Excel 用作比对基准；补齐计价依据只填缺失里程及 LTL 金额，并保留来源。</small>{data.settings.baseline ? <p className="sav-baseline-source">基准：{data.settings.baseline.sourceName} · {new Date(data.settings.baseline.importedAt).toLocaleString("zh-CN")}</p> : null}{data.settings.baseline?.transport ? <p className="sav-baseline-source">运输明细基准 {quantity(data.settings.baseline.transport.goodsCount)} 条，数值成本 {money(data.settings.baseline.transport.knownExpense)}。范围不同，不直接与当前选柜总成本相减。<small>{data.settings.baseline.transport.sourceName}</small></p> : null}</div><input ref={fileInput} className="sav-file-input" type="file" accept=".xlsx" multiple aria-label="上传 Excel 比对基准" onChange={event => void uploadBaseline(event.target.files)} /><div className="sav-reconciliation-actions">{applied.scope !== "excel" ? <button className="button primary" disabled={loading} onClick={useBaseline}>切换为原 Excel 口径</button> : null}<button className="button ghost" onClick={() => fileInput.current?.click()} disabled={uploading || loading || calibrating}>{uploading ? "正在上传…" : "上传 Excel 基准"}</button><button className="button primary" onClick={() => void calibrate()} disabled={uploading || loading || calibrating || applied.scope !== "excel" || !data.settings.baseline?.containers.length}>{calibrating ? "正在补齐…" : "补齐缺失计价依据"}</button></div></div> : null}
      {view === "reconciliation" && calibrationNote ? <div className="sav-calibration-note" role="status">{calibrationNote}</div> : null}
      {view === "rules" ? <PricingEditor pricing={data.pricing} save={save} scope={applied.scope} /> : <div className="sav-table-scroll"><table className={`sav-table${view === "trips" ? " sav-trip-table" : ""}`} aria-label={view === "containers" ? "SAV 单柜核算" : view === "trips" ? "SAV 趟次计价" : view === "reconciliation" ? "SAV Excel 金额比对" : "SAV 在库与待核对明细"}>
        {view === "containers" ? <><thead><tr><th>柜号 / 客户</th><th>业务 / 订单状态</th><th>提柜日期</th><th className="sav-numeric">已记录收入</th><th className="sav-numeric">已计价支出</th><th className="sav-numeric">{applied.scope === "all" ? "收入减运输支出" : "利润"}</th><th>核算状态</th><th className="sav-numeric">在库 / 退运板数</th><th /></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><button className="sav-text-button" onClick={() => setSelected(row.id)}>{row.containerNumber}</button><small>{row.customerName || "客户未填写"}</small></td><td>{operationText(row.operationMode)}<small>{orderStatusText(row.status)}</small></td><td>{row.pickupDate || "未填写"}</td><td className="sav-numeric">{money(row.knownIncome)}{row.incomeStatus !== "complete" ? <small className="sav-pending-text">待核对</small> : null}</td><td className="sav-numeric">{money(row.knownExpense)}{row.expenseStatus !== "complete" ? <small className="sav-pending-text">待核对</small> : null}</td><td className={`sav-numeric${(applied.scope === "all" ? row.transportBalance ?? 0 : row.profit ?? 0) < 0 ? " sav-negative" : ""}`}>{money(applied.scope === "all" ? row.transportBalance : row.profit)}</td><td><span className={`sav-status ${row.profit == null ? "pending" : "complete"}`}>{row.statusLabel}</span>{row.warnings.length ? <small className="sav-row-warning" title={row.warnings.join("；")}>{row.warnings[0]}</small> : null}</td><td className="sav-numeric">{quantity(row.inStockPallets)} / {quantity(row.returnedPallets)}</td><td><button className="icon-button" title={`查看 ${row.containerNumber} 核算依据`} onClick={() => setSelected(row.id)}><ChevronRight size={16} /></button></td></tr>)}{!rows.length ? <tr><td colSpan={9} className="sav-empty">{status === "all" ? "没有符合查询条件的 SAV 订单" : "本页没有符合核算状态的订单，可切换其他订单页或选择全部状态"}</td></tr> : null}</tbody></> : null}
        {view === "trips" ? <><thead><tr><th>计价趟次</th><th className="sav-numeric">单程英里</th><th className="sav-numeric">卸货点数</th><th className="sav-numeric">整趟装运板数</th><th className="sav-numeric">整趟成本</th><th>计价依据 / 待核对</th><th /></tr></thead><tbody>{data.trips.slice((page - 1) * 50, page * 50).map(trip => <tr key={trip.id}><td><strong>{trip.id}</strong><small>{trip.goodsCount} 条货物</small><details className="sav-trip-source"><summary>数据来源</summary><small>{trip.sourceReference}</small></details></td><td className="sav-numeric">{quantity(trip.miles)}</td><td className="sav-numeric">{quantity(trip.stopCount)}</td><td className="sav-numeric">{quantity(trip.loadedPallets)}</td><td className="sav-numeric">{money(trip.amount)}</td><td className="sav-basis-cell">{trip.pricingBasis}<Warnings values={trip.warnings} /></td><td><button className="button ghost" onClick={() => setTripEditing(trip.id)}>核对计价</button></td></tr>)}{!data.trips.length ? <tr><td colSpan={7} className="sav-empty">当前范围没有运输趟次</td></tr> : null}</tbody></> : null}
        {view === "stock" ? <><thead><tr><th>柜号 / 客户</th><th>货物 / 目的地</th><th>状态</th><th className="sav-numeric">板数</th><th>源数据依据</th><th /></tr></thead><tbody>{stock.slice((page - 1) * 50, page * 50).map(({ row, goods }) => <tr key={`${row.id}-${goods.id}`}><td><button className="sav-text-button" onClick={() => setSelected(row.id)}>{row.containerNumber}</button><small>{row.customerName || "—"}</small></td><td>{goods.warehousePoint || "—"}<small className="sav-wrap">{goods.address}</small></td><td><span className="sav-status pending">{statusText(goods.status)}</span></td><td className="sav-numeric">{quantity(goods.loadedPallets)}</td><td className="sav-wrap">{goods.sourceReference || "—"}<Warnings values={goods.warnings} /></td><td><button className="button ghost" onClick={() => setGoodsEditing(goods.id)}>核对状态</button></td></tr>)}{!stock.length ? <tr><td colSpan={6} className="sav-empty">当前范围没有在库、退运或状态待核对货物</td></tr> : null}</tbody></> : null}
        {view === "reconciliation" ? <><thead><tr><th>柜号</th><th className="sav-numeric">系统收入</th><th className="sav-numeric">Excel 收入</th><th className="sav-numeric">收入差额</th><th className="sav-numeric">系统支出</th><th className="sav-numeric">Excel 支出</th><th className="sav-numeric">支出差额</th><th>比对结果</th></tr></thead><tbody>{(applied.scope === "excel" ? data.reconciliation?.rows || [] : []).slice((page - 1) * 50, page * 50).map(row => <tr key={row.containerNumber}><td><strong>{row.containerNumber}</strong></td><td className="sav-numeric">{money(row.actualIncome)}</td><td className="sav-numeric">{money(row.expectedIncome)}</td><td className={`sav-numeric${row.incomeDifference ? " sav-negative" : ""}`}>{money(row.incomeDifference)}</td><td className="sav-numeric">{money(row.actualExpense)}</td><td className="sav-numeric">{money(row.expectedExpense)}</td><td className={`sav-numeric${row.expenseDifference ? " sav-negative" : ""}`}>{money(row.expenseDifference)}</td><td><span className={`sav-status ${row.status === "matched" ? "complete" : "pending"}`}>{({ matched: "金额一致", different: "有差额", pending: "数据待核对", source_only: "当前基准无记录", baseline_only: "当前筛选无系统记录" })[row.status]}</span></td></tr>)}{applied.scope !== "excel" || !data.reconciliation?.rows.length ? <tr><td colSpan={8} className="sav-empty">{applied.scope !== "excel" ? "选择原 Excel 口径后，按同范围的收入和支出逐柜核对" : "上传按柜利润汇总 Excel 后，在这里逐柜核对"}</td></tr> : null}</tbody></> : null}
      </table></div>}
      {view === "containers" ? <footer className="sav-pagination sav-server-pagination">
        <span>共 {quantity(pagination.totalCount)} 个订单 · 当前第 {sourceStart}–{sourceEnd} 个{status !== "all" ? `，本页状态筛选显示 ${rows.length} 个` : ""}</span>
        <div><label htmlFor="sav-page-size">每页</label><select id="sav-page-size" value={sourcePageSize} disabled={loading} onChange={event => { setSourcePageSize(Number(event.target.value)); setSourcePage(1); }}><option value={100}>100</option><option value={200}>200</option><option value={300}>300</option></select><button className="icon-button" disabled={loading || pagination.page <= 1} onClick={() => setSourcePage(value => Math.max(1, value - 1))} aria-label="上一页订单"><ChevronLeft size={16} /></button><span>{pagination.page} / {Math.max(1, pagination.totalPages)}</span><button className="icon-button" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => setSourcePage(value => Math.min(pagination.totalPages, value + 1))} aria-label="下一页订单"><ChevronRight size={16} /></button></div>
      </footer> : view !== "rules" ? <footer className="sav-pagination"><span>{view === "trips" ? `第 ${pagination.page} 页订单的关联趟次；计价包含同趟其他货物` : view === "reconciliation" ? `第 ${pagination.page} 页订单比对；差额为系统金额减 Excel 金额` : `第 ${pagination.page} 页订单的货物；在库与退运不计正常运输支出`}</span><div><button className="icon-button" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))} aria-label="上一页明细"><ChevronLeft size={16} /></button><span>{page} / {pages}</span><button className="icon-button" disabled={page >= pages} onClick={() => setPage(value => Math.min(pages, value + 1))} aria-label="下一页明细"><ChevronRight size={16} /></button></div></footer> : null}</section>
      <div className="sav-source-notes"><span>数据来源：CoreFlow SAV{data.source.snapshotAt ? ` · 读取时间 ${new Date(data.source.snapshotAt).toLocaleString("zh-CN")}` : ""}</span>{data.source.notes.map((note, index) => <p key={index}>{note}</p>)}</div>
    </> : null}
    {detail && !incomeEditing && !goodsEditing ? <ContainerDetail row={detail} scope={applied.scope} onClose={() => setSelected(null)} onIncome={() => setIncomeEditing(detail.id)} onGoods={setGoodsEditing} /> : null}
    {incomeRow ? <IncomeEditor row={incomeRow} scope={applied.scope} existing={data?.settings.incomeOverrides[incomeRow.id]} save={save} onClose={() => setIncomeEditing(null)} /> : null}
    {editingGoods ? <GoodsEditor goods={editingGoods} existing={data?.settings.goodsOverrides?.[editingGoods.id]} save={save} onClose={() => setGoodsEditing(null)} /> : null}
    {editingTrip ? <TripEditor trip={editingTrip} existing={data?.settings.tripOverrides[editingTrip.id]} save={save} onClose={() => setTripEditing(null)} /> : null}
  </div>;
}

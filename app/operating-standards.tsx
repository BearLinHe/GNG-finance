"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import {
  CalendarDays,
  CircleDollarSign,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  XCircle
} from "lucide-react";
import { money } from "@/lib/money";

export type StandardCategory = "transport" | "warehouse" | "domestic";
type StandardKind = "fixed" | "monthly";

type TransportPricingRule = {
  id: number;
  rule_code: string;
  rule_name: string;
  rule_type: "fixed_route" | "amazon_warehouse";
  warehouse_point: string | null;
  price_group: string | null;
  address: string | null;
  condition_key: string;
  amount: number;
  is_active: boolean;
};

type WarehousePickupPricingRule = {
  id: number;
  rule_code: string;
  rule_name: string;
  warehouse_point: string;
  price_group: string | null;
  address: string | null;
  amount: number;
  is_temporary: boolean;
  is_active: boolean;
};

type CustomStandard = {
  id: number;
  category: StandardCategory;
  standard_kind: StandardKind;
  standard_name: string;
  amount: number;
  unit: string;
  billing_month: string | null;
  period_start: string | null;
  period_end: string | null;
  vendor_name: string | null;
  application_rule: "per_container" | "monthly_manual" | "monthly_prorated";
  operation_mode: "unload" | "direct_delivery" | null;
  description: string | null;
  is_active: boolean;
};

type StandardRow = {
  key: string;
  id: number | null;
  category: StandardCategory;
  standardKind: StandardKind;
  standardName: string;
  amount: number;
  unit: string;
  billingMonth: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  vendorName: string | null;
  applicationLabel: string;
  detail: string | null;
  sourceLabel: string;
  editable: boolean;
};

type StandardForm = {
  id: number | null;
  standardName: string;
  amount: string;
  unit: string;
  billingMonth: string;
  periodStart: string;
  periodEnd: string;
  vendorName: string;
  description: string;
};

const categories = {
  transport: { label: "运输", description: "提还柜、送仓及运输相关费用" },
  warehouse: { label: "仓库", description: "仓内作业及仓租相关费用" },
  domestic: { label: "国内", description: "国内端产生的运营费用" }
} satisfies Record<StandardCategory, { label: string; description: string }>;

const conditionLabels: Record<string, string> = {
  pickup_out: "每柜固定提柜",
  return_empty: "每柜固定还柜",
  unload_pickup_out: "拆柜固定送 Hayward",
  unload_return_empty: "拆柜固定回奥克兰码头",
  amazon_delivery: "按目的仓点计费"
};

const monthlyProjectDefaults: Record<StandardCategory, string[]> = {
  transport: ["车架租金", "Shipper 场地租金"],
  warehouse: ["仓库工资", "仓库耗材"],
  domestic: []
};

const currentMonth = () => new Date().toISOString().slice(0, 7);
const currentMonthEnd = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
};

function emptyForm(kind: StandardKind): StandardForm {
  return {
    id: null,
    standardName: "",
    amount: "0",
    unit: kind === "fixed" ? "柜" : "月",
    billingMonth: kind === "monthly" ? currentMonth() : "",
    periodStart: kind === "monthly" ? `${currentMonth()}-01` : "",
    periodEnd: kind === "monthly" ? currentMonthEnd() : "",
    vendorName: "",
    description: ""
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

type StandardsResponse = {
  customStandards: CustomStandard[];
  transportRules: TransportPricingRule[];
  warehousePickupRules: WarehousePickupPricingRule[];
};

const standardsCache = new Map<string, StandardsResponse>();

export default function OperatingStandards({ category }: { category: StandardCategory }) {
  const [standardKind, setStandardKind] = useState<StandardKind>("fixed");
  const [customStandards, setCustomStandards] = useState<CustomStandard[]>([]);
  const [transportRules, setTransportRules] = useState<TransportPricingRule[]>([]);
  const [warehousePickupRules, setWarehousePickupRules] = useState<WarehousePickupPricingRule[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<StandardForm>(() => emptyForm("fixed"));
  const loadSequence = useRef(0);
  const projectInputId = useId();
  const projectOptionsId = `${projectInputId}-options`;
  const monthlyProjectOptions = useMemo(() => [...new Set([
    ...monthlyProjectDefaults[category],
    ...customStandards
      .filter((standard) => standard.category === category && standard.standard_kind === "monthly")
      .map((standard) => standard.standard_name.trim())
      .filter(Boolean)
  ])], [category, customStandards]);

  const loadStandards = useCallback(async (force = false) => {
    const requestId = ++loadSequence.current;
    const cacheKey = `${category}:${standardKind}`;
    const cached = standardsCache.get(cacheKey);
    if (cached && !force) {
      setCustomStandards(cached.customStandards);
      setTransportRules(cached.transportRules);
      setWarehousePickupRules(cached.warehousePickupRules);
      setLoading(false);
      setError("");
      return;
    }

    setLoading(!cached);
    setError("");
    try {
      const params = new URLSearchParams({ category, standardKind });
      const data = await readJson<StandardsResponse>(
        await fetch(`/api/expense-standards?${params}`)
      );
      if (requestId !== loadSequence.current) return;
      standardsCache.set(cacheKey, data);
      setCustomStandards(data.customStandards);
      setTransportRules(data.transportRules);
      setWarehousePickupRules(data.warehousePickupRules);
    } catch (err) {
      if (requestId !== loadSequence.current) return;
      setError(err instanceof Error ? err.message : "读取支出标准失败");
    } finally {
      if (requestId === loadSequence.current) setLoading(false);
    }
  }, [category, standardKind]);

  useEffect(() => {
    void loadStandards();
  }, [loadStandards]);

  const rows = useMemo<StandardRow[]>(() => {
    const systemRows: StandardRow[] = category === "transport" && standardKind === "fixed"
      ? transportRules.map((rule) => ({
        key: `transport-${rule.id}`,
        id: null,
        category: "transport",
        standardKind: "fixed",
        standardName: rule.rule_name,
        amount: rule.amount,
        unit: "柜",
        billingMonth: null,
        periodStart: null,
        periodEnd: null,
        vendorName: rule.warehouse_point,
        applicationLabel: conditionLabels[rule.condition_key] || "按柜自动匹配",
        detail: rule.address || (rule.price_group ? `${rule.price_group}仓点` : null),
        sourceLabel: rule.rule_type === "amazon_warehouse" ? "运输定价表" : "系统固定",
        editable: false
      }))
      : [];
    const pickupRows: StandardRow[] = category === "warehouse" && standardKind === "fixed"
      ? warehousePickupRules.map((rule) => ({
        key: `warehouse-pickup-${rule.id}`,
        id: null,
        category: "warehouse",
        standardKind: "fixed",
        standardName: rule.rule_name,
        amount: rule.amount,
        unit: "柜",
        billingMonth: null,
        periodStart: null,
        periodEnd: null,
        vendorName: rule.warehouse_point,
        applicationLabel: "按自提预约及分仓比例计费",
        detail: rule.address || (rule.price_group ? `${rule.price_group}仓点` : null),
        sourceLabel: rule.is_temporary ? "临时价：车主价 + $50" : "仓库自提定价",
        editable: false
      }))
      : [];
    const manualRows: StandardRow[] = customStandards.map((standard) => ({
      key: `standard-${standard.id}`,
      id: standard.id,
      category: standard.category,
      standardKind: standard.standard_kind,
      standardName: standard.standard_name,
      amount: standard.amount,
      unit: standard.unit,
      billingMonth: standard.application_rule === "monthly_prorated" && !standard.period_start ? "每月" : standard.billing_month,
      periodStart: standard.period_start,
      periodEnd: standard.period_end,
      vendorName: standard.vendor_name,
      applicationLabel: standard.application_rule === "monthly_prorated"
        ? standard.category === "transport"
          ? standard.period_start ? "拆柜、直送按提柜周期分摊" : "拆柜、直送按提柜月份分摊"
          : standard.operation_mode === "direct_delivery"
          ? standard.period_start ? "按提柜日期周期平均分摊" : "按提柜月份平均分摊"
          : standard.period_start ? "按拆柜日期周期平均分摊" : "按拆柜月份平均分摊"
        : standard.standard_kind === "fixed"
        ? standard.operation_mode === "unload"
          ? "拆柜每柜固定计入"
          : standard.operation_mode === "direct_delivery"
          ? "直送每柜固定计入"
          : "每柜固定计入"
        : "按月登记",
      detail: standard.description,
      sourceLabel: standard.application_rule === "monthly_prorated" && !standard.period_start ? "系统月度均摊" : "本系统维护",
      editable: standard.application_rule !== "monthly_prorated" || Boolean(standard.period_start)
    }));
    const value = search.trim().toLowerCase();
    return [...systemRows, ...pickupRows, ...manualRows].filter((row) => !value || [
      row.standardName,
      row.vendorName,
      row.applicationLabel,
      row.detail,
      row.sourceLabel,
      row.billingMonth
    ].some((item) => String(item || "").toLowerCase().includes(value)));
  }, [category, customStandards, search, standardKind, transportRules, warehousePickupRules]);

  function openCreate() {
    const nextForm = emptyForm(standardKind);
    if (category === "warehouse" && standardKind === "monthly") nextForm.standardName = "仓库工资";
    if (category === "transport" && standardKind === "monthly") nextForm.standardName = "车架租金";
    setError("");
    setForm(nextForm);
    setEditorOpen(true);
  }

  function openEdit(row: StandardRow) {
    if (!row.editable || row.id == null) return;
    setError("");
    setForm({
      id: row.id,
      standardName: row.standardName,
      amount: String(row.amount),
      unit: row.unit,
      billingMonth: row.billingMonth?.slice(0, 7) || currentMonth(),
      periodStart: row.periodStart || `${row.billingMonth?.slice(0, 7) || currentMonth()}-01`,
      periodEnd: row.periodEnd || currentMonthEnd(),
      vendorName: row.vendorName || "",
      description: row.detail || ""
    });
    setEditorOpen(true);
  }

  async function saveForm(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(form.id ? `/api/expense-standards/${form.id}` : "/api/expense-standards", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          standardKind,
          standardName: form.standardName,
          amount: Number(form.amount),
          unit: standardKind === "monthly" && (category === "warehouse" || category === "transport") ? "月" : form.unit,
          billingMonth: standardKind === "monthly" ? form.billingMonth : null,
          periodStart: standardKind === "monthly" && (category === "warehouse" || category === "transport") ? form.periodStart : null,
          periodEnd: standardKind === "monthly" && (category === "warehouse" || category === "transport") ? form.periodEnd : null,
          vendorName: form.vendorName,
          description: form.description
        })
      });
      await readJson(response);
      setEditorOpen(false);
      await loadStandards(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存支出标准失败");
    } finally {
      setSaving(false);
    }
  }

  async function removeStandard(row: StandardRow) {
    if (!row.editable || row.id == null || !window.confirm(`确认删除“${row.standardName}”？`)) return;
    setError("");
    try {
      await readJson(await fetch(`/api/expense-standards/${row.id}`, { method: "DELETE" }));
      await loadStandards(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除支出标准失败");
    }
  }

  const columns = useMemo<ColumnDef<StandardRow>[]>(() => [
    {
      header: standardKind === "monthly" ? category === "domestic" ? "费用月份" : "费用周期" : "标准类型",
      cell: ({ row }) => standardKind === "monthly"
        ? <strong className="standard-month">{
          row.original.billingMonth === "每月"
            ? "每月"
            : row.original.periodStart && row.original.periodEnd
            ? `${row.original.periodStart.slice(5).replace("-", "/")} - ${row.original.periodEnd.slice(5).replace("-", "/")}`
            : row.original.billingMonth?.slice(0, 7) || "-"
        }</strong>
        : <span className="standard-type fixed_route">固定标准</span>
    },
    {
      header: "费用项目",
      cell: ({ row }) => (
        <div className="standard-name">
          <strong>{row.original.standardName}</strong>
          {row.original.vendorName ? <span className="warehouse-code">{row.original.vendorName}</span> : null}
        </div>
      )
    },
    {
      header: standardKind === "monthly" ? "登记方式" : "适用方式",
      cell: ({ row }) => <span className="application-rule">{row.original.applicationLabel}</span>
    },
    {
      header: standardKind === "monthly" ? "月度金额" : "标准金额",
      cell: ({ row }) => (
        <div className="standard-money"><strong>{money(row.original.amount)}</strong><small>/ {row.original.unit}</small></div>
      )
    },
    {
      header: "说明",
      cell: ({ row }) => <span className="standard-description">{row.original.detail || "-"}</span>
    },
    {
      header: "来源",
      cell: ({ row }) => <span className="source-tag">{row.original.sourceLabel}</span>
    },
    {
      header: "操作",
      cell: ({ row }) => row.original.editable ? (
        <div className="standard-actions">
          <button className="icon-button" title="编辑" onClick={() => openEdit(row.original)}><Pencil size={15} /></button>
          <button className="icon-button danger-icon" title="删除" onClick={() => void removeStandard(row.original)}><Trash2 size={15} /></button>
        </div>
      ) : <span className="locked-standard">系统维护</span>
    }
  ], [category, standardKind]);

  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });
  const categoryMeta = categories[category];

  return (
    <div className="operating-standards">
      <div className="standard-mode-row">
        <div className="standard-mode-switch" role="tablist" aria-label="标准方式">
          <button className={standardKind === "fixed" ? "active" : ""} onClick={() => setStandardKind("fixed")}>
            <CircleDollarSign size={17} /><span><strong>固定标准</strong><small>按柜自动计入</small></span>
          </button>
          <button className={standardKind === "monthly" ? "active" : ""} onClick={() => setStandardKind("monthly")}>
            <CalendarDays size={17} /><span><strong>月度费用</strong><small>登记与按周期均摊</small></span>
          </button>
        </div>
        <button className="button primary" onClick={openCreate}><Plus size={16} />新增{standardKind === "fixed" ? "固定标准" : "月度费用"}</button>
      </div>

      <div className="standards-toolbar">
        <div className="field">
          <label>搜索{categoryMeta.label}费用</label>
          <div className="input-with-icon"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="费用项目 / 对象 / 说明" /></div>
        </div>
        <button className="button ghost" onClick={() => setSearch("")} disabled={!search}><XCircle size={16} />清空</button>
      </div>

      {error && !editorOpen ? <div className="error" role="alert">{error}</div> : null}

      <section className="panel standards-panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">{categoryMeta.label}支出 · {standardKind === "fixed" ? "固定标准" : "月度费用"}</h2>
            <span className="panel-subtitle">共 {rows.length} 条</span>
          </div>
          {loading ? <span className="muted">正在读取</span> : null}
        </div>
        <div className="table-wrap standards-table-wrap">
          <table className="standards-table">
            <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th key={header.id}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead>
            <tbody>
              {table.getRowModel().rows.map((row) => <tr key={row.id}>{row.getVisibleCells().map((cell) => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}
              {!rows.length && !loading ? <tr><td colSpan={columns.length} className="expense-empty">暂无{categoryMeta.label}{standardKind === "fixed" ? "固定标准" : "月度费用"}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {editorOpen ? (
        <div className="standard-editor-backdrop" onMouseDown={() => !saving && setEditorOpen(false)}>
          <aside className="standard-editor" role="dialog" aria-modal="true" aria-label="支出标准编辑" onMouseDown={(event) => event.stopPropagation()}>
            <div className="standard-editor-head">
              <div><span>{categoryMeta.label}支出</span><h2>{form.id ? "编辑" : "新增"}{standardKind === "fixed" ? "固定标准" : "月度费用"}</h2></div>
              <button className="icon-button" title="关闭" onClick={() => setEditorOpen(false)} disabled={saving}><X size={17} /></button>
            </div>
            <form className="standard-editor-form" onSubmit={saveForm}>
              {error ? <div className="error" role="alert">{error}</div> : null}
              {standardKind === "monthly" && (category === "warehouse" || category === "transport") ? (
                <div className="standard-form-grid">
                  <div className="field"><label>开始日期</label><input type="date" required value={form.periodStart} onChange={(event) => setForm({ ...form, periodStart: event.target.value, billingMonth: event.target.value.slice(0, 7) })} /></div>
                  <div className="field"><label>结束日期</label><input type="date" required value={form.periodEnd} onChange={(event) => setForm({ ...form, periodEnd: event.target.value })} /></div>
                </div>
              ) : standardKind === "monthly" ? (
                <div className="field"><label>费用月份</label><input type="month" required value={form.billingMonth} onChange={(event) => setForm({ ...form, billingMonth: event.target.value })} /></div>
              ) : null}
              <div className="field">
                <label htmlFor={projectInputId}>费用项目</label>
                <input
                  id={projectInputId}
                  required
                  list={standardKind === "monthly" ? projectOptionsId : undefined}
                  value={form.standardName}
                  onChange={(event) => setForm({ ...form, standardName: event.target.value })}
                  placeholder={standardKind === "monthly" ? "选择或输入费用项目" : "例如：固定操作费"}
                />
                {standardKind === "monthly" ? (
                  <datalist id={projectOptionsId}>
                    {monthlyProjectOptions.map((name) => <option key={name} value={name} />)}
                  </datalist>
                ) : null}
              </div>
              {standardKind === "monthly" && (category === "warehouse" || category === "transport") ? (
                <div className="field"><label>月度金额</label><input type="number" min="0" step="0.01" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></div>
              ) : (
                <div className="standard-form-grid">
                  <div className="field"><label>{standardKind === "monthly" ? "月度金额" : "标准金额"}</label><input type="number" min="0" step="0.01" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></div>
                  <div className="field"><label>单位</label><input required value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} /></div>
                </div>
              )}
              <div className="field"><label>供应商 / 费用对象</label><input value={form.vendorName} onChange={(event) => setForm({ ...form, vendorName: event.target.value })} placeholder="可选" /></div>
              <div className="field"><label>说明</label><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="适用范围或计算备注" /></div>
              <div className="standard-editor-actions">
                <button type="button" className="button ghost" onClick={() => setEditorOpen(false)} disabled={saving}>取消</button>
                <button type="submit" className="button primary" disabled={saving}>{saving ? "保存中" : "保存"}</button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

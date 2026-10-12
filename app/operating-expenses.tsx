"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable
} from "@tanstack/react-table";
import {
  Building2,
  CalendarDays,
  CircleDollarSign,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  Truck,
  Warehouse,
  XCircle
} from "lucide-react";
import { money } from "@/lib/money";

type ExpenseCategory = "transport" | "warehouse" | "domestic";

type OperatingExpense = {
  id: number;
  source_order_id: number;
  container_number: string;
  expense_category: ExpenseCategory;
  item_name: string;
  amount: number;
  warehouse_point: string | null;
  vendor_name: string | null;
  expense_date: string | null;
  reference_number: string | null;
  pricing_method: "manual" | "standard";
  standard_amount: number | null;
  pricing_rule_id: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type TransportPricingRule = {
  id: number;
  rule_code: string;
  rule_name: string;
  rule_type: "fixed_route" | "amazon_warehouse";
  warehouse_point: string | null;
  amount: number;
};

type ExpenseSummary = Record<ExpenseCategory, { count: number; total: number }>;

type ExpenseForm = {
  id: number | null;
  sourceOrderId: number | null;
  containerNumber: string;
  itemName: string;
  amount: string;
  warehousePoint: string;
  vendorName: string;
  expenseDate: string;
  referenceNumber: string;
  pricingMethod: "manual" | "standard";
  standardAmount: string;
  pricingRuleId: number | null;
  notes: string;
};

const categoryMeta = {
  transport: { label: "运输支出", shortLabel: "运输", icon: Truck },
  warehouse: { label: "仓库支出", shortLabel: "仓库", icon: Warehouse },
  domestic: { label: "国内支出", shortLabel: "国内", icon: Building2 }
} satisfies Record<ExpenseCategory, { label: string; shortLabel: string; icon: typeof Truck }>;

const emptySummary: ExpenseSummary = {
  transport: { count: 0, total: 0 },
  warehouse: { count: 0, total: 0 },
  domestic: { count: 0, total: 0 }
};

function emptyForm(): ExpenseForm {
  return {
    id: null,
    sourceOrderId: null,
    containerNumber: "",
    itemName: "",
    amount: "",
    warehousePoint: "",
    vendorName: "",
    expenseDate: new Date().toISOString().slice(0, 10),
    referenceNumber: "",
    pricingMethod: "manual",
    standardAmount: "",
    pricingRuleId: null,
    notes: ""
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function toForm(item: OperatingExpense): ExpenseForm {
  return {
    id: item.id,
    sourceOrderId: item.source_order_id,
    containerNumber: item.container_number,
    itemName: item.item_name,
    amount: String(item.amount),
    warehousePoint: item.warehouse_point || "",
    vendorName: item.vendor_name || "",
    expenseDate: item.expense_date || "",
    referenceNumber: item.reference_number || "",
    pricingMethod: item.pricing_method,
    standardAmount: item.standard_amount == null ? "" : String(item.standard_amount),
    pricingRuleId: item.pricing_rule_id,
    notes: item.notes || ""
  };
}

export default function OperatingExpenses() {
  const [category, setCategory] = useState<ExpenseCategory>("transport");
  const [items, setItems] = useState<OperatingExpense[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary>(emptySummary);
  const [pricingRules, setPricingRules] = useState<TransportPricingRule[]>([]);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);
  const [form, setForm] = useState<ExpenseForm>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestSeq = useRef(0);

  const loadExpenses = useCallback(async (
    nextPage = page,
    nextPageSize = pageSize,
    nextCategory = category
  ) => {
    const requestId = ++requestSeq.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        category: nextCategory,
        page: String(nextPage),
        pageSize: String(nextPageSize)
      });
      if (search.trim()) params.set("search", search.trim());
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const data = await readJson<{
        items: OperatingExpense[];
        totalCount: number;
        summary: ExpenseSummary;
      }>(await fetch(`/api/operating-expenses?${params}`));
      if (requestId !== requestSeq.current) return;
      setItems(data.items);
      setTotalCount(data.totalCount);
      setSummary(data.summary);
      setPage(nextPage);
      setPageSize(nextPageSize);
    } catch (err) {
      if (requestId === requestSeq.current) {
        setError(err instanceof Error ? err.message : "读取运营支出失败");
      }
    } finally {
      if (requestId === requestSeq.current) setLoading(false);
    }
  }, [category, dateFrom, dateTo, page, pageSize, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadExpenses(1), 250);
    return () => window.clearTimeout(timer);
  }, [category, dateFrom, dateTo, search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void fetch("/api/transport-pricing")
      .then((response) => readJson<{ rules: TransportPricingRule[] }>(response))
      .then((data) => setPricingRules(data.rules))
      .catch((err) => setError(err instanceof Error ? err.message : "读取运输定价失败"));
  }, []);

  function applyPricingRule(value: string) {
    if (!value) {
      setForm({
        ...form,
        pricingRuleId: null,
        pricingMethod: "manual",
        standardAmount: ""
      });
      return;
    }
    const rule = pricingRules.find((item) => item.id === Number(value));
    if (!rule) return;
    setForm({
      ...form,
      pricingRuleId: rule.id,
      pricingMethod: "standard",
      standardAmount: String(rule.amount),
      itemName: rule.rule_name,
      amount: String(rule.amount),
      warehousePoint: rule.warehouse_point || ""
    });
  }

  async function saveExpense() {
    if (!form.containerNumber.trim() || !form.itemName.trim() || !form.amount) {
      setError("柜号、支出项目和金额不能为空");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = {
        sourceOrderId: form.sourceOrderId,
        containerNumber: form.containerNumber,
        category,
        itemName: form.itemName,
        amount: Number(form.amount),
        warehousePoint: form.warehousePoint,
        vendorName: form.vendorName,
        expenseDate: form.expenseDate,
        referenceNumber: form.referenceNumber,
        pricingMethod: form.pricingMethod,
        standardAmount: form.standardAmount ? Number(form.standardAmount) : null,
        pricingRuleId: form.pricingRuleId,
        notes: form.notes
      };
      await readJson(
        await fetch(form.id ? `/api/operating-expenses/${form.id}` : "/api/operating-expenses", {
          method: form.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
      );
      setForm(emptyForm());
      await loadExpenses(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存运营支出失败");
    } finally {
      setLoading(false);
    }
  }

  async function deleteExpense(id: number) {
    if (!window.confirm("确认删除这笔支出记录？")) return;
    setLoading(true);
    setError("");
    try {
      await readJson(await fetch(`/api/operating-expenses/${id}`, { method: "DELETE" }));
      if (form.id === id) setForm(emptyForm());
      await loadExpenses(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除运营支出失败");
    } finally {
      setLoading(false);
    }
  }

  const columns = useMemo<ColumnDef<OperatingExpense>[]>(() => [
    {
      header: "柜号",
      cell: ({ row }) => <strong className="expense-container-number">{row.original.container_number}</strong>
    },
    { header: "支出项目", accessorKey: "item_name" },
    ...(category === "transport" ? [{
      header: "仓点",
      cell: ({ row }: { row: { original: OperatingExpense } }) => row.original.warehouse_point || "-"
    }] : []),
    {
      header: "供应商 / 收款方",
      cell: ({ row }) => row.original.vendor_name || "-"
    },
    {
      header: "支出日期",
      cell: ({ row }) => row.original.expense_date || "-"
    },
    {
      header: "金额",
      cell: ({ row }) => <strong className="expense-amount">{money(row.original.amount)}</strong>
    },
    {
      header: "参考号",
      cell: ({ row }) => row.original.reference_number || "-"
    },
    {
      header: "备注",
      cell: ({ row }) => <span className="expense-note" title={row.original.notes || ""}>{row.original.notes || "-"}</span>
    },
    {
      header: "操作",
      cell: ({ row }) => (
        <div className="expense-row-actions">
          <button className="icon-button" title="编辑" aria-label="编辑" onClick={() => setForm(toForm(row.original))}>
            <Pencil size={15} />
          </button>
          <button className="icon-button danger-icon" title="删除" aria-label="删除" onClick={() => void deleteExpense(row.original.id)}>
            <Trash2 size={15} />
          </button>
        </div>
      )
    }
  ], [category, form.id, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel() });
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const pageStart = totalCount ? (page - 1) * pageSize + 1 : 0;
  const pageEnd = Math.min(page * pageSize, totalCount);

  return (
    <div className="operating-expenses">
      <div className="expense-category-bar" role="tablist" aria-label="支出分类">
        {(Object.keys(categoryMeta) as ExpenseCategory[]).map((key) => {
          const meta = categoryMeta[key];
          const Icon = meta.icon;
          return (
            <button
              key={key}
              className={`expense-category ${category === key ? "active" : ""}`}
              onClick={() => {
                setCategory(key);
                setPage(1);
                setForm(emptyForm());
              }}
              role="tab"
              aria-selected={category === key}
            >
              <span className="expense-category-icon"><Icon size={18} /></span>
              <span><strong>{meta.label}</strong><small>{summary[key].count} 笔</small></span>
              <b>{money(summary[key].total)}</b>
            </button>
          );
        })}
      </div>

      <div className="expense-filters">
        <div className="field expense-search-field">
          <label>搜索</label>
          <div className="input-with-icon">
            <Search size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="柜号 / 支出项目 / 仓点 / 供应商 / 参考号" />
          </div>
        </div>
        <div className="field">
          <label>开始日期</label>
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </div>
        <div className="field">
          <label>结束日期</label>
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </div>
        <button
          className="button ghost expense-clear"
          onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); setPage(1); }}
          title="清空筛选"
        >
          <XCircle size={16} />清空
        </button>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <div className="expense-workspace">
        <section className="panel expense-ledger">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">{categoryMeta[category].label}台账</h2>
              <span className="panel-subtitle">共 {totalCount} 笔，合计 {money(summary[category].total)}</span>
            </div>
            {loading ? <span className="muted">正在更新</span> : null}
          </div>
          <div className="table-wrap expense-table-wrap">
            <table className="expense-table">
              <thead>
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>{group.headers.map((header) => (
                    <th key={header.id}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</th>
                  ))}</tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className={form.id === row.original.id ? "selected" : ""}>
                    {row.getVisibleCells().map((cell) => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
                  </tr>
                ))}
                {!items.length ? <tr><td className="expense-empty" colSpan={columns.length}>暂无{categoryMeta[category].label}记录</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span className="pagination-info">显示 {pageStart}-{pageEnd} / {totalCount}</span>
            <select className="page-size" value={pageSize} onChange={(event) => void loadExpenses(1, Number(event.target.value))}>
              <option value={25}>25 / 页</option><option value={50}>50 / 页</option><option value={100}>100 / 页</option>
            </select>
            <button className="button ghost" disabled={loading || page <= 1} onClick={() => void loadExpenses(page - 1)}>上一页</button>
            <span className="page-current">{page} / {totalPages}</span>
            <button className="button ghost" disabled={loading || page >= totalPages} onClick={() => void loadExpenses(page + 1)}>下一页</button>
          </div>
        </section>

        <aside className="panel expense-editor">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">{form.id ? "编辑支出" : `新增${categoryMeta[category].shortLabel}支出`}</h2>
              <span className="panel-subtitle">{categoryMeta[category].label}</span>
            </div>
            <button className="icon-button" title="新建" aria-label="新建" onClick={() => setForm(emptyForm())}><Plus size={17} /></button>
          </div>
          <div className="expense-form">
            <div className="field wide"><label>柜号 *</label><input value={form.containerNumber} disabled={Boolean(form.id)} onChange={(event) => setForm({ ...form, containerNumber: event.target.value.toUpperCase() })} placeholder="例如 EGSU6183230" /></div>
            {category === "transport" ? (
              <div className="field wide">
                <label>运输计费项目 *</label>
                <select value={form.pricingRuleId || ""} onChange={(event) => applyPricingRule(event.target.value)}>
                  <option value="">手动录入</option>
                  <optgroup label="固定路线">
                    {pricingRules.filter((rule) => rule.rule_type === "fixed_route").map((rule) => (
                      <option key={rule.id} value={rule.id}>{rule.rule_name} · {money(rule.amount)}</option>
                    ))}
                  </optgroup>
                  <optgroup label="亚马逊仓点">
                    {pricingRules.filter((rule) => rule.rule_type === "amazon_warehouse").map((rule) => (
                      <option key={rule.id} value={rule.id}>{rule.warehouse_point || rule.rule_name} · {money(rule.amount)}</option>
                    ))}
                  </optgroup>
                </select>
              </div>
            ) : null}
            <div className="field wide"><label>支出项目 *</label><input value={form.itemName} disabled={category === "transport" && Boolean(form.pricingRuleId)} onChange={(event) => setForm({ ...form, itemName: event.target.value })} placeholder={category === "transport" ? "例如 派送费 / 车架费" : category === "warehouse" ? "例如 卸柜费 / 仓储费" : "例如 国内采购 / 手续费"} /></div>
            {category === "transport" ? <div className="field wide"><label>仓点</label><input value={form.warehousePoint} disabled={Boolean(form.pricingRuleId)} onChange={(event) => setForm({ ...form, warehousePoint: event.target.value })} placeholder="目的仓点" /></div> : null}
            <div className="field"><label>金额 *</label><div className="money-input"><span>$</span><input type="number" min="0" step="0.01" disabled={category === "transport" && Boolean(form.pricingRuleId)} value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0.00" /></div></div>
            <div className="field"><label>支出日期</label><input type="date" value={form.expenseDate} onChange={(event) => setForm({ ...form, expenseDate: event.target.value })} /></div>
            <div className="field wide"><label>供应商 / 收款方</label><input value={form.vendorName} onChange={(event) => setForm({ ...form, vendorName: event.target.value })} /></div>
            <div className="field"><label>参考号</label><input value={form.referenceNumber} onChange={(event) => setForm({ ...form, referenceNumber: event.target.value })} placeholder="账单号 / 付款号" /></div>
            <div className="field"><label>计价方式</label><input value={form.pricingMethod === "standard" ? "标准计价" : "手动录入"} disabled /></div>
            <div className="field wide"><label>备注</label><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></div>
            <div className="expense-form-actions">
              <button className="button primary" onClick={() => void saveExpense()} disabled={loading}><Save size={16} />保存支出</button>
              <button className="button ghost" onClick={() => setForm(emptyForm())}><Plus size={16} />新建</button>
            </div>
            <div className="expense-form-meta"><CalendarDays size={14} /><span>支出将按柜号计入单柜盈收</span><CircleDollarSign size={14} /></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

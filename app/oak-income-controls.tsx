"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Banknote, Pencil, Plus, RotateCcw, Save, Search, Trash2, X } from "lucide-react";
import { incomeWorkLabel, type IncomeRule, type IncomeSummary } from "@/lib/oak-income";
import type { DriverDay, DriverTask } from "@/lib/oak-driver-types";

export const incomeMoney = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
export async function json<T>(response: Response): Promise<T> {
  const data = await response.json(); if (!response.ok) throw new Error(data.error || "请求失败"); return data;
}
export function IncomeTotal({ value }: { value?: IncomeSummary }) {
  return <div className="oak-income-total"><strong>{value?.pricedCount ? incomeMoney(value.amount) : "—"}</strong><small>{value ? <>{value.pricedCount} 段已计价{value.includedCount ? ` · ${value.includedCount} 段已并入` : ""}</> : "未计价"}</small>{value?.pendingCount ? <span className="oak-income-pending">{value.pendingCount} 段待计价</span> : null}</div>;
}
export function IncomeDialog({ title, busy, onClose, children, wide = false }: { title: string; busy: boolean; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("input, select, button")?.focus();
    return () => { document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const top = Array.from(document.querySelectorAll<HTMLElement>("[data-income-dialog]")).filter(element => element.getClientRects().length).at(-1);
      if (top !== ref.current) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }
      if (event.key !== "Tab") return;
      event.stopPropagation();
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), a[href]") || []).filter(item => item.getClientRects().length);
      const first = items[0]; const last = items.at(-1);
      if (!ref.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [busy, onClose]);
  return <div className="oak-income-backdrop" onMouseDown={() => !busy && onClose()}><section ref={ref} className={`oak-income-dialog${wide ? " oak-workflow-dialog" : ""}`} data-income-dialog role="dialog" aria-modal="true" aria-label={title} onMouseDown={event => event.stopPropagation()}><header className="oak-dialog-head"><div><span>OAK 运输部核算</span><h2>{title}</h2></div><button className="icon-button" title="关闭编辑窗口" disabled={busy} onClick={onClose}><X size={17} /></button></header>{children}</section></div>;
}

type RuleForm = { id: number | null; name: string; workLabel: string; fromLocation: string; toLocation: string; amount: string; billingBasis: "segment" | "trip"; validFrom: string; validTo: string; active: boolean };
const newRule = (): RuleForm => ({ id: null, name: "", workLabel: "", fromLocation: "", toLocation: "", amount: "", billingBasis: "segment", validFrom: "", validTo: "", active: true });
export function OakIncomeRules({ onChange }: { onChange: () => void }) {
  const [data, setData] = useState<{ rules: IncomeRule[]; workLabels: string[] }>({ rules: [], workLabels: [] });
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [formError, setFormError] = useState("");
  const [form, setForm] = useState<RuleForm | null>(null); const [search, setSearch] = useState("");
  async function load() { setLoading(true); try { setData(await json(await fetch("/api/oak-income-rules", { cache: "no-store" }))); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "读取收入标准失败"); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  function edit(value: RuleForm) { setFormError(""); setForm(value); }
  async function save() {
    if (!form) return; setBusy(true); setFormError("");
    try {
      await json(await fetch(`/api/oak-income-rules${form.id ? `/${form.id}` : ""}`, { method: form.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }));
      setForm(null); await load(); onChange();
    } catch (e) { setFormError(e instanceof Error ? e.message : "保存失败"); } finally { setBusy(false); }
  }
  async function remove(rule: IncomeRule) {
    if (!window.confirm(`删除收入标准“${rule.name}”？相关作业将重新匹配收入。`)) return;
    setBusy(true); try { await json(await fetch(`/api/oak-income-rules/${rule.id}`, { method: "DELETE" })); await load(); onChange(); } catch (e) { setError(e instanceof Error ? e.message : "删除失败"); } finally { setBusy(false); }
  }
  const shown = data.rules.filter(rule => [rule.name, rule.workLabel, rule.fromLocation, rule.toLocation].filter(Boolean).join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="oak-income-rules">
    <div className="oak-driver-actions"><div><h2>收入计价标准</h2><span className="muted">USD · 作业收入</span></div><button className="button primary" disabled={loading || busy} onClick={() => edit(newRule())}><Plus size={16} />新增收入标准</button></div>
    <div className="input-with-icon oak-income-rule-search"><Search size={15} /><input aria-label="搜索收入标准" placeholder="作业名称、起点或终点" value={search} onChange={event => setSearch(event.target.value)} /></div>
    {error ? <div className="error" role="alert">{error}<button className="button ghost" onClick={() => void load()}>重试</button></div> : null}
    <div className="oak-income-rule-scroll table-wrap"><table className="oak-income-rules-table" aria-label="收入计价标准" aria-busy={loading}><thead><tr><th>收入项目 / 作业</th><th>适用路线</th><th className="oak-numeric">收入单价 / USD</th><th>计价口径</th><th>生效日期</th><th>状态</th><th>操作</th></tr></thead><tbody>{shown.map(rule => <tr key={rule.id}><td><strong>{rule.name}</strong><small>{rule.workLabel}</small></td><td>{rule.fromLocation || "任意起点"} → {rule.toLocation || "任意终点"}</td><td className="oak-income-amount oak-numeric">{incomeMoney(rule.amount)}</td><td>{rule.billingBasis === "trip" ? "整趟（含回程）" : "单段"}</td><td>{rule.validFrom || "不限开始"}<small>至 {rule.validTo || "不限结束"}</small></td><td><span className={`oak-income-status ${rule.active ? "priced" : "inactive"}`}>{rule.active ? "启用" : "停用"}</span></td><td><div className="oak-income-row-actions"><button className="icon-button" title={`编辑收入标准 ${rule.name}`} disabled={busy} onClick={() => edit({ ...rule, fromLocation: rule.fromLocation || "", toLocation: rule.toLocation || "", amount: String(rule.amount), validFrom: rule.validFrom || "", validTo: rule.validTo || "" })}><Pencil size={15} /></button><button className="icon-button danger-icon" title={`删除收入标准 ${rule.name}`} disabled={busy} onClick={() => void remove(rule)}><Trash2 size={15} /></button></div></td></tr>)}{!shown.length ? <tr><td colSpan={7} className="oak-empty-cell"><Banknote size={28} />{loading ? "正在读取收入标准..." : data.rules.length ? "无匹配收入标准" : "暂无收入计价标准"}</td></tr> : null}</tbody></table></div>
    {form ? <IncomeDialog title={form.id ? "编辑收入标准" : "新增收入标准"} busy={busy} onClose={() => setForm(null)}><form className="oak-income-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="oak-income-fields">
        {formError ? <div className="error" role="alert">{formError}</div> : null}
        <label className="field">收入项目名称<input required maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
        <label className="field">匹配作业名称<input required list="oak-income-work-labels" maxLength={120} value={form.workLabel} onChange={e => setForm({ ...form, workLabel: e.target.value })} placeholder="如：提柜、TCY2直送" /></label><datalist id="oak-income-work-labels">{data.workLabels.map(label => <option key={label} value={label} />)}</datalist>
        <div className="oak-income-field-pair"><label className="field">起点（可选）<input maxLength={100} placeholder="如 SFO" value={form.fromLocation} onChange={e => setForm({ ...form, fromLocation: e.target.value })} /></label><label className="field">终点（可选）<input maxLength={100} placeholder="如 95215" value={form.toLocation} onChange={e => setForm({ ...form, toLocation: e.target.value })} /></label></div>
        <div className="oak-income-field-pair"><label className="field">作业收入单价 / USD<input required type="number" min="0" max="9999999999.99" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></label><label className="field">计价口径<select aria-label="计价口径" value={form.billingBasis} onChange={e => setForm({ ...form, billingBasis: e.target.value as "segment" | "trip" })}><option value="segment">单段作业收入</option><option value="trip">整趟收入（含回程）</option></select></label></div>
        <div className="oak-income-field-pair"><label className="field">生效开始（可选）<input type="date" value={form.validFrom} onChange={e => setForm({ ...form, validFrom: e.target.value })} /></label><label className="field">生效结束（可选）<input type="date" min={form.validFrom} value={form.validTo} onChange={e => setForm({ ...form, validTo: e.target.value })} /></label></div>
        <label className="oak-income-checkbox"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />启用此收入标准</label>
      </div><footer className="oak-dialog-actions"><button type="button" className="button ghost" disabled={busy} onClick={() => setForm(null)}>取消</button><button type="submit" className="button primary" disabled={busy}><Save size={15} />{busy ? "保存中..." : "保存收入标准"}</button></footer>
    </form></IncomeDialog> : null}
  </div>;
}

export function IncomeReviewDialog({ task, day, onClose, onSaved }: { task: DriverTask; day: DriverDay; onClose: () => void; onSaved: () => Promise<void> }) {
  const [mode, setMode] = useState(task.income?.review?.mode || "label");
  const [workLabel, setWorkLabel] = useState(task.income?.workLabel || incomeWorkLabel(task) || "");
  const [amount, setAmount] = useState(task.income?.review?.amount == null ? "" : String(task.income.review.amount));
  const [includedTaskId, setIncludedTaskId] = useState(task.income?.review?.includedTaskId || "");
  const [note, setNote] = useState(task.income?.review?.note || ""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [anchors, setAnchors] = useState<DriverTask[]>(day.tasks.filter(candidate => candidate.id && candidate.id !== task.id && candidate.importId === task.importId && candidate.income?.status === "priced" && (candidate.income.billingBasis === "trip" || candidate.income.source === "manual")));
  const [anchorsLoading, setAnchorsLoading] = useState(false);
  useEffect(() => {
    if (mode !== "included") return;
    const controller = new AbortController(); setAnchorsLoading(true);
    void fetch(`/api/oak-task-income/${task.id}`, { cache: "no-store", signal: controller.signal }).then(response => json<{ anchors: DriverTask[] }>(response))
      .then(result => { if (!controller.signal.aborted) setAnchors(result.anchors); })
      .catch(() => { if (!controller.signal.aborted) setError("读取主作业失败，请重选核对方式后重试"); })
      .finally(() => { if (!controller.signal.aborted) setAnchorsLoading(false); });
    return () => controller.abort();
  }, [mode, task.id]);
  async function save(reset = false) {
    setBusy(true); setError("");
    try {
      await json(await fetch(`/api/oak-task-income/${task.id}`, { method: reset ? "DELETE" : "PUT", headers: { "Content-Type": "application/json" }, ...(!reset ? { body: JSON.stringify({ mode, workLabel, amount, includedTaskId, note }) } : {}) }));
      await onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); } finally { setBusy(false); }
  }
  return <IncomeDialog title="核对作业收入" busy={busy} onClose={onClose}><form className="oak-income-form" onSubmit={event => { event.preventDefault(); void save(); }}><div className="oak-income-fields">
    <div className="oak-income-task-context"><strong>{task.driverName} · {task.workDate}</strong><span>{task.reference || "无参考号"} · {task.fromLocation || "未知起点"} → {task.toLocation || "未知终点"}</span><small>{task.fileName} · {task.sheetName} · 原表第 {task.sourceRow} 行</small></div>
    {error ? <div className="error" role="alert">{error}</div> : null}
    <label className="field">核对方式<select aria-label="核对方式" value={mode} onChange={e => { setError(""); setMode(e.target.value as typeof mode); }}><option value="label">确认作业名称，按收入标准计价</option><option value="manual">人工核定作业收入</option><option value="included">收入已含在另一段作业中</option></select></label>
    <label className="field">作业名称<input required={mode === "label"} maxLength={120} value={workLabel} onChange={e => setWorkLabel(e.target.value)} placeholder="如：还柜、TCY2直送" /></label>
    {mode === "manual" ? <label className="field">作业收入 / USD<input required type="number" min="0" max="9999999999.99" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label> : null}
    {mode === "included" ? <label className="field">收入所属主作业<select aria-label="收入所属主作业" required disabled={anchorsLoading} value={includedTaskId} onChange={e => setIncludedTaskId(e.target.value)}><option value="">{anchorsLoading ? "正在读取整趟作业..." : "选择同批次、同司机的整趟作业"}</option>{anchors.map(anchor => <option key={anchor.id} value={anchor.id}>{anchor.workDate} · {anchor.income?.workLabel || "作业"} · {anchor.reference || `第 ${anchor.sourceRow} 行`} · {anchor.fromLocation} → {anchor.toLocation} · {incomeMoney(anchor.income!.amount!)}</option>)}</select></label> : null}
    <label className="field">核对备注{mode !== "label" ? "（必填）" : "（可选）"}<textarea required={mode !== "label"} maxLength={1000} rows={3} value={note} onChange={e => setNote(e.target.value)} /></label>
  </div><footer className="oak-dialog-actions">{task.income?.review ? <button type="button" className="button ghost oak-income-reset" disabled={busy} onClick={() => { if (window.confirm("清除这段作业的收入核对，恢复按原表自动匹配？")) void save(true); }}><RotateCcw size={15} />恢复自动</button> : null}<button type="button" className="button ghost" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={busy || (mode === "included" && anchorsLoading)}><Save size={15} />{busy ? "保存中..." : "保存核对"}</button></footer></form></IncomeDialog>;
}

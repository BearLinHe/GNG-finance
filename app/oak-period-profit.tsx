"use client";

import { useState } from "react";
import { Info, Plus, Save, Trash2, X } from "lucide-react";
import { IncomeDialog, incomeMoney, json } from "./oak-income-controls";
import type { PeriodProfit, ProfitSummary } from "@/lib/oak-period-profit";
import type { PayeeType } from "@/lib/oak-payee";

const statusLabels = { profit: "盈利", loss: "亏损", even: "持平", pending: "待核对" };
export function ProfitResult({ profit }: { profit?: PeriodProfit }) {
  if (!profit) return <span className="muted">—</span>;
  return <div className={`oak-profit-result ${profit.status}`}><strong>{profit.net == null ? "—" : incomeMoney(profit.net)}</strong><span>{statusLabels[profit.status]}</span>{profit.issues.length ? <small title={profit.issues.join("；")}>{profit.issues.join("；")}</small> : null}</div>;
}
export function ProfitOverview({ summary, busy }: { summary?: ProfitSummary; busy: boolean }) {
  return <div className="oak-profit-overview" aria-label="周期盈亏汇总" aria-busy={busy}>
    <div><span>已核对周期盈亏 / USD</span><strong className={summary && summary.netAmount < 0 ? "loss" : "profit"}>{summary?.completeCount ? incomeMoney(summary.netAmount) : "—"}</strong><small>{summary?.completeCount || 0} 个已核对</small></div>
    <div><span>盈利</span><strong className="profit">{summary?.profitCount || 0}<small>个</small></strong></div>
    <div><span>亏损</span><strong className="loss">{summary?.lossCount || 0}<small>个</small></strong></div>
    <div><span>持平 / 待核对</span><strong>{summary?.evenCount || 0}<small>/</small><b className="pending">{summary?.pendingCount || 0}</b></strong></div>
  </div>;
}
export function PeriodCostDialog({ profit, onClose, onSaved }: { profit: PeriodProfit; onClose: () => void; onSaved: () => Promise<void> }) {
  const review = profit.review;
  const [payeeType, setPayeeType] = useState<PayeeType | "">(profit.payeeType || review?.payeeType || "");
  const [mode, setMode] = useState<"settlements" | "manual">(review?.laborMode || "settlements");
  const [amount, setAmount] = useState(review?.laborAmount == null ? "" : String(review.laborAmount));
  const [expenses, setExpenses] = useState(() => review?.expenses.map(item => ({ title: item.title, amount: String(item.amount) })) || []);
  const [confirmed, setConfirmed] = useState(Boolean(review && !profit.staleReview));
  const [note, setNote] = useState(review?.note || "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const payLabel = payeeType === "owner" ? "车主价格" : payeeType === "driver" ? "司机工资" : "工资／车主价格";
  async function save(remove = false) {
    if (remove && !window.confirm("撤销本周期成本核对？历史变更记录会保留，盈亏将重新标记为待核对。")) return;
    setBusy(true); setError(""); let saved = false;
    try {
      await json(await fetch("/api/oak-period-costs", { method: remove ? "DELETE" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...profit.scope, payeeType, laborMode: mode, laborAmount: mode === "manual" ? amount : null,
          expenses, expensesConfirmed: confirmed, note, taskHash: profit.taskHash, version: review?.version || 0 }) }));
      saved = true; await onSaved(); onClose();
    } catch (e) { setError(saved ? "成本已保存，但刷新失败，请关闭后刷新，勿重复登记。" : (e as Error).message); } finally { setBusy(false); }
  }
  const otherAmount = expenses.every(item => item.amount !== "" && Number.isFinite(Number(item.amount))) ? expenses.reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0) / 100 : null;
  const laborAmount = mode === "manual" ? amount !== "" && Number.isFinite(Number(amount)) ? Number(amount) : null : profit.settlementLaborAmount;
  const previewNet = !profit.income.pendingCount && laborAmount != null && otherAmount != null && confirmed ? (Math.round(profit.income.amount * 100) - Math.round(laborAmount * 100) - Math.round(otherAmount * 100)) / 100 : null;
  return <IncomeDialog title="周期成本与盈亏" busy={busy} onClose={onClose} wide><form className="oak-income-form" onSubmit={event => { event.preventDefault(); void save(); }}><div className="oak-income-fields">
    <div className="oak-workflow-context"><strong>{profit.scope.subject}</strong><span>{profit.scope.dateFrom} 至 {profit.scope.dateTo} · {profit.scope.importId ? "当前导入批次" : "全部导入批次"}</span><span>{profit.taskCount} 段作业 · 已计价收入 {profit.income.pricedCount || profit.income.includedCount ? incomeMoney(profit.income.amount) : "—"}{profit.income.pendingCount ? ` · ${profit.income.pendingCount} 段待计价` : ""}</span></div>
    {error ? <div className="error" role="alert">{error}</div> : null}
    {profit.staleReview ? <div className="oak-batch-notice">作业范围已变化，原成本仅供核对，尚未用于本次盈亏。</div> : null}
    <div className="oak-income-field-pair"><label className="field">报酬类型<select required aria-label="报酬类型" value={payeeType} onChange={event => setPayeeType(event.target.value as PayeeType)}><option value="">请选择</option>{(!profit.payeeType || profit.payeeType === "driver") ? <option value="driver">司机工资</option> : null}{(!profit.payeeType || profit.payeeType === "owner") ? <option value="owner">车主价格</option> : null}</select></label><label className="field">报酬成本来源<select aria-label="报酬成本来源" value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="settlements">已确认周结算</option><option value="manual">人工核定本周期报酬</option></select></label></div>
    {mode === "manual" ? <label className="field">本周期{payLabel} / USD<input required aria-label={`本周期${payLabel} / USD`} type="number" min="0" max="9999999999.99" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label> : <div className="oak-profit-labor">
      <span>{payLabel}（扣款前）<span title="按完整匹配的已确认周结算取基本报酬加补贴；预支、还款等扣款与付款进度不抵减经营成本。"><Info size={14} aria-label="报酬成本口径" role="img" /></span></span>
      <strong>{laborAmount == null ? "待核对" : incomeMoney(laborAmount)}</strong><small>已覆盖 {profit.coveredTaskCount} / {profit.taskCount} 段作业</small>
      {profit.settlements.map(item => <small key={item.id}>#{item.id} · {item.from} 至 {item.to} · {incomeMoney(item.amount)}</small>)}
      {laborAmount == null ? <span className="pending">周结算未完整覆盖本周期；不足整周的报酬需人工核定。</span> : null}
    </div>}
    <div className="oak-settlement-adjustment-head"><strong>车辆费用 / USD</strong><button type="button" className="button ghost" disabled={expenses.length >= 40} onClick={() => { setExpenses([...expenses, { title: "", amount: "" }]); setConfirmed(false); }}><Plus size={14} />添加费用</button></div>
    {expenses.map((item, index) => <div className="oak-profit-expense" key={index}><input required maxLength={120} aria-label={`车辆费用 ${index + 1} 名称`} placeholder="油费、路桥费、维修等" value={item.title} onChange={event => { setExpenses(expenses.map((value, i) => i === index ? { ...value, title: event.target.value } : value)); setConfirmed(false); }} /><input required type="number" min="0" max="9999999999.99" step="0.01" aria-label={`车辆费用 ${index + 1} 金额`} value={item.amount} onChange={event => { setExpenses(expenses.map((value, i) => i === index ? { ...value, amount: event.target.value } : value)); setConfirmed(false); }} /><button className="icon-button" type="button" title={`移除车辆费用 ${index + 1}`} onClick={() => { setExpenses(expenses.filter((_, i) => i !== index)); setConfirmed(false); }}><X size={14} /></button></div>)}
    <label className="oak-profit-confirm"><input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{expenses.length ? "本周期车辆费用已核对完整，未与报酬重复登记" : "已确认本周期没有额外车辆费用"}</label>
    <label className="field">成本核对依据<textarea required maxLength={1000} rows={3} value={note} onChange={event => setNote(event.target.value)} /></label>
    <div className="oak-settlement-total"><span>作业收入 − {payLabel} − 车辆费用</span><strong className={previewNet != null && previewNet < 0 ? "loss" : ""}>{previewNet == null ? "待核对" : `本次核对盈亏 ${incomeMoney(previewNet)}`}</strong></div>
  </div><footer className="oak-dialog-actions">{review ? <button type="button" className="icon-button danger-icon oak-income-reset" title="撤销周期成本核对" disabled={busy} onClick={() => void save(true)}><Trash2 size={16} /></button> : null}<button type="button" className="button ghost" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={busy || !payeeType}><Save size={15} />{busy ? "保存中..." : "保存成本核对"}</button></footer></form></IncomeDialog>;
}

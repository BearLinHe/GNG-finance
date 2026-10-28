"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Layers3, Save } from "lucide-react";
import type { DriverTask } from "@/lib/oak-driver-types";
import { driverTaskLabel } from "@/lib/oak-driver-types";
import { transportJobs } from "@/lib/oak-workflow";
import { IncomeDialog, incomeMoney, json } from "./oak-income-controls";

export default function OakTransportJobs({ tasks, busy, onSaved }: { tasks: DriverTask[]; busy: boolean; onSaved: () => Promise<void> }) {
  const jobs = useMemo(() => transportJobs(tasks), [tasks]);
  const [filter, setFilter] = useState("all"); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ id: string; tasks: DriverTask[]; lockedTaskIds: string[] } | null>(null);
  const [selected, setSelected] = useState<string[]>([]); const [note, setNote] = useState(""); const [confirmed, setConfirmed] = useState(false); const [saving, setSaving] = useState(false);
  async function open(id: string) {
    setLoading(true); setError("");
    try {
      const result = await json<{ tasks: DriverTask[]; lockedTaskIds: string[] }>(await fetch(`/api/oak-transport-jobs/${id}`, { cache: "no-store" }));
      if (!result.tasks.some(task => task.id === id)) throw new Error("主作业不存在，请刷新");
      const children = result.tasks.filter(task => task.income?.review?.mode === "included" && task.income.includedTaskId === id);
      setSelected([id, ...children.map(task => task.id!)]); setNote(children[0]?.income?.review?.note || ""); setConfirmed(false); setEditing({ id, tasks: result.tasks, lockedTaskIds: result.lockedTaskIds });
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  async function save() {
    if (!editing) return; setSaving(true); setError("");
    try {
      await json(await fetch(`/api/oak-transport-jobs/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskIds: selected, note, confirmed }) }));
      await onSaved(); setEditing(null);
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  const shown = jobs.filter(job => filter === "all" || (filter === "grouped" ? job.legs.length > 1 : job.legs.length === 1));
  const primary = editing?.tasks.find(task => task.id === editing.id);
  const locked = Boolean(editing && selected.some(id => editing.lockedTaskIds.includes(id)));
  return <div className="oak-jobs-panel">
    <div className="oak-job-controls"><span>当前筛选：{jobs.length} 个任务 · {tasks.length} 段作业</span><select aria-label="任务归集状态" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部任务</option><option value="grouped">已归集多段</option><option value="single">单段 / 待归集</option></select></div>
    {error && !editing ? <div className="error" role="alert">{error}</div> : null}
    <div className={`table-wrap oak-jobs-scroll${!shown.length ? " is-empty" : ""}`}><table className="oak-jobs-table" aria-label="运输任务归集" aria-busy={busy}><thead><tr><th>主作业 / 收入归属</th><th>司机 / 日期</th><th>路线与路段</th><th className="oak-numeric">整趟收入 / USD</th><th>归集</th></tr></thead><tbody>{shown.map(job => <tr key={job.id}><td><strong>{job.primary ? driverTaskLabel(job.primary) : "主作业在筛选范围外"}</strong><small>{job.primary?.reference || `主作业 #${job.id}`}</small><span className={`oak-income-status ${job.legs.length > 1 ? "included" : "pending"}`}>{job.legs.length > 1 ? "多段任务" : "单段 / 待归集"}</span></td><td>{job.subject}<small>{job.dateFrom}{job.dateFrom !== job.dateTo ? ` 至 ${job.dateTo}` : ""}</small></td><td><details><summary>{job.legs.length} 段 · {job.miles == null ? "—" : job.miles.toLocaleString("en-US")} mi</summary><ol className="oak-job-leg-list">{job.legs.map(leg => <li key={leg.id}><span>{leg.workDate} · {driverTaskLabel(leg)}</span><b>{leg.fromLocation || "?"}<ArrowRight size={12} />{leg.toLocation || "?"}</b><small>{leg.reference || "无参考号"}</small></li>)}</ol></details></td><td className="oak-numeric"><strong className="oak-income-amount">{job.amount == null ? "待计价" : incomeMoney(job.amount)}</strong></td><td><button className="icon-button" title={`归集任务 ${job.primary?.reference || job.id}`} disabled={busy || loading} onClick={() => void open(job.id)}><Layers3 size={16} /></button></td></tr>)}{!shown.length ? <tr><td colSpan={5} className="oak-empty-cell">{busy ? "正在读取任务..." : "暂无符合条件的任务"}</td></tr> : null}</tbody></table></div>
    {editing ? <IncomeDialog title="归集运输任务" wide busy={saving} onClose={() => setEditing(null)}><form className="oak-job-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="oak-workflow-context"><strong>主作业：{primary ? driverTaskLabel(primary) : ""} · {primary?.reference}</strong><span>{primary?.driverName} · {primary?.workDate} · 收入记在主作业当天</span><small>同一笔收费业务的送仓、转场、取空返程，可跨日期归集；另行收费的作业不要并入。</small></div>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {locked ? <div className="oak-workflow-context" role="status">已关联确认的周结算，归集关系只读。</div> : null}
      <div className="table-wrap oak-job-picker"><table aria-label="选择同趟路段"><thead><tr><th>归集</th><th>日期 / 作业</th><th>柜号</th><th>路线</th><th>现有收入</th></tr></thead><tbody>{editing.tasks.map(task => {
        const other = task.income?.review?.mode === "included" && task.income.includedTaskId !== editing.id;
        const manual = task.id !== editing.id && task.income?.review?.mode === "manual";
        return <tr key={task.id}><td><input type="checkbox" aria-label={`选择路段 ${task.reference || task.id}`} disabled={saving || locked || editing.lockedTaskIds.includes(task.id!) || task.id === editing.id || other || manual} checked={selected.includes(task.id!)} onChange={e => setSelected(values => e.target.checked ? [...values, task.id!] : values.filter(id => id !== task.id))} /></td><td>{task.workDate}<small>{driverTaskLabel(task)}{task.id === editing.id ? " · 主作业" : ""}</small></td><td>{task.reference || "—"}</td><td>{task.fromLocation || "?"} → {task.toLocation || "?"}</td><td>{other ? "已归其他任务" : manual ? "人工收入，需先核对" : task.income?.status === "priced" ? incomeMoney(task.income.amount!) : task.income?.status === "included" ? "已并入本任务" : "待计价"}</td></tr>;
      })}</tbody></table></div>
      <div className="oak-job-confirm-fields"><label className="field">归集依据<input required disabled={locked} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="如：送 MCE1 后空车到 STK，次日取空回 HW，同一笔整趟收入" /></label><label className="oak-income-checkbox"><input type="checkbox" required disabled={locked} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />确认这 {selected.length} 段属于同一笔收费业务</label></div>
      <footer className="oak-dialog-actions"><button type="button" className="button ghost" disabled={saving} onClick={() => setEditing(null)}>关闭</button><button className="button primary" type="submit" disabled={saving || !confirmed || locked}><Save size={15} />{saving ? "保存中..." : "保存归集"}</button></footer>
    </form></IncomeDialog> : null}
  </div>;
}

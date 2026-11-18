"use client";

import {useId, useRef, useState} from "react";
import {incomeAmount} from "@/lib/oak-income";
import type {VehicleIncomeRow} from "@/lib/oak-vehicle-income";
import {incomeMoney, json} from "./oak-income-controls";

export default function IncomeAmountCell({row}: {row: VehicleIncomeRow}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{row: VehicleIncomeRow; amount: number} | null>(null);
  const cancelBlur = useRef(false);
  const firstClick = useRef(false);
  const errorId = useId();
  const task = row.task;
  const current = saved?.row === row ? saved.amount : row.amount;
  if (!task?.id || !["pending", "auto", "reviewed"].includes(row.status) || task.income?.review?.mode === "included") {
    return <><strong className={row.amount == null ? "oak-income-pending" : "oak-income-amount"}>{row.amount == null ? "待核对" : incomeMoney(row.amount)}</strong>{row.status === "replaced" && <small>不重复计入</small>}</>;
  }
  const {id, income} = task;
  async function commit() {
    if (cancelBlur.current || saving) return;
    const value = draft?.trim();
    if (!value) { setDraft(null); setError(""); return; }
    try {
      const amount = incomeAmount(value);
      if (amount === current) { setDraft(null); setError(""); return; }
      setSaving(true); setError("");
      await json(await fetch(`/api/oak-task-income/${id}`, {
        method: "PUT", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({mode: "manual", amount, workLabel: income?.review?.workLabel ?? null, note: income?.review?.note ?? ""})
      }));
      setSaved({row, amount}); setDraft(null);
      window.dispatchEvent(new Event("oak-work-income-saved"));
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  }
  return <div className="oak-income-inline-price">
    <div className="oak-price-field" data-formatted={draft === null && current != null}>
    <input type="text" inputMode="decimal" autoComplete="off"
      aria-label={`${row.driverName} ${row.dateFrom} ${row.reference || row.label} 作业收入（美元）`}
      aria-invalid={!!error} aria-describedby={error ? errorId : undefined} readOnly={saving}
      title="编辑本段作业收入" placeholder="待核对"
      value={draft ?? (current == null ? "" : current.toFixed(2))}
      onPointerDown={e => { firstClick.current = document.activeElement !== e.currentTarget; }}
      onFocus={e => e.currentTarget.select()}
      onMouseUp={e => { if (firstClick.current) { e.preventDefault(); firstClick.current = false; } }}
      onChange={e => { setDraft(e.target.value); setError(""); }}
      onBlur={() => void commit()}
      onKeyDown={e => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === "Escape") {
          e.preventDefault(); cancelBlur.current = true; e.currentTarget.blur(); cancelBlur.current = false;
          setDraft(null); setError("");
        }
      }}/>
    {draft === null && current != null && <span aria-hidden="true">{incomeMoney(current)}</span>}
    </div>
    {saving && <small role="status">保存中…</small>}
    {error && <small className="oak-price-error" id={errorId} role="alert">未保存：{error}</small>}
  </div>;
}

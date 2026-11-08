"use client";

import { useEffect, useState } from 'react';
import { Pencil, RefreshCw, Save, Trash2 } from 'lucide-react';
import type { OakVehicle } from '@/lib/oak-vehicles';
import type { VehicleDriverChange } from '@/lib/oak-vehicle-drivers';
import { IncomeDialog, json } from './oak-income-controls';

type History = { changes: VehicleDriverChange[] };
type Draft = { id?: string; version?: number; driverName: string; effectiveDate: string };
const emptyDraft: Draft = { driverName: '', effectiveDate: '' };
const endpoint = '/api/oak-vehicle-drivers';

export default function VehicleDriverHistory({ vehicle, onClose, onChange }: {
  vehicle: OakVehicle; onClose: () => void; onChange: (changes: VehicleDriverChange[]) => void;
}) {
  const [history, setHistory] = useState<History | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void fetch(`${endpoint}?${new URLSearchParams({ vehicleId: vehicle.id })}`, { cache: 'no-store', signal: controller.signal })
      .then(response => json<History>(response))
      .then(result => { if (!controller.signal.aborted) setHistory(result); })
      .catch(error => { if (!controller.signal.aborted) setError((error as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [vehicle.id, retry]);

  async function save(remove?: VehicleDriverChange) {
    if (busy || !history) return;
    if (remove && !window.confirm(`删除 ${remove.effectiveDate} 生效的司机记录？`)) return;
    setBusy(true); setError(''); setStatus('');
    try {
      const result = await json<History>(await fetch(endpoint, {
        method: remove ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId: vehicle.id, ...(remove ? { id: remove.id, version: remove.version } : draft) }),
      }));
      setHistory(result); setDraft(emptyDraft); setStatus(remove ? '已删除' : '已保存');
      onChange(result.changes);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  const changes = history?.changes.filter(change => change.effectiveDate !== null) || [];
  const initialDriver = history?.changes.find(change => change.effectiveDate === null)?.driverName ?? vehicle.driverName;
  return <IncomeDialog title={`${vehicle.vehicleNumber || '未编号车辆'} 司机记录`} busy={busy} onClose={onClose}>
    <form className="oak-income-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="oak-income-fields oak-driver-history-body">
        <div className="oak-driver-history-baseline"><span>初始司机</span><strong>{initialDriver}</strong></div>
        {error ? <div className="error" role="alert">{error}{!history && !loading ? <button type="button" className="icon-button" title="重新读取司机记录" onClick={() => setRetry(value => value + 1)}><RefreshCw size={15} /></button> : null}</div> : null}
        <div className="oak-income-field-pair">
          <label className="field">司机姓名<input required maxLength={120} disabled={busy || !history} value={draft.driverName} onChange={event => { setStatus(''); setDraft({ ...draft, driverName: event.target.value }); }} /></label>
          <label className="field">生效日期<input required type="date" min="1000-01-01" max="9999-12-31" disabled={busy || !history} value={draft.effectiveDate} onChange={event => { setStatus(''); setDraft({ ...draft, effectiveDate: event.target.value }); }} /></label>
        </div>
        <div className="oak-driver-history-list" aria-busy={loading}>
          <h3>变更记录</h3>
          {loading ? <p className="muted">读取中…</p> : !changes.length ? <p className="muted">暂无变更</p> : <table aria-label="司机变更记录">
            <thead><tr><th scope="col">生效日期</th><th scope="col">司机</th><th scope="col" aria-label="操作" /></tr></thead>
            <tbody>{changes.map(change => <tr key={change.id} data-editing={draft.id === change.id || undefined}>
              <td>{change.effectiveDate}</td><td>{change.driverName}</td>
              <td><div className="oak-driver-history-actions">
                <button type="button" className="icon-button" title={`修改 ${change.effectiveDate} 司机记录`} disabled={busy} onClick={() => { setStatus(''); setError(''); setDraft({ id: change.id, version: change.version, driverName: change.driverName, effectiveDate: change.effectiveDate! }); }}><Pencil size={14} /></button>
                <button type="button" className="icon-button danger-icon" title={`删除 ${change.effectiveDate} 司机记录`} disabled={busy} onClick={() => void save(change)}><Trash2 size={14} /></button>
              </div></td>
            </tr>)}</tbody>
          </table>}
        </div>
      </div>
      <footer className="oak-dialog-actions">
        <span className="oak-driver-history-status muted" role="status">{status}</span>
        {draft.id ? <button type="button" className="button ghost" disabled={busy} onClick={() => { setDraft(emptyDraft); setError(''); }}>取消修改</button> : null}
        <button type="submit" className="button primary" disabled={busy || !history || !draft.driverName.trim() || !draft.effectiveDate}><Save size={15} />{busy ? '保存中…' : draft.id ? '保存修改' : '登记变更'}</button>
      </footer>
    </form>
  </IncomeDialog>;
}

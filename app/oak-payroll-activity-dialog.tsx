"use client";

import { useEffect, useState } from 'react';
import { Link2, Upload } from 'lucide-react';
import type { PayrollActivityPreview } from '@/lib/oak-payroll-activity-db';
import { IncomeDialog, json } from './oak-income-controls';

export default function PayrollActivityDialog({ wageId, vehicle, onClose, onSaved, onUpload }: {
  wageId: string; vehicle: string; onClose: () => void; onSaved: () => void; onUpload: () => void;
}) {
  const [data, setData] = useState<PayrollActivityPreview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const candidate = data?.candidate;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/oak-payroll-activity?${new URLSearchParams({ wageId })}`, { cache: 'no-store', signal: controller.signal })
      .then(json<PayrollActivityPreview>)
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(e => { if (!controller.signal.aborted) setError((e as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [wageId]);

  async function confirm() {
    if (!candidate || busy) return;
    setBusy(true);
    setError('');
    try {
      await json(await fetch('/api/oak-payroll-activity', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wageId, token: candidate.token }),
      }));
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    } finally { setBusy(false); }
  }

  return <IncomeDialog title="核对周表作业" wide busy={busy} onClose={onClose}>
    <div className="oak-payroll-evidence">
      <strong>{vehicle}{data ? ` · ${data.sheetName}` : ''}</strong>
      {data ? <span>{data.fileName} · {data.dateFrom} 至 {data.dateTo}</span> : null}
      {loading ? <span role="status">正在查找已导入作业…</span> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}
      {data && !candidate ? <p>未找到唯一可关联的作业批次。</p> : null}
      {candidate ? <>
        <strong>已导入作业 · {candidate.legs.length} 段</strong>
        <div className="table-wrap"><table className="oak-payroll-activity-legs" aria-label="待关联的已导入作业">
          <thead><tr><th>日期</th><th>作业 / 参考号</th><th>线路</th><th>里程 / mi</th></tr></thead>
          <tbody>{candidate.legs.map(leg => <tr key={leg.id}>
            <td>{leg.workDate}</td><td>{leg.nature || '运输'} · {leg.reference || '—'}<small>原表第 {leg.sourceRow} 行</small></td>
            <td>{leg.fromLocation || '—'} → {leg.toLocation || '—'}</td><td>{leg.miles?.toLocaleString('en-US') ?? '—'}</td>
          </tr>)}</tbody>
        </table></div>
      </> : null}
    </div>
    <footer className="oak-dialog-actions">
      <button className="button ghost" disabled={busy} onClick={onClose}>取消</button>
      {candidate ? <button className="button primary" disabled={busy} onClick={() => void confirm()}><Link2 size={15}/>{busy ? '保存中…' : '确认关联已有作业'}</button>
        : <button className="button primary" disabled={loading || busy} onClick={onUpload}><Upload size={15}/>上传原周表</button>}
    </footer>
  </IncomeDialog>;
}

"use client";

import { useEffect, useState } from 'react';
import { ArrowLeft, FileText, Link2, ListChecks, Upload } from 'lucide-react';
import type { ActivityLeg, PayrollActivityBatchPreview, PayrollActivityBatchRow, PayrollActivityPreview } from '@/lib/oak-payroll-activity-db';
import { IncomeDialog, json } from './oak-income-controls';

function ActivityLegs({ legs }: { legs: ActivityLeg[] }) {
  return <div className="table-wrap"><table className="oak-payroll-activity-legs" aria-label="待关联的已导入作业">
    <thead><tr><th>作业日期</th><th>作业 / 参考号</th><th>线路</th><th>里程 / mi</th></tr></thead>
    <tbody>{legs.map(leg => <tr key={leg.id}>
      <td>{leg.workDate}</td><td>{leg.nature || '运输'} · {leg.reference || '—'}<small>{leg.section ? `${leg.section} · ` : ''}原表第 {leg.sourceRow} 行</small></td>
      <td>{leg.fromLocation || '—'} → {leg.toLocation || '—'}</td><td>{leg.miles?.toLocaleString('en-US') ?? '—'}</td>
    </tr>)}</tbody>
  </table></div>;
}

function workDates(legs: ActivityLeg[]) {
  return [...new Set(legs.map(leg => leg.workDate))].sort();
}

function DateSpan({ dates }: { dates: string[] }) {
  if (!dates.length) return <>—</>;
  return <span title={dates.join('、')}>{dates[0]}{dates.length > 1 ? ` 至 ${dates.at(-1)}` : ''} · {dates.length} 天</span>;
}

export default function PayrollActivityDialog({ wageId, vehicle, onClose, onSaved, onUpload }: {
  wageId: string; vehicle: string; onClose: () => void; onSaved: () => void; onUpload: () => void;
}) {
  const [data, setData] = useState<PayrollActivityPreview | null>(null);
  const [batch, setBatch] = useState<PayrollActivityBatchPreview | null>(null);
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<PayrollActivityBatchRow | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const candidate = data?.candidate;
  const eligible = batch?.rows.filter(row => row.candidate && row.vehicleNumber) || [];
  const period = mode === 'batch' ? batch : data;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ wageId, ...(mode === 'batch' ? { batch: '1' } : {}) });
    fetch(`/api/oak-payroll-activity?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(json<PayrollActivityPreview | PayrollActivityBatchPreview>)
      .then(result => {
        if (controller.signal.aborted) return;
        if ('rows' in result) setBatch(result);
        else setData(result);
      })
      .catch(e => { if (!controller.signal.aborted) setError((e as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [mode, wageId]);

  function changeMode(next: 'single' | 'batch') {
    setData(null); setBatch(null); setSelected([]); setDetail(null); setError(''); setLoading(true); setMode(next);
  }

  async function confirm() {
    const selection = eligible.filter(row => selected.includes(row.wageId)).map(row => ({ wageId: row.wageId, token: row.candidate!.token }));
    if (busy || loading || (mode === 'batch' ? !selection.length : !candidate)) return;
    setBusy(true);
    setError('');
    try {
      await json(await fetch('/api/oak-payroll-activity', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'batch' ? { wageId, selection } : { wageId, token: candidate!.token }),
      }));
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setData(null); setBatch(null); setSelected([]); setDetail(null);
    } finally { setBusy(false); }
  }

  return <IncomeDialog title={mode === 'batch' ? '同批周表核对' : '核对周表作业'} wide busy={busy} onClose={onClose}>
    <div className="oak-payroll-evidence">
      <div className="oak-payroll-activity-header">
        <div><strong>{mode === 'single' ? `${vehicle}${data ? ` · ${data.sheetName}` : ''}` : period?.fileName}</strong>
          {period ? <small>{mode === 'single' ? `${period.fileName} · ` : ''}工资周期 {period.dateFrom} 至 {period.dateTo}</small> : null}
        </div>
        {mode === 'single' && data ? <button className="button ghost" disabled={busy} onClick={() => changeMode('batch')}><ListChecks size={15}/>查看同批待核对</button>
          : mode === 'batch' ? <button className="button ghost" disabled={busy} onClick={() => changeMode('single')}><ArrowLeft size={15}/>返回单笔</button> : null}
      </div>
      {loading ? <span role="status">正在查找已导入作业…</span> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}
      {mode === 'single' && data && !candidate ? <p>未找到唯一可关联的作业批次。</p> : null}
      {mode === 'single' && candidate ? <>
        <strong>已导入作业 · {candidate.legs.length} 段 · <DateSpan dates={workDates(candidate.legs)}/></strong>
        <ActivityLegs legs={candidate.legs}/>
      </> : null}
      {mode === 'batch' && batch && !detail ? <>
        <strong>同批待核对 {batch.rows.length} 笔 · 可批量关联 {eligible.length} 笔</strong>
        <div className="table-wrap"><table className="oak-payroll-activity-batch" aria-label="同批待关联工资">
          <thead><tr><th><input type="checkbox" aria-label="选择所有可关联记录" disabled={busy || !eligible.length || eligible.length > 100} checked={Boolean(eligible.length) && selected.length === eligible.length}
            onChange={event => setSelected(event.target.checked ? eligible.map(row => row.wageId) : [])}/></th>
            <th>车号 / 原表</th><th>实际作业日期</th><th>路段 / 里程</th><th>状态</th><th aria-label="明细"/></tr></thead>
          <tbody>{batch.rows.map(row => {
            const legs = row.candidate?.legs || [];
            const miles = legs.length && legs.every(leg => leg.miles != null) ? legs.reduce((sum, leg) => sum + leg.miles!, 0) : null;
            return <tr key={row.wageId}>
              <td><input type="checkbox" aria-label={`选择 ${row.vehicleNumber || '无车号'} ${row.sheetName}`} checked={selected.includes(row.wageId)}
                disabled={busy || !row.candidate || !row.vehicleNumber || (selected.length >= 100 && !selected.includes(row.wageId))}
                onChange={event => setSelected(current => event.target.checked ? [...current, row.wageId] : current.filter(id => id !== row.wageId))}/></td>
              <td><strong>{row.vehicleNumber || '暂无车号'}</strong><small>{row.sheetName}</small></td>
              <td><DateSpan dates={workDates(legs)}/></td>
              <td>{legs.length ? `${legs.length} 段` : '—'}<small>{miles == null ? '—' : `${miles.toLocaleString('en-US')} mi`}</small></td>
              <td>{!row.vehicleNumber ? '车号待确认' : !row.candidate ? '作业待核对' : '待确认'}</td>
              <td>{row.candidate ? <button className="icon-button" disabled={busy} title={`查看 ${row.vehicleNumber || row.driverName} 作业明细`} onClick={() => setDetail(row)}><FileText size={15}/></button> : null}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </> : null}
      {mode === 'batch' && detail?.candidate ? <>
        <div className="oak-payroll-activity-header">
          <strong>{detail.vehicleNumber || '暂无车号'} · {detail.sheetName} · <DateSpan dates={workDates(detail.candidate.legs)}/></strong>
          <button className="button ghost" disabled={busy} onClick={() => setDetail(null)}><ArrowLeft size={15}/>返回列表</button>
        </div>
        <ActivityLegs legs={detail.candidate.legs}/>
      </> : null}
    </div>
    <footer className="oak-dialog-actions">
      <button className="button ghost" disabled={busy} onClick={onClose}>取消</button>
      {mode === 'batch' ? <button className="button primary" disabled={busy || loading || !selected.length} onClick={() => void confirm()}><Link2 size={15}/>{busy ? '保存中…' : `确认关联 ${selected.length} 笔`}</button>
        : candidate ? <button className="button primary" disabled={busy} onClick={() => void confirm()}><Link2 size={15}/>{busy ? '保存中…' : '确认关联已有作业'}</button>
        : <button className="button primary" disabled={loading || busy} onClick={onUpload}><Upload size={15}/>上传原周表</button>}
    </footer>
  </IncomeDialog>;
}

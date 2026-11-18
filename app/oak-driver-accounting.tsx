'use client';

import { ArrowLeftRight, Banknote, CalendarDays, ChevronRight, Fuel, Plus, Save, ShieldCheck, Trash2, Truck, Wallet, Wrench } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { davidDriverKey, davidTrialRange, type DriverAccountingResponse, type DriverProfit, type DriverTimeline, type DriverUse } from '@/lib/oak-driver-accounting';
import { IncomeDialog, incomeMoney, json } from './oak-income-controls';
import styles from './oak-driver-accounting.module.css';
import { useFinancePageFacts } from './finance-page-context';
import { vehicleRange } from '@/lib/oak-vehicle-accounting';

const api = '/api/oak-driver-accounting';
const categories = [{ key: 'income', label: '作业收入' }, { key: 'labor', label: '司机 / 车主工资' }, { key: 'fuel', label: '油费' }, { key: 'insurance', label: '车辆保险' }, { key: 'maintenance', label: '车辆维修费' }] as const;
type Category = typeof categories[number]['key'];

function TimelineEditor({ data, name, dateFrom, onClose, onSaved }: { data: DriverAccountingResponse; name: string; dateFrom: string; onClose: () => void; onSaved: () => void }) {
  const [uses, setUses] = useState<DriverUse[]>(data.timeline.uses);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setUse = (index: number, fields: Partial<DriverUse>) => setUses(current => current.map((use, i) => i === index ? { ...use, ...fields } : use));
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await json<DriverTimeline>(await fetch(api, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data.timeline, uses }) }));
      onSaved();
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return <IncomeDialog wide title={`${name} · 换车记录`} busy={busy} onClose={onClose}>
    <form className="oak-driver-use-form" onSubmit={save}>
      <div className="oak-driver-use-body">
        {error ? <p className="error" role="alert">{error}</p> : null}
        <fieldset disabled={busy}>
          {uses.map((use, i) => <div className="oak-driver-use-row" key={i}>
            <label>车号<select required value={use.vehicleId} onChange={event => setUse(i, { vehicleId: event.target.value })}><option value="">选择车号</option>{data.vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.vehicleNumber}</option>)}</select></label>
            <label>{use.dateFrom === null ? '用车开始（原始固定用车）' : '用车开始'}<input required={use.dateFrom !== null} type="date" value={use.dateFrom ?? ''} onChange={event => setUse(i, { dateFrom: event.target.value })}/></label>
            <label>用车结束（可留空）<input type="date" min={use.dateFrom ?? undefined} value={use.dateTo ?? ''} onChange={event => setUse(i, { dateTo: event.target.value || null })}/></label>
            <button type="button" className="icon-button danger" title={`移除第 ${i + 1} 条用车记录`} onClick={() => setUses(current => current.filter((_, index) => index !== i))}><Trash2 size={15}/></button>
          </div>)}
          {!uses.length ? <p className="muted">尚未登记用车</p> : null}
          <button type="button" className="button ghost" disabled={uses.length >= 60} onClick={() => setUses(current => [...current, { vehicleId: '', dateFrom: current.length ? '' : dateFrom, dateTo: null }])}><Plus size={15}/>添加用车</button>
        </fieldset>
      </div>
      <footer className="oak-dialog-actions"><button type="button" className="button ghost" disabled={busy} onClick={onClose}>取消</button><button className="button primary" disabled={busy}><Save size={15}/>{busy ? '保存中…' : '保存换车记录'}</button></footer>
    </form>
  </IncomeDialog>;
}

function AmountDetails({ data, category, onClose }: { data: DriverAccountingResponse; category: Category; onClose: () => void }) {
  const line = data.profit[category];
  return <IncomeDialog wide title={`${categories.find(item => item.key === category)?.label} · 核算依据`} busy={false} onClose={onClose}>
    <div className="oak-driver-use-body">
      <div className={styles.detailSummary}><span>{line.pending.length ? '已确认小计' : '周期合计'}</span><strong>{line.subtotal == null ? '待核对' : incomeMoney(line.subtotal)}</strong></div>
      {line.pending.length ? <ul className="oak-driver-pending" aria-label="待核对事项">{line.pending.map(issue => <li key={issue}>{issue}</li>)}</ul> : null}
      {line.sources.length ? <div className="oak-stan-table oak-driver-detail-table"><table><thead><tr><th>计入日期</th><th>来源</th><th>金额 / USD</th></tr></thead><tbody>
        {line.sources.map((source, index) => <tr key={index}><td>{source.dateFrom}{source.dateFrom !== source.dateTo ? <small>至 {source.dateTo}</small> : null}</td><td>{source.label}</td><td>{incomeMoney(source.amount)}</td></tr>)}
      </tbody></table></div> : <p className="muted">{line.amount === 0 ? '本周期无需计入此项' : '暂无已确认金额'}</p>}
    </div>
  </IncomeDialog>;
}

const icons={income:Banknote,labor:Wallet,fuel:Fuel,insurance:ShieldCheck,maintenance:Wrench};
function AmountLine({ line, category, label, onOpen }: { line: DriverProfit[Category]; category:Category; label: string; onOpen: () => void }) {
  const Icon=icons[category];
  return <li><button type="button" className={styles.amountLine} title={`查看${label}核算依据`} onClick={onOpen}>
    <span className={styles.lineLabel}><Icon size={16} aria-hidden/>{label}</span>
    <span className={styles.figure} data-kind={category}><strong>{line.subtotal == null ? '—' : incomeMoney(line.subtotal)}</strong>
      {!!line.pending.length && <small>{line.subtotal == null ? '待核对' : '部分待核对'}</small>}</span>
    <ChevronRight size={15} aria-hidden/>
  </button></li>;
}

export default function OakDriverAccounting({ active }: { active: boolean }) {
  const [query, setQuery] = useState({ driverKey: davidDriverKey, ...davidTrialRange });
  const [drivers, setDrivers] = useState<DriverAccountingResponse['drivers']>([]);
  const [settled, setSettled] = useState<{ query: typeof query; data?: DriverAccountingResponse; error?: string }>();
  const [editing, setEditing] = useState(false);
  const [detail, setDetail] = useState<Category | null>(null);
  let rangeError = '';
  if (!query.dateFrom || !query.dateTo) rangeError = '请选择完整的核算起止日期';
  else { try { vehicleRange(query); } catch (err) { rangeError = (err as Error).message; } }
  useEffect(() => {
    if (!active || rangeError) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`${api}?${new URLSearchParams(query)}`, { cache: 'no-store', signal: controller.signal })
        .then(json<DriverAccountingResponse>).then(data => {
          if (!controller.signal.aborted) { setDrivers(data.drivers); setSettled({ query, data }); }
        }).catch(err => { if (!controller.signal.aborted) setSettled({ query, error: (err as Error).message }); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [active, query, rangeError]);
  const current = settled?.query === query ? settled : null;
  const result = current?.data;
  const error = rangeError || current?.error;
  const loading = !result && !error;
  const refresh = () => setQuery(q => ({ ...q }));
  useEffect(()=>{
    const reload=()=>setQuery(q=>({...q}));
    window.addEventListener('oak-work-income-saved',reload);
    return ()=>window.removeEventListener('oak-work-income-saved',reload);
  },[]);
  const name = result?.drivers.find(item => item.key === result.timeline.driverKey)?.name ?? '';
  const number = (id: string | null) => result?.vehicles.find(item => item.id === id)?.vehicleNumber ?? '未登记';
  const net = result?.profit.net;
  useFinancePageFacts('vehicles',()=>result?{司机:name,核算开始:query.dateFrom,核算结束:query.dateTo,净盈亏:net,
    收支:categories.map(c=>({项目:c.label,确认金额:result.profit[c.key].amount,已知小计:result.profit[c.key].subtotal,待核对数:result.profit[c.key].pending.length})),
    用车:result.profit.periods.map(p=>({车号:number(p.vehicleId),开始:p.dateFrom,结束:p.dateTo})).slice(0,30)}:null,active);

  return <section className={styles.workspace} aria-label="司机盈亏" aria-busy={loading}>
    <div className={styles.title}><h2>司机盈亏</h2><span>USD</span></div>
    <div className={styles.filters}>
      <label>司机<select aria-label="司机" value={query.driverKey} onChange={e => setQuery({ ...query, driverKey: e.target.value })}>{drivers.length ? drivers.map(item => <option key={item.key} value={item.key}>{item.name}</option>) : <option value={davidDriverKey}>David高</option>}</select></label>
      <label>核算开始<input type="date" required max={query.dateTo || undefined} value={query.dateFrom} onChange={e => setQuery({ ...query, dateFrom: e.target.value })}/></label>
      <label>核算结束<input type="date" required min={query.dateFrom || undefined} value={query.dateTo} onChange={e => setQuery({ ...query, dateTo: e.target.value })}/></label>
    </div>
    {error ? <div className="error" role="alert">{error} {!rangeError && <button className="button ghost" onClick={refresh}>重试</button>}</div> : null}
    {result ? <>
      <div className={styles.overview} aria-label="司机盈亏汇总">
        <section className={styles.balance} data-state={net==null?'pending':net<0?'loss':net>0?'profit':'even'}>
          <div className={styles.balanceTitle}><h3>周期净盈亏</h3><span>{net==null?'待核对':net<0?'亏损':net>0?'盈利':'持平'}</span></div>
          <strong className={styles.net}>{net==null?'—':incomeMoney(net)}</strong>
          <div className={styles.identity}><b>{name}</b><span><CalendarDays size={15}/>{query.dateFrom} 至 {query.dateTo}</span></div>
        </section>
        <section className={styles.breakdown}><h3>收支明细</h3><ul>{categories.map(c=><AmountLine key={c.key} category={c.key} label={c.label} line={result.profit[c.key]} onOpen={()=>setDetail(c.key)}/>)}</ul></section>
      </div>
      <section className={styles.usage}><header><h3>周期内用车</h3><button className="button ghost" onClick={() => setEditing(true)}><ArrowLeftRight size={15}/>换车记录</button></header>
        {result.profit.periods.length?<ol>{result.profit.periods.map((period,i)=><li key={period.dateFrom}><div className={styles.truck}><Truck size={16}/><b>{number(period.vehicleId)}{period.vehicleId?' 号车':''}</b><small>{String(i+1).padStart(2,'0')}</small></div>
          <span>{period.dateFrom} 至 {period.dateTo}</span>{period.shared&&<em>用车日期重叠</em>}</li>)}</ol>:<p>本周期暂无用车记录</p>}
      </section>
    </> : !error && <p className={styles.state} role="status">{loading?'正在核算…':'暂无核算结果'}</p>}
    {result && editing ? <TimelineEditor data={result} name={name} dateFrom={query.dateFrom} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }}/> : null}
    {result && detail ? <AmountDetails data={result} category={detail} onClose={() => setDetail(null)}/> : null}
  </section>;
}

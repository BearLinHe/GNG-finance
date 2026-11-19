'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, ClipboardList, FileSpreadsheet, History, ListChecks, Plus, Send, X } from 'lucide-react';
import type { AssistantPage, AssistantReply, AssistantTurn } from '@/lib/finance-assistant';
import styles from './oak-finance-assistant.module.css';

type Message=AssistantTurn & { scope:AssistantPage['module']; reply?:AssistantReply; saved?:string[]; cancelled?:boolean };
const scopes={'oak-transport':'OAK 运输部',external:'OAK 单柜',sav:'SAV 单柜'};
const path='/api/finance-assistant';
const examples=['比较 David Gao 在 2026 年 8 月和 9 月的工资、油费和盈亏，列出待核对项。','总结 2026 年 9 月完整账期的车队油费和保险，给出分项合计。'];
const usd=(v:number)=>v.toLocaleString('en-US',{style:'currency',currency:'USD'});
const names={fuel:'油费', insurance:'保险', other:'其他费用'};
async function post<T,>(body:unknown):Promise<T>{
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'请求失败');return data;
}

async function sheetText(file:File){
  if(!/\.xlsx$/i.test(file.name)||file.size>2*1024*1024)throw new Error('请选择不超过 2 MB 的 .xlsx 文件');
  const {Workbook,ValueType}=await import('exceljs');
  const book=new Workbook();await book.xlsx.load(await file.arrayBuffer());
  const lines:string[]=[];let size=0;
  for(const sheet of book.worksheets){
    if(sheet.state!=='visible')continue;
    lines.push('工作表：'+sheet.name);
    sheet.eachRow(row=>{
      if(row.hidden)return;
      const cells:string[]=[];
      row.eachCell((cell,c)=>{
        if(sheet.getColumn(c).hidden || cell.type===ValueType.Merge || cell.value==null)return;
        if(c>100)throw new Error('列数过多，请仅保留需要分析的列');
        const v=cell.value instanceof Date?cell.value.toISOString().slice(0,10):cell.text;
        cells[c-1]=v.replace(/[\r\n\t]+/g,' ');
      });
      const line=cells.join('\t');if(!line.trim())return;
      size+=line.length;if(size>14000||lines.length>300)throw new Error('文件内容过多，请按月份或车辆拆分');
      lines.push(line);
    });
  }
  if(!size)throw new Error('未读取到可见的单元格');
  return `文件：${file.name}\n${lines.join('\n')}`;
}

export default function FinanceAssistant({module,readPage}:{module:AssistantPage['module'];readPage:()=>AssistantPage}){
  const transport=module==='oak-transport';
  const [mode,setMode]=useState<'read'|'draft'>('read'),[ready,setReady]=useState<boolean|null>(null);
  const [messages,setMessages]=useState<Message[]>([]),[prompt,setPrompt]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [attachment,setAttachment]=useState('');const fileInput=useRef<HTMLInputElement>(null),end=useRef<HTMLDivElement>(null);
  useEffect(()=>{const controller=new AbortController();fetch(path,{signal:controller.signal,cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setReady(d.configured);}).catch(e=>{if(!controller.signal.aborted){setReady(false);setError(e.message);}});return ()=>controller.abort();},[]);
  function report(e:unknown){setError(e instanceof Error?e.message:'请求失败');}
  useEffect(()=>{const history=end.current?.parentElement;if(history)history.scrollTop=history.scrollHeight;},[messages.length]);
  useEffect(()=>setMode('read'),[module]);
  async function send(sample=false){
    if(busy||(!sample&&(!ready||!prompt.trim())))return;
    const content=sample?'查看 David 的本地试算':prompt.trim()+(attachment?'\n\n'+attachment:'');
    const past=messages.filter(m=>m.scope===module).slice(-8).map(({role,content})=>({role,content}));
    while(past.length && past.reduce((n,m)=>n+m.content.length,content.length)>23500)past.shift();
    setBusy(true);setError('');
    try{
      const reply=await post<AssistantReply>(sample?{action:'sample'}:{action:'chat',mode:transport&&mode==='draft'?'draft':'assistant',page:readPage(),messages:[...past,{role:'user',content}]});
      setMessages(current=>[...current.map(m=>m.scope===module&&(m.reply?.draft||m.reply?.workDraft)&&!m.saved?{...m,cancelled:true}:m),{role:'user',scope:module,content},{role:'assistant',scope:module,content:reply.text,reply}]);
      if(!sample){setPrompt('');setAttachment('');}
    }catch(e){report(e);}finally{setBusy(false);}
  }
  async function discard(i:number){
    const reply=messages[i]?.reply,token=(reply?.workDraft||reply?.draft)?.token;if(!token||busy)return;
    setBusy(true);setError('');
    try{await post({action:reply?.workDraft?'discard-work':'discard',token});setMessages(ms=>ms.map((m,n)=>i===n?{...m,cancelled:true}:m));}
    catch(e){report(e);}finally{setBusy(false);}
  }
  async function confirm(i:number){
    const reply=messages[i]?.reply,token=(reply?.workDraft||reply?.draft)?.token;if(!token||busy)return;
    setBusy(true);setError('');
    try{const result=await post<{ids:string[]}>({action:reply?.workDraft?'confirm-work':'confirm',token});
      if(reply?.workDraft)window.dispatchEvent(new Event('oak-work-income-saved'));
      setMessages(ms=>ms.map((m,n)=>i===n?{...m,saved:result.ids,content:reply?.workDraft?`已保存 ${result.ids.length} 段工单收入核对。`:`已确认入账，明细编号：${result.ids.join('、')}`}:m));}
    catch(e){report(e);}finally{setBusy(false);}
  }
  return <section className={styles.workspace} aria-label="财务助手">
    {ready===false&&<p className={styles.notice}>未连接 AI。请检查服务端 OPENAI_API_KEY。</p>}
    <div className={styles.history} aria-live="polite">
      {!messages.length&&<div className={styles.start}><ClipboardList size={22}/><h3>{transport?'核算查询':'单柜核算查询'}</h3>
        <div><button className="button ghost" disabled={busy} onClick={()=>{setMode('read');setPrompt('请总结当前页面的核算数据，并说明统计范围。');}}>总结当前页</button>
        {transport&&<button className="button ghost" disabled={busy} onClick={()=>void send(true)}><History size={15}/>David 周期试算</button>}
        <button className="button ghost" disabled={busy} onClick={()=>{setMode('read');setPrompt('查一下刘嘉耀 2026 年 9 月 15 日的工单，列出待核对的收入。');}}>按司机核对工单</button>
        {transport&&examples.map((s,i)=><button key={s} className="button ghost" disabled={busy} onClick={()=>{setMode('read');setPrompt(s);}}>{i?'车队费用汇总':'比较司机盈亏'}</button>)}</div></div>}
      {messages.map((m,i)=><article key={i} className={styles.turn}><b>{m.role==='user'?'你':'财务助手'} · {scopes[m.scope]}</b><p>{m.content}</p>
        {m.reply?.evidence?.map((s,n)=><small key={n}>{s}</small>)}
        {m.reply?.workDraft&&<><ol className={styles.workPreview} aria-label="OAK 工单收入变更预览">{m.reply.workDraft.rows.map(r=><li key={r.id}>
          <strong>{r.work} · {r.reference}</strong><span>{r.driver} · {r.date} · #{r.id}</span><span>{r.route}</span>
          <b>{r.before===null?'待核对':usd(r.before)} → {r.after===null?'待核对':usd(r.after)}</b>
          <small>{r.automatic?'随主作业重新计价 · ':''}{r.basis}</small>{r.anchor&&<small>主作业：{r.anchor}</small>}{r.note&&<small>备注：{r.note}</small>}
        </li>)}</ol>{!m.saved&&!m.cancelled?<div className={styles.controls}>
          <button className="button primary" disabled={busy||m.scope!==module} onClick={()=>void confirm(i)}><Check size={15}/>确认整批核对</button>
          <button className="button ghost" disabled={busy} onClick={()=>void discard(i)}>放弃</button></div>:<small>{m.saved?'已保存':'预览已取消'}</small>}</>}
        {m.reply?.draft&&<><div className={styles.scroll}><table><caption>变更预览 · {m.reply.draft.rows.length} 笔</caption><thead><tr>{['操作','车号','项目','周期','原金额','新金额','备注'].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{m.reply.draft.rows.map((r,n)=><tr key={n}><td>{r.recordId?'修改 #'+r.recordId:'新增'}</td><td>{r.vehicleNumber}</td><td>{names[r.category]}</td><td>{r.dateFrom} 至 {r.dateTo}</td><td>{r.oldAmount===null?'无':usd(r.oldAmount)}</td><td>{usd(r.amount)}</td><td>{r.note||'无'}</td></tr>)}</tbody></table></div>
          {!m.saved && !m.cancelled?<div className={styles.controls}><button type="button" className="button primary" disabled={busy||!transport} onClick={()=>void confirm(i)}><Check size={15}/>确认入账</button><button className="button ghost" disabled={busy} onClick={()=>void discard(i)}>放弃草稿</button></div>:<small>{m.saved?'已保存':'草稿未入账'}</small>}</>}
      </article>)}
      {busy&&<small role="status">处理中…</small>}<div ref={end}/>
    </div>
    {error&&<p role="alert" className="error">{error}</p>}
    <form className={styles.composer} onSubmit={e=>{e.preventDefault();void send();}}>
      <div className={styles.controls}>{transport?<><button type="button" className="button ghost" aria-pressed={mode==='read'} disabled={busy} onClick={()=>setMode('read')}><ClipboardList size={15}/>查询 / 核对</button><button type="button" className="button ghost" aria-pressed={mode==='draft'} disabled={busy} onClick={()=>setMode('draft')}><ListChecks size={15}/>拟改账</button></>:<small>单柜查询 · OAK 工单核对</small>}
      <button type="button" className={`icon-button ${styles.newChat}`} title="新对话" aria-label="新对话" disabled={busy} onClick={()=>{setMessages([]);setError('');setPrompt('');setAttachment('');}}><Plus size={16}/></button></div>
      <textarea aria-label="给财务助手的消息" maxLength={7000} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={!transport||mode==='read'?'询问账目，或告诉我哪位司机、哪天的工单要怎么核对':'输入车号、费用周期和金额'}/>
      {attachment&&<details><summary>{attachment.split('\n')[0]} · 发送前预览</summary><pre>{attachment}</pre></details>}
      <footer><div className={styles.controls}><input type="file" hidden ref={fileInput} accept=".xlsx" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;setBusy(true);setError('');setAttachment('');try{setAttachment(await sheetText(file));}catch(err){setError((err as Error).message);}finally{setBusy(false);}}}/><button type="button" className="icon-button" title="附加 Excel" disabled={busy} onClick={()=>fileInput.current?.click()}><FileSpreadsheet size={17}/></button>{attachment&&<button type="button" className="icon-button" title="移除附件" disabled={busy} onClick={()=>setAttachment('')}><X size={15}/></button>}<small>发送至 OpenAI</small></div><button className="button primary" disabled={!ready||busy||!prompt.trim()}><Send size={15}/>发送</button></footer>
    </form>
  </section>;
}

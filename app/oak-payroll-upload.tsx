"use client";

import { useEffect, useRef, useState } from 'react';
import { Check, FileText, RefreshCw, Upload } from 'lucide-react';
import { IncomeDialog, incomeMoney, json } from './oak-income-controls';
import type { PayrollPreview, PayrollSource } from '@/lib/oak-payroll';
import type { OakVehicle } from '@/lib/oak-vehicles';
import type { VehicleRange } from '@/lib/oak-vehicle-accounting';
import {maxPayrollFiles,payrollForms,payrollFormWarnings,updatePayrollSheetForm,selectedPayrollSheets,planPayrollBatch,PayrollBatchError,type PayrollSheetForm} from '@/lib/oak-payroll-batch';

export function PayrollSourceDetails({ source, onClose }: { source: PayrollSource; onClose: () => void }) {
  return <IncomeDialog title="工资原表依据" busy={false} onClose={onClose}>
    <div className="oak-payroll-evidence"><strong>{source.fileName}</strong><span>工作表：{source.sheetName}</span><span>金额来源：{source.candidate.label}</span>
      <div className="oak-payroll-amount-pair"><span>原表金额<strong>{source.originalAmount == null ? '待核对' : incomeMoney(source.originalAmount)}</strong></span><span>导入确认金额<strong>{incomeMoney(source.confirmedAmount)}</strong></span></div>
      {source.note ? <p>{source.note}</p> : null}
      <div className="table-wrap"><table aria-label="工资原表单元格"><thead><tr><th>单元格</th><th>原始值</th></tr></thead><tbody>{source.candidate.cells.map(cell => <tr key={cell.address}><td>{cell.address}</td><td>{cell.value ?? '无有效数值'}</td></tr>)}</tbody></table></div>
    </div>
  </IncomeDialog>;
}

type ImportResult = VehicleRange & {imported:number;duplicates:number;activities?:{added:number;skipped:number};activityWarning?:string};
type PayrollFile = {id:string;file:File;enabled:boolean;status:'reading'|'ready'|'failed'|'imported';error:string;
  preview:PayrollPreview|null;vehicles:OakVehicle[];forms:Record<string,PayrollSheetForm>;range:VehicleRange;result?:ImportResult};
export default function OakPayrollUpload({ disabled, onImported }: { disabled: boolean; onImported: (range: VehicleRange) => void }) {
  const fileInput = useRef<HTMLInputElement>(null),previewScroll=useRef<HTMLDivElement>(null);
  const [files,setFiles] = useState<PayrollFile[]>([]),[activeId,setActiveId] = useState('');
  const [phase,setPhase] = useState<'preview'|'import'|null>(null),[progress,setProgress] = useState('');
  const [error, setError] = useState(''), [message, setMessage] = useState<{text:string;warning:boolean}|null>(null);
  const [details, setDetails] = useState<PayrollSource | null>(null);
  const busy=phase!==null,active=files.find(item=>item.id===activeId)||files[0];
  const preview=active?.preview,forms=active?.forms||{},range=active?.range||{dateFrom:'',dateTo:''},vehicles=active?.vehicles||[];
  const locked=busy||active?.status==='imported'||!active?.enabled;
  useEffect(()=>{previewScroll.current?.scrollTo({top:0,left:0});},[activeId]);
  const patch=(id:string,values:Partial<PayrollFile>)=>setFiles(previous=>previous.map(item=>item.id===id?{...item,...values}:item));
  function close(){setFiles([]);setError('');setDetails(null);}
  async function readFile(item:PayrollFile){
    try {
      if (!/\.xlsx$/i.test(item.file.name) || item.file.size > 4 * 1024 * 1024) throw new Error('请选择不超过 4 MB 的 .xlsx 工资表');
      const body = new FormData(); body.append('file', item.file);
      const result = await json<{ preview: PayrollPreview; vehicles: OakVehicle[] }>(await fetch('/api/oak-payroll-imports', { method: 'POST', body }));
      patch(item.id,{preview:result.preview,vehicles:result.vehicles,range:{dateFrom:result.preview.dateFrom,dateTo:result.preview.dateTo},forms:payrollForms(result.preview),status:'ready',error:''});
    } catch (e) { patch(item.id,{status:'failed',error:(e as Error).message}); }
  }
  async function upload(values:File[]){
    setError('');setMessage(null);
    if(values.length>maxPayrollFiles){setError(`一次最多选择 ${maxPayrollFiles} 个工资文件`);return;}
    const next=values.map((file,index):PayrollFile=>({id:`payroll-file-${index}`,file,enabled:true,status:'reading',error:'',preview:null,vehicles:[],forms:{},range:{dateFrom:'',dateTo:''}}));
    setFiles(next);setActiveId(next[0].id);setPhase('preview');
    // Separate requests respect the existing per-file upload limit; at most two workbooks parse at once.
    let cursor=0;
    try{await Promise.all(Array.from({length:Math.min(2,next.length)},async()=>{while(cursor<next.length){const item=next[cursor++];await readFile(item);}}));}
    finally{setPhase(null);}
  }
  const update=(name:string,values:Partial<PayrollSheetForm>)=>setFiles(previous=>previous.map(item=>item.id===activeId&&item.preview?{...item,error:'',forms:{...item.forms,[name]:updatePayrollSheetForm({...item,preview:item.preview},name,values)}}:item));
  const selected = preview ? selectedPayrollSheets({preview,forms}) : [];
  const total = selected.reduce((sum, sheet) => {const value=Number(forms[sheet.sheetName].amount||0);return sum+(Number.isFinite(value)?Math.round(value*100):0);}, 0) / 100;
  const pendingFiles=files.filter(item=>item.enabled&&item.status!=='imported');
  const selectedCount=pendingFiles.reduce((sum,item)=>sum+(item.preview?selectedPayrollSheets({preview:item.preview,forms:item.forms}).length:0),0);
  const selectedFileCount=pendingFiles.filter(item=>item.preview&&selectedPayrollSheets({preview:item.preview,forms:item.forms}).length>0).length;
  async function confirm() {
    setError('');
    let plans:ReturnType<typeof planPayrollBatch>;
    try {
      const unread=pendingFiles.find(item=>!item.preview);
      if(unread)throw new PayrollBatchError(unread.id,`${unread.file.name}：文件尚未读取成功`);
      plans=planPayrollBatch(pendingFiles.filter((item):item is PayrollFile&{preview:PayrollPreview}=>Boolean(item.preview)));
    }catch(e){if(e instanceof PayrollBatchError)setActiveId(e.fileId);setError((e as Error).message);return;}
    setPhase('import');const completed:ImportResult[]=[],failed:string[]=[];
    try{
      for(const [index,plan] of plans.entries()){
        const item=files.find(item=>item.id===plan.id)!;setProgress(`正在导入 ${index+1} / ${plans.length}`);patch(item.id,{error:''});
        try{
          const body=new FormData();body.append('file',item.file);body.append('action','import');body.append('selection',JSON.stringify(plan.input));
          const result=await json<ImportResult>(await fetch('/api/oak-payroll-imports',{method:'POST',body}));
          completed.push(result);patch(item.id,{status:'imported',result,error:''});
        }catch(e){failed.push(item.id);patch(item.id,{status:'failed',error:(e as Error).message});}
      }
      const successes=[...files.filter(item=>item.status==='imported'&&item.result).map(item=>item.result!),...completed];
      const imported=successes.reduce((sum,result)=>sum+result.imported,0),duplicates=successes.reduce((sum,result)=>sum+result.duplicates,0);
      const jobs=successes.reduce((sum,result)=>sum+(result.activities?.added||0),0),jobWarnings=successes.filter(result=>result.activityWarning).length;
      setMessage({text:`已完成 ${successes.length} 个文件，导入 ${imported} 笔工资${duplicates?`，跳过 ${duplicates} 笔重复记录`:''}${jobs?`，同步 ${jobs} 段作业`:''}${jobWarnings?`，${jobWarnings} 个文件作业待审核`:''}${failed.length?`，${failed.length} 个文件失败`:''}`,warning:failed.length>0||jobWarnings>0});
      if(completed.length){const from=successes.map(item=>item.dateFrom).sort()[0],to=successes.map(item=>item.dateTo).sort().at(-1)!;onImported(Date.parse(to)-Date.parse(from)>1095*86400000?completed.at(-1)!:{dateFrom:from,dateTo:to});}
      if(failed.length){setActiveId(failed[0]);setError(`${completed.length} 个文件已完成，${failed.length} 个文件失败`);}
      else close();
    }finally{setPhase(null);setProgress('');}
  }
  return <>
    <button className="button primary" disabled={disabled || busy} onClick={() => fileInput.current?.click()}><Upload size={16}/>{phase==='preview' ? '正在读取...' : phase==='import'?'正在导入...':'上传工资 Excel'}</button>
    <input ref={fileInput} hidden type="file" multiple accept=".xlsx" aria-label="上传工资 Excel" onChange={event => { const values=Array.from(event.target.files||[]);if(values.length)void upload(values);event.target.value=''; }}/>
    {!files.length && error ? <div className="error oak-payroll-message" role="alert">{error}</div> : null}
    {message ? <div className={`oak-payroll-message ${message.warning?'pending':'oak-success'}`} role="status"><Check size={15}/>{message.text}</div> : null}
    {files.length ? <IncomeDialog title="确认工资导入" wide busy={busy} onClose={close}>
      {files.length>1?<div className="oak-payroll-batch-bar"><label>工资文件<select aria-label="工资导入文件" value={activeId} onChange={event=>{setActiveId(event.target.value);setDetails(null);}}>{files.map((item,index)=><option key={item.id} value={item.id}>{index+1}. {item.file.name} · {item.status==='reading'?'读取中':item.status==='imported'?'已完成':item.error?'失败':!item.enabled?'不导入':'待确认'}</option>)}</select></label><label className="oak-payroll-file-enabled"><input type="checkbox" aria-label="导入当前工资文件" disabled={busy||active.status==='imported'} checked={active.enabled} onChange={event=>patch(active.id,{enabled:event.target.checked})}/>导入此文件</label><span role="status">{phase==='preview'?`已读取 ${files.filter(item=>item.status!=='reading').length} / ${files.length} 个文件`:phase==='import'?progress:`已选 ${selectedFileCount} 个文件 · ${selectedCount} 笔`}</span></div>:null}
      <div className="oak-payroll-preview-head"><strong>{active.file.name}{active.status==='imported'?<span className="oak-source-tag">已完成 · {active.result?.imported} 笔</span>:null}</strong>{preview?<div className="oak-payroll-period"><label>工资开始日期<input aria-label="工资导入开始日期" disabled={locked} type="date" value={range.dateFrom} onChange={event=>patch(active.id,{range:{...range,dateFrom:event.target.value},error:''})}/></label><label>工资结束日期<input aria-label="工资导入结束日期" disabled={locked} type="date" value={range.dateTo} onChange={event=>patch(active.id,{range:{...range,dateTo:event.target.value},error:''})}/></label><span>本文件已选 {selected.length} 笔 <strong>{incomeMoney(total)}</strong></span></div>:null}</div>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {active.error?<div className="error oak-payroll-file-error" role="alert">{active.error}{!preview?<button className="icon-button" title="重新读取当前工资文件" disabled={busy} onClick={async()=>{setPhase('preview');patch(active.id,{status:'reading',error:''});try{await readFile(active);}finally{setPhase(null);}}}><RefreshCw size={15}/></button>:null}</div>:null}
      <div ref={previewScroll} className="oak-payroll-preview-scroll table-wrap">{preview?<table className="oak-payroll-preview-table" aria-label="工资导入预览"><thead><tr><th>导入</th><th>工作表</th><th>车辆 / 司机</th><th>类型</th><th>金额来源</th><th>金额 / USD</th><th>核对备注</th></tr></thead><tbody>{preview.sheets.map(sheet => {
        const form = forms[sheet.sheetName],rowLocked=locked||Boolean(sheet.existingId); return <tr key={sheet.sheetName} className={form.selected ? 'selected' : ''}>
          <td><input type="checkbox" aria-label={`导入工资 ${sheet.sheetName}`} disabled={locked || Boolean(sheet.existingId)} checked={form.selected} onChange={event => update(sheet.sheetName, { selected: event.target.checked })}/></td>
          <td><strong>{sheet.sheetName}</strong></td>
          <td><select aria-label={`${sheet.sheetName} 工资车辆`} disabled={locked || Boolean(sheet.existingId)} value={form.vehicleId} onChange={event => update(sheet.sheetName, { vehicleId: event.target.value })}><option value="">未关联</option>{vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.vehicleNumber || '暂无'} · {vehicle.driverName}</option>)}</select></td>
          <td><select aria-label={`${sheet.sheetName} 工资类型`} disabled={rowLocked} value={form.payeeType} onChange={event => update(sheet.sheetName, { payeeType: event.target.value })}><option value="">待确认</option><option value="driver">司机工资</option><option value="owner">车主工资</option></select></td>
          <td><div className="oak-payroll-candidate"><select aria-label={`${sheet.sheetName} 金额来源`} disabled={rowLocked} value={form.candidateId} onChange={event => { const candidate = sheet.candidates.find(item => item.id === event.target.value); update(sheet.sheetName, { candidateId: event.target.value, amount: candidate?.amount == null ? '' : candidate.amount.toFixed(2) }); }}>
            {sheet.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.label} · {candidate.amount == null ? '待核对' : incomeMoney(candidate.amount)}</option>)}<option value="manual">人工核定</option>
          </select><button className="icon-button" title={`查看工资来源 ${sheet.sheetName}`} onClick={() => { const candidate = sheet.candidates.find(item => item.id === form.candidateId); if (candidate) setDetails({ fileName: preview.fileName, fileHash: preview.fileHash, sheetName: sheet.sheetName, candidate, originalAmount: candidate.amount, confirmedAmount: Number(form.amount || 0), warnings: sheet.warnings, note: form.note }); }} disabled={form.candidateId === 'manual'}><FileText size={14}/></button></div></td>
          <td><input aria-label={`${sheet.sheetName} 导入金额`} disabled={rowLocked} type="number" min="0" step="0.01" value={form.amount} onChange={event => update(sheet.sheetName, { amount: event.target.value })}/></td>
          <td><input aria-label={`${sheet.sheetName} 核对备注`} disabled={rowLocked} maxLength={500} placeholder="人工调整时填写依据" value={form.note} onChange={event => update(sheet.sheetName, { note: event.target.value })}/>{payrollFormWarnings(sheet,form,vehicles).map(warning => <small className="pending" key={warning}>{warning}</small>)}</td>
        </tr>;
      })}</tbody></table>:<div className="oak-payroll-file-empty" role="status">{active.status==='reading'?'正在读取工资文件...':'文件未就绪'}</div>}</div>
      <footer className="oak-dialog-actions"><button className="button ghost" disabled={busy} onClick={close}>取消</button><button className="button primary" disabled={busy || !selectedCount} onClick={() => void confirm()}><Upload size={15}/>{phase==='preview'?'正在读取...':phase==='import'?'正在导入...':files.length>1?`导入 ${selectedFileCount} 个文件（${selectedCount} 笔）`:`确认导入 ${selectedCount} 笔`}</button></footer>
    </IncomeDialog> : null}
    {details ? <PayrollSourceDetails source={details} onClose={() => setDetails(null)}/> : null}
  </>;
}

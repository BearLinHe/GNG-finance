"use client";
import{useRef,useState,type RefObject}from'react';
import{Upload}from'lucide-react';
import{IncomeDialog,json}from'./oak-income-controls';
import type{OakVehicle}from'@/lib/oak-vehicles';
import type{PayeeType}from'@/lib/oak-payee';
type Preview={fileName:string;batchPeriod:{from:string;to:string};vehicles:OakVehicle[];warnings:string[];sheets:Array<{sheetName:string;vehicleId:string;payeeType:PayeeType|null;taskCount:number;existingCount:number;selected:boolean;warnings:string[]}>};
type Item={file:File;preview:Preview|null;error:string;done:boolean;enabled:boolean;confirmedWarnings:boolean};
export default function OakIncomeUpload({disabled,onImported,inputRef}:{disabled:boolean;onImported:()=>void;inputRef?:RefObject<HTMLInputElement>}){
  const localInput=useRef<HTMLInputElement>(null),input=inputRef||localInput;const[items,setItems]=useState<Item[]>([]),[index,setIndex]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const active=items[index],patch=(i:number,values:Partial<Item>)=>setItems(old=>old.map((item,n)=>n===i?{...item,...values}:item));
  async function read(files:File[]){
    if(files.length>20){setMessage('一次最多选择 20 个周表');return;}
    setBusy(true);setMessage('');setIndex(0);setItems(files.map(file=>({file,preview:null,error:'',done:false,enabled:true,confirmedWarnings:false})));
    for(const[i,file]of files.entries())try{const body=new FormData();body.append('file',file);if(file.size>4*1024*1024)throw Error('文件超过 4 MB');patch(i,{preview:await json<Preview>(await fetch('/api/oak-income-imports',{method:'POST',body}))});}catch(e){patch(i,{error:(e as Error).message});}
    setBusy(false);
  }
  function updateSheet(name:string,values:Record<string,unknown>){if(!active.preview)return;patch(index,{preview:{...active.preview,sheets:active.preview.sheets.map(sheet=>sheet.sheetName===name?{...sheet,...values}:sheet)}});}
  async function confirm(){
    const pending=items.map((item,i)=>({item,i})).filter(({item})=>item.enabled&&!item.done&&item.preview?.sheets.some(sheet=>sheet.selected));
    const unread=items.findIndex(item=>item.enabled&&!item.done&&!item.preview);if(unread>=0){setIndex(unread);patch(unread,{error:'此文件未读取成功，请重试或取消导入此文件'});return;}
    if(!pending.length)return;
    const unconfirmed=pending.find(({item})=>(item.preview!.warnings.length||item.preview!.sheets.some(sheet=>sheet.selected&&sheet.warnings.length))&&!item.confirmedWarnings);
    if(unconfirmed){setIndex(unconfirmed.i);patch(unconfirmed.i,{error:'请核对原表提示并勾选确认'});return;}
    setBusy(true);let added=0,skipped=0,failed=0;
    for(const{item,i}of pending)try{
      const mappings=item.preview!.sheets.filter(sheet=>sheet.selected).map(sheet=>({sheetName:sheet.sheetName,vehicleId:sheet.vehicleId,payeeType:sheet.payeeType}));
      const body=new FormData();body.append('file',item.file);body.append('action','import');body.append('selection',JSON.stringify({mappings,confirmedWarnings:item.confirmedWarnings}));
      const result=await json<{added:number;skipped:number}>(await fetch('/api/oak-income-imports',{method:'POST',body}));added+=result.added;skipped+=result.skipped;patch(i,{done:true,error:''});
    }catch(e){failed++;setIndex(i);patch(i,{error:(e as Error).message});}
    setBusy(false);setMessage(`新增 ${added} 段作业，跳过 ${skipped} 段已有作业${failed?`，${failed} 个文件待处理`:''}`);onImported();if(!failed)setItems([]);
  }
  const count=items.filter(item=>item.enabled&&!item.done).reduce((sum,item)=>sum+(item.preview?.sheets.filter(sheet=>sheet.selected).length||0),0);
  return<><button className="button primary" disabled={disabled||busy} onClick={()=>input.current?.click()}><Upload size={15}/>{busy?'正在处理...':'上传作业周表'}</button><input hidden multiple accept=".xlsx" type="file" ref={input} aria-label="上传收入作业周表" onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void read(files);}}/>{message?<div className="oak-payroll-message" role="status">{message}</div>:null}
    {active?<IncomeDialog title="确认周表作业" wide busy={busy} onClose={()=>setItems([])}>
      {items.length>1?<div className="oak-payroll-batch-bar"><label>周表文件<select aria-label="收入周表文件" value={index} onChange={e=>setIndex(Number(e.target.value))}>{items.map((item,i)=><option key={i} value={i}>{item.file.name} · {item.done?'已完成':item.error?'待处理':'待确认'}</option>)}</select></label></div>:null}
      <div className="oak-payroll-preview-head"><label className="oak-income-checkbox"><input aria-label="导入当前作业文件" type="checkbox" checked={active.enabled} disabled={busy||active.done} onChange={e=>patch(index,{enabled:e.target.checked})}/>导入此文件</label><strong>{active.file.name}</strong><span>{active.preview?.batchPeriod.from} 至 {active.preview?.batchPeriod.to}</span>{active.preview?.warnings.map(warning=><span className="pending" key={warning}>{warning}</span>)}</div>
      {active.error?<div className="error" role="alert">{active.error}</div>:null}
      <div className="oak-payroll-preview-scroll table-wrap"><table className="oak-income-import-table" aria-label="周表作业预览"><thead><tr><th>导入</th><th>原表名称</th><th>车辆</th><th>身份</th><th>作业路段</th><th>原表核对</th></tr></thead><tbody>{active.preview?.sheets.map(sheet=><tr key={sheet.sheetName}><td><input type="checkbox" aria-label={`导入作业 ${sheet.sheetName}`} checked={sheet.selected} disabled={busy||active.done||!active.enabled||sheet.existingCount>=sheet.taskCount} onChange={e=>updateSheet(sheet.sheetName,{selected:e.target.checked})}/></td><td>{sheet.sheetName}</td><td><select aria-label={`${sheet.sheetName} 作业车辆`} disabled={busy||active.done||!active.enabled} value={sheet.vehicleId} onChange={e=>updateSheet(sheet.sheetName,{vehicleId:e.target.value,selected:Boolean(e.target.value)&&sheet.existingCount<sheet.taskCount&&!sheet.warnings.length})}><option value="">未关联</option>{active.preview!.vehicles.map(vehicle=><option key={vehicle.id} value={vehicle.id}>{vehicle.vehicleNumber||'暂无'} · {vehicle.driverName}</option>)}</select></td><td><select aria-label={`${sheet.sheetName} 作业身份`} disabled={busy||active.done||!active.enabled} value={sheet.payeeType||''} onChange={e=>updateSheet(sheet.sheetName,{payeeType:e.target.value||null})}><option value="">待确认</option><option value="driver">司机</option><option value="owner">车主</option></select></td><td>{sheet.taskCount}<small>已有 {sheet.existingCount}</small></td><td>{sheet.warnings.join('；')||(!sheet.taskCount?'未识别到作业记录':!sheet.vehicleId?'请选择关联车辆':sheet.existingCount>=sheet.taskCount?'已导入，不重复新增':'—')}</td></tr>)}</tbody></table></div>
      {active.preview&&(active.preview.warnings.length>0||active.preview.sheets.some(sheet=>sheet.selected&&sheet.warnings.length))?<label className="oak-job-confirm-fields"><input aria-label="确认周表异常提示" type="checkbox" checked={active.confirmedWarnings} disabled={busy||active.done} onChange={e=>patch(index,{confirmedWarnings:e.target.checked,error:''})}/>已核对原表日期及路线提示</label>:null}
      <footer className="oak-dialog-actions"><button className="button ghost" disabled={busy} onClick={()=>setItems([])}>取消</button><button className="button primary" disabled={busy||!count} onClick={()=>void confirm()}><Upload size={15}/>{busy?'正在处理...':`导入 ${count} 张作业表`}</button></footer>
    </IncomeDialog>:null}</>;
}

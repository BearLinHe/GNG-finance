"use client";

import {useEffect,useState} from 'react';
import {ChevronDown,ChevronLeft,ChevronRight} from 'lucide-react';

type Props={page:number;pageSize:number;totalCount:number|null;loading:boolean;onPageChange:(page:number)=>void;onPageSizeChange:(size:number)=>void};
const quantity=(value:number)=>value.toLocaleString('en-US');

export default function OakIncomePagination({page,pageSize,totalCount,loading,onPageChange,onPageSizeChange}:Props){
  const total=totalCount??0,pages=Math.max(1,Math.ceil(total/pageSize)),current=Math.min(Math.max(1,page),pages);
  const [draft,setDraft]=useState(String(current));
  useEffect(()=>setDraft(String(current)),[current,pageSize,totalCount]);
  const first=total?(current-1)*pageSize+1:0,last=Math.min(current*pageSize,total);
  function jump(){
    if(loading)return;
    const value=/^\d+$/.test(draft)?Number(draft):current,next=Math.max(1,Math.min(pages,value));
    setDraft(String(next));if(next!==current)onPageChange(next);
  }
  return <nav className="oak-income-pagination" aria-label="车辆收入分页" aria-busy={loading}>
    <div className="oak-income-page-range" role="status">{loading?'读取中...':totalCount==null?'等待数据':total?<><span>显示</span> <strong>{quantity(first)}-{quantity(last)}</strong> <span>条，共</span> <strong>{quantity(total)}</strong> <span>条</span></>:<>共 <strong>0</strong> 条</>}</div>
    <div className="oak-income-page-controls">
      <label className="oak-income-page-size"><span>每页</span><span className="oak-income-page-select"><select aria-label="收入每页条数" value={pageSize} disabled={loading||totalCount==null} onChange={event=>onPageSizeChange(Number(event.target.value))}>{[100,200,300].map(size=><option key={size} value={size}>{size} 条</option>)}</select><ChevronDown size={13} aria-hidden="true"/></span></label>
      <div className="oak-income-page-navigation" role="group" aria-label="收入页码">
        <button className="icon-button" title="上一页" aria-label="上一页" disabled={loading||current<=1||totalCount==null} onClick={()=>onPageChange(current-1)}><ChevronLeft size={17}/></button>
        <label className="oak-income-page-number"><input aria-label="收入当前页" title="输入页码跳转" inputMode="numeric" maxLength={7} value={draft} disabled={loading||pages===1||totalCount==null} onChange={event=>{if(/^\d*$/.test(event.target.value))setDraft(event.target.value);}} onBlur={jump} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}else if(event.key==='Escape'){event.preventDefault();setDraft(String(current));}}}/><span>/ {quantity(pages)} 页</span></label>
        <button className="icon-button" title="下一页" aria-label="下一页" disabled={loading||current>=pages||totalCount==null} onClick={()=>onPageChange(current+1)}><ChevronRight size={17}/></button>
      </div>
    </div>
  </nav>;
}

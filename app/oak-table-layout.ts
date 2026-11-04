"use client";
import {useEffect,useMemo,useRef,useState,type DragEvent,type RefObject} from "react";
import {moveTableItem,reconcileTableOrder} from "@/lib/oak-table-order";
import {fitTableColumnWidths,sanitizeTableColumnWidths,type TableColumnSize,type TableColumnWidths} from '@/lib/oak-table-sizing';
export function useTableOrder(key:string,ids:string[]) {
  const [stored,setStored]=useState<string[]>([]);const signature=ids.join('\u0000');
  useEffect(()=>{try{const value=JSON.parse(localStorage.getItem(key)||'[]');setStored(Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'):[]);}catch{setStored([]);}},[key]);
  const order=useMemo(()=>reconcileTableOrder(stored,ids),[stored,signature]);
  const update=(next:string[])=>{setStored(next);try{localStorage.setItem(key,JSON.stringify(next));}catch{}};
  return {order,update,move:(from:string,to:string)=>update(moveTableItem(order,from,to))};
}
export function tableDrag(scope:string,kind:'column'|'row',id:string,move:(from:string,to:string)=>void) {
  const type='application/x-gng-table';
  return {drag:{draggable:true,onDragStart:(event:DragEvent<HTMLElement>)=>{event.dataTransfer.setData(type,JSON.stringify({scope,kind,id}));event.dataTransfer.effectAllowed='move';}},
    drop:{onDragOver:(event:DragEvent<HTMLElement>)=>{if(event.dataTransfer.types.includes(type)){event.preventDefault();event.dataTransfer.dropEffect='move';}},onDrop:(event:DragEvent<HTMLElement>)=>{try{const source=JSON.parse(event.dataTransfer.getData(type));if(source.scope===scope&&source.kind===kind){event.preventDefault();move(source.id,id);}}catch{}}}};
}

export function useResponsiveTableSizing(element:RefObject<HTMLDivElement>,columns:TableColumnSize[],storageKey:string){
  const [width,setWidth]=useState(0),[stored,setStored]=useState<{key:string;widths:TableColumnWidths}>({key:storageKey,widths:{}});
  const manual=stored.key===storageKey?stored.widths:{};
  const current=useRef(manual);current.current=manual;
  const signature=JSON.stringify(columns);
  useEffect(()=>{
    let widths:TableColumnWidths={};
    try{widths=sanitizeTableColumnWidths(JSON.parse(localStorage.getItem(storageKey)||'{}'),columns);}catch{}
    current.current=widths;setStored({key:storageKey,widths});
  },[storageKey,signature]);
  useEffect(()=>{
    const node=element.current;if(!node)return;
    const measure=()=>{if(node.clientWidth>0)setWidth(previous=>previous===node.clientWidth?previous:node.clientWidth);};
    measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();
  },[element]);
  const columnSizing=useMemo(()=>fitTableColumnWidths(columns,width,manual),[signature,width,manual]);
  function commit(widths:TableColumnWidths){current.current=widths;setStored({key:storageKey,widths});try{localStorage.setItem(storageKey,JSON.stringify(widths));}catch{}}
  function onColumnSizingChange(update:TableColumnWidths|((previous:TableColumnWidths)=>TableColumnWidths)){
    const before=fitTableColumnWidths(columns,width,current.current),next=typeof update==='function'?update(before):update;
    if(!Object.keys(next).length){commit({});return;}
    const widths={...current.current};
    for(const column of columns)if(typeof next[column.id]==='number'&&Math.abs(next[column.id]-before[column.id])>=.5)widths[column.id]=next[column.id];
    commit(sanitizeTableColumnWidths(widths,columns));
  }
  function resetSizing(id?:string){if(!id){commit({});return;}const widths={...current.current};delete widths[id];commit(widths);}
  return {columnSizing,onColumnSizingChange,resetSizing,hasManualSizing:Object.keys(manual).length>0};
}

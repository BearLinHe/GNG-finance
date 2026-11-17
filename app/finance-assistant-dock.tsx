'use client';

import dynamic from 'next/dynamic';
import { MessagesSquare, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AssistantPage } from '@/lib/finance-assistant';
import styles from './oak-finance-assistant.module.css';

const FinanceAssistant = dynamic(() => import('./oak-finance-assistant'), { loading: () => <p role="status">正在打开助手…</p> });
export default function FinanceAssistantDock({ initialOpen, module, title, readPage }: {
  initialOpen:boolean; module:AssistantPage['module']; title:string; readPage:()=>AssistantPage
}) {
  const [open,setOpen]=useState(initialOpen), [visited,setVisited]=useState(initialOpen);
  const panel=useRef<HTMLDialogElement>(null), launcher=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const el=panel.current;
    if(!el || !open)return;
    const media=window.matchMedia('(max-width: 680px)');
    const display=()=>{if(el.open)el.close();if(media.matches)el.showModal();else el.show();el.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});};
    const size=()=>{el.style.setProperty('--available-height', (window.visualViewport?.height ?? window.innerHeight)+'px');el.style.setProperty('--keyboard-top',(window.visualViewport?.offsetTop??0)+'px');};
    display();size();media.addEventListener('change',display);window.visualViewport?.addEventListener('resize',size);window.visualViewport?.addEventListener('scroll',size);
    return ()=>{media.removeEventListener('change',display);window.visualViewport?.removeEventListener('resize',size);window.visualViewport?.removeEventListener('scroll',size);el.close();launcher.current?.focus({preventScroll:true});};
  },[open]);
  const close=()=>setOpen(false);
  return <>
    <button type="button" className={styles.launcher} ref={launcher} aria-label={open?'收起财务助手':'打开财务助手'} title={open?'收起财务助手':'打开财务助手'} aria-expanded={open} aria-controls="finance-assistant-panel" aria-haspopup="dialog" onClick={()=>{setVisited(true);setOpen(!open);}}>
      {open?<X size={19}/>:<MessagesSquare size={19}/>}<span>财务助手</span>
    </button>
    <dialog id="finance-assistant-panel" className={styles.panel} ref={panel} aria-label="财务助手" onCancel={e=>{e.preventDefault();close();}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();close();}}}>
      <header className={styles.panelHead}><div className={styles.mark}><MessagesSquare size={20}/></div><div><h2>财务助手</h2><small>{title}</small></div><button className="icon-button" aria-label="关闭财务助手" title="关闭财务助手" onClick={close}><X size={18}/></button></header>
      {visited && <FinanceAssistant module={module} readPage={readPage}/>}
    </dialog>
  </>;
}

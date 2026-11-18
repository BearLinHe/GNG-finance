'use client';

import { createContext, createElement, useContext, useEffect, type MutableRefObject, type ReactNode } from 'react';

const Availability=createContext(false);
export function AssistantAvailability({enabled,children}:{enabled:boolean;children:ReactNode}){
  return createElement(Availability.Provider,{value:enabled},children);
}
export const useAssistantEnabled=()=>useContext(Availability);
export type FactSource = { key: string; read: () => object | null };
export const FinancePageContext = createContext<MutableRefObject<FactSource | null> | null>(null);

// Collect only the explicitly selected accounting fields, and only on send.
export function useFinancePageFacts(key: string, read: FactSource['read'], active = true) {
  const ref = useContext(FinancePageContext);
  const enabled=useAssistantEnabled();
  useEffect(() => {
    if (!ref || !active || !enabled) return;
    const source = { key, read };
    ref.current = source;
    return () => { if (ref.current === source) ref.current = null; };
  }, [ref, key, read, active, enabled]);
}

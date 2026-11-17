'use client';

import { createContext, useContext, useEffect, type MutableRefObject } from 'react';

export const localAssistantEnabled = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_OAK_LOCAL_ASSISTANT === '1';
export type FactSource = { key: string; read: () => object | null };
export const FinancePageContext = createContext<MutableRefObject<FactSource | null> | null>(null);

// Collect only the explicitly selected accounting fields, and only on send.
export function useFinancePageFacts(key: string, read: FactSource['read'], active = true) {
  const ref = useContext(FinancePageContext);
  useEffect(() => {
    if (!ref || !active || !localAssistantEnabled) return;
    const source = { key, read };
    ref.current = source;
    return () => { if (ref.current === source) ref.current = null; };
  }, [ref, key, read, active]);
}

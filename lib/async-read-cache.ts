type Entry<T> = { value?: T; expiresAt: number; pending?: Promise<T> };

export function createAsyncReadCache<T>({ ttlMs, maxEntries = 8, now = Date.now, cacheable = () => true }: {
  ttlMs: number; maxEntries?: number; now?: () => number; cacheable?: (value: T) => boolean;
}) {
  const entries = new Map<string, Entry<T>>();
  return {
    read(key: string, load: () => Promise<T>, fresh = false): Promise<T> {
      const previous = entries.get(key);
      if (!fresh && previous?.pending) return previous.pending;
      if (!fresh && previous && previous.expiresAt > now()) return Promise.resolve(previous.value!);
      const entry: Entry<T> = { expiresAt: 0 };
      const pending = Promise.resolve().then(load).then(value => {
        if (entries.get(key) === entry) {
          if (ttlMs > 0 && cacheable(value)) {
            entry.value = value; entry.expiresAt = now() + ttlMs; entry.pending = undefined;
          } else entries.delete(key);
        }
        return value;
      }, error => { if (entries.get(key) === entry) entries.delete(key); throw error; });
      entry.pending = pending;
      entries.delete(key); entries.set(key, entry);
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
      return pending;
    }
  };
}

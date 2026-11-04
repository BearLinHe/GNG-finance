export type TableColumnSize = { id: string; size: number; minSize: number; maxSize: number };
export type TableColumnWidths = Record<string, number>;

export function sanitizeTableColumnWidths(value: unknown, columns: readonly TableColumnSize[]): TableColumnWidths {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return Object.fromEntries(columns.flatMap(column => {
    const width = source[column.id];
    return typeof width === 'number' && Number.isFinite(width) ? [[column.id, Math.max(column.minSize, Math.min(column.maxSize, Math.round(width)))]] : [];
  }));
}

export function fitTableColumnWidths(columns: readonly TableColumnSize[], availableWidth: number, manualWidths: TableColumnWidths = {}): TableColumnWidths {
  const manual = sanitizeTableColumnWidths(manualWidths, columns);
  const sizes = Object.fromEntries(columns.map(column => [column.id, manual[column.id] ?? column.minSize]));
  const minimum = Object.values(sizes).reduce((sum, width) => sum + width, 0);
  const preferred = columns.reduce((sum, column) => sum + (manual[column.id] ?? column.size), 0);
  const target = Math.max(minimum, Number.isFinite(availableWidth) && availableWidth > 0 ? Math.floor(availableWidth) : preferred);
  let remaining = target - minimum;
  let flexible = columns.filter(column => manual[column.id] == null && sizes[column.id] < column.maxSize);
  // Manual widths stay fixed; distribute available space among the remaining columns.
  while (remaining > 0 && flexible.length) {
    const weight = flexible.reduce((sum, column) => sum + Math.max(1, column.size - column.minSize), 0);
    const budget = remaining;
    let allocated = 0;
    for (const column of flexible) {
      const amount = Math.min(column.maxSize - sizes[column.id], Math.floor(budget * Math.max(1, column.size - column.minSize) / weight));
      sizes[column.id] += amount; allocated += amount;
    }
    remaining -= allocated;
    flexible = flexible.filter(column => sizes[column.id] < column.maxSize);
    if (!allocated) for (const column of flexible) {
      if (!remaining) break;
      sizes[column.id]++; remaining--;
    }
  }
  return sizes;
}

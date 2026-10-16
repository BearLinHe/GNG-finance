export type DriverBatchPeriod = { from: string; to: string };

function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10) : null;
}

export function resolveDriverBatchPeriod(fileName: string, firstWorkDate: string): DriverBatchPeriod {
  const anchor = new Date(`${firstWorkDate}T00:00:00Z`);
  if (!Number.isFinite(anchor.getTime())) throw new Error("无法确认批次年份，请检查作业日期");
  const match = fileName.match(/(\d{1,2})[_/.](\d{1,2})\s*-\s*(\d{1,2})[_/.](\d{1,2})/);
  if (match) {
    const startMonth = Number(match[1]);
    const endMonth = Number(match[3]);
    const crossesYear = endMonth < startMonth;
    const year = anchor.getUTCFullYear() - (crossesYear && anchor.getUTCMonth() + 1 <= endMonth ? 1 : 0);
    const from = isoDate(year, startMonth, Number(match[2]));
    const to = isoDate(year + (crossesYear ? 1 : 0), endMonth, Number(match[4]));
    if (from && to && from <= to) return { from, to };
  }
  const from = new Date(anchor);
  // Saturday starts the week; UTC keeps host timezones from shifting the boundary.
  from.setUTCDate(from.getUTCDate() - (from.getUTCDay() + 1) % 7);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 6);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

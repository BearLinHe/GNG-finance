import type { VehicleRange } from './oak-vehicle-accounting';

export type VehicleDriverChange = {
  id: string;
  vehicleId: string;
  driverName: string;
  effectiveDate: string | null;
  version: number;
};

export type VehicleDriverPeriod = VehicleRange & { driverName: string };

export function vehicleDriverPeriods(initialName: string, changes: VehicleDriverChange[], range: VehicleRange): VehicleDriverPeriod[] {
  let driverName = changes.find(change => change.effectiveDate === null)?.driverName ?? initialName;
  let dateFrom = range.dateFrom;
  const periods: VehicleDriverPeriod[] = [];
  const dated = changes.filter(change => change.effectiveDate !== null).sort((a, b) => a.effectiveDate!.localeCompare(b.effectiveDate!));
  for (const change of dated) {
    const effective = change.effectiveDate!;
    if (effective > range.dateTo) break;
    if (change.driverName === driverName) continue;
    if (effective > dateFrom) {
      const previousDay = new Date(Date.parse(`${effective}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
      periods.push({ dateFrom, dateTo: previousDay, driverName });
      dateFrom = effective;
    }
    driverName = change.driverName;
  }
  periods.push({ dateFrom, dateTo: range.dateTo, driverName });
  return periods;
}

export function vehicleDriverLabel(initialName: string, periods?: VehicleDriverPeriod[]) {
  return periods?.length ? [...new Set(periods.map(period => period.driverName))].join('、') : initialName;
}

import type { VehicleAmount } from './oak-vehicle-amounts';
import type { VehicleRange } from './oak-vehicle-accounting';

export type PayrollActivityLink = VehicleRange & {
  vehicleId: string; fileHash: string; sheetName: string; taskIds: string[];
};
export type PayrollActivityTarget = Omit<PayrollActivityLink, keyof VehicleRange> & {
  dateFrom: string | null; dateTo: string | null;
};
export type PayrollActivityWage = Pick<VehicleAmount, 'vehicleId' | 'dateFrom' | 'dateTo' | 'payroll'>;

export function matchesPayrollActivityLink(wage: PayrollActivityWage, target: PayrollActivityTarget) {
  const link = wage.payroll?.activityLink;
  if (!(link && link.vehicleId === wage.vehicleId && link.vehicleId === target.vehicleId
    && link.dateFrom === wage.dateFrom && link.dateTo === wage.dateTo
    && link.dateFrom === target.dateFrom && link.dateTo === target.dateTo
    && link.fileHash === target.fileHash && link.sheetName === target.sheetName
    && link.taskIds.length > 0 && link.taskIds.length === target.taskIds.length)) return false;
  const ids = new Set(target.taskIds);
  return new Set(link.taskIds).size === ids.size && link.taskIds.every(id => ids.has(id));
}

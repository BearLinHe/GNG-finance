import type { PayeeType } from './oak-payee';
import type { OakVehicle } from './oak-vehicles';
import { incomeAmount, incomeText } from './oak-income';
import { vehicleRange, type VehicleRange } from './oak-vehicle-accounting';
import type { PayrollActivityLink } from './oak-payroll-activity';

export type PayrollCell = { address: string; value: string | number | null };
export type PayrollCandidate = { id: string; label: string; amount: number | null; cells: PayrollCell[] };
export type PayrollSheet = { sheetName: string; vehicleId: string | null; payeeType: PayeeType | null;
  candidateId: string; amount: number | null; selected: boolean; candidates: PayrollCandidate[]; warnings: string[]; existingId?: string };
export type PayrollPreview = VehicleRange & { fileName: string; fileHash: string; sheets: PayrollSheet[]; skippedSheets: string[] };
export type PayrollSource = { fileName: string; fileHash: string; sheetName: string; candidate: PayrollCandidate;
  originalAmount: number | null; confirmedAmount: number; warnings: string[]; note: string; activityLink?: PayrollActivityLink };
export type PayrollSelection = { sheetName: string; vehicleId: string; payeeType: PayeeType; candidateId: string; amount: number; note: string };
export type PayrollImportInput = VehicleRange & { selections: PayrollSelection[] };
export const payrollWarningLabels = {
  vehicle: '未关联车辆，请选择车号后再导入',
  payeeType: '请确认是司机工资还是车主工资'
} as const;

export function validatePayrollSelection(value: unknown, preview: PayrollPreview, vehicles: OakVehicle[]): PayrollImportInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('工资导入内容无效');
  const body = value as Record<string, unknown>;
  const range = vehicleRange(body);
  if (!Array.isArray(body.selections) || !body.selections.length || body.selections.length > 100) throw new Error('请选择要导入的工资工作表');
  const seenSheets = new Set<string>(), seenVehicles = new Set<string>();
  const selections = body.selections.map((raw: Record<string, unknown>) => {
    if (!raw || typeof raw !== 'object') throw new Error('工资归属无效');
    const sheet = preview.sheets.find(item => item.sheetName === raw.sheetName);
    if (!sheet || seenSheets.has(sheet.sheetName)) throw new Error('工作表无效或重复');
    seenSheets.add(sheet.sheetName);
    const vehicle = vehicles.find(item => item.id === raw.vehicleId);
    if (!vehicle) throw new Error(`${sheet.sheetName}：请选择关联车辆`);
    if (seenVehicles.has(vehicle.id)) throw new Error(`${vehicle.vehicleNumber || vehicle.driverName} 在同一周期有多张工资表，请只选择一张，避免重复计入`);
    seenVehicles.add(vehicle.id);
    if (raw.payeeType !== 'driver' && raw.payeeType !== 'owner') throw new Error(`${sheet.sheetName}：请选择司机工资或车主工资`);
    const candidate = sheet.candidates.find(item => item.id === raw.candidateId);
    if (!candidate && raw.candidateId !== 'manual') throw new Error('金额来源无效');
    const amount = incomeAmount(raw.amount);
    const note = incomeText(raw.note, 500) || '';
    if ((!candidate || candidate.amount == null || Math.round(candidate.amount * 100) !== Math.round(amount * 100)) && !note) throw new Error(`${sheet.sheetName}：人工调整金额请填写核对备注`);
    return { sheetName: sheet.sheetName, vehicleId: vehicle.id, payeeType: raw.payeeType as PayeeType,
      candidateId: String(raw.candidateId), amount, note };
  });
  return { ...range, selections };
}

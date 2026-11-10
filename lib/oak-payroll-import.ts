import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { cellValue, dateValue, text, MAX_DRIVER_WORKBOOK_BYTES } from './oak-driver-import';
import { resolveDriverBatchPeriod } from './oak-driver-batch';
import { payeeIdentity } from './oak-payee';
import { vehicleForSubject, type OakVehicle } from './oak-vehicles';
import {payrollWarningLabels,type PayrollCandidate,type PayrollCell,type PayrollPreview,type PayrollSheet} from './oak-payroll';
import { restoreWorkbookCachedZeros } from './oak-workbook-cache';
import { workbookDataSheets } from './oak-workbook-bounds';

const header = (value: string) => value.toLowerCase().replace(/[\s_]/g, '');
const cents = (cell: ExcelJS.Cell): number | null => {
  const value = cellValue(cell);
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\$?\s*[\d,]+(?:\.\d+)?\s*$/.test(value) ? Number(value.replace(/[$,\s]/g, '')) : NaN;
  return Number.isFinite(number) && number >= 0 && number <= 9999999999.99 ? Math.round(number * 100) : null;
};
const evidence = (cell: ExcelJS.Cell): PayrollCell => ({ address: cell.address, value: typeof cellValue(cell) === 'number' ? cellValue(cell) as number : text(cell) || cell.text || null });
type Section = { name: string; start: number; end: number; totalRow: number; columns: Record<string, number>; headerRow: number; ratePayroll: boolean };

function sections({ sheet, rowCount, columnCount }: ReturnType<typeof workbookDataSheets>[number]): Section[] {
  for (let row = 1; row <= Math.min(rowCount, 20); row++) {
    const dates: number[] = [];
    for (let col = 1; col <= columnCount; col++) if (/^(date|日期|作业日期)$/.test(header(text(sheet.getCell(row, col))))) dates.push(col);
    const result: Section[] = [];
    for (let index = 0; index < dates.length; index++) {
      const start = dates[index], end = (dates[index + 1] || columnCount + 1) - 1, columns: Record<string, number> = {};
      for (let col = start + 1; col <= end; col++) {
        const label = header(text(sheet.getCell(row, col)));
        if (/^(driver|司机|司机工资)$/.test(label)) columns.driver = col;
        if (/^(owner|车主|车主价格|车主工资)$/.test(label)) columns.owner = col;
        if (/^(amount|金额)$/.test(label) && !columns.amount) columns.amount = col;
        if (/^(from|起点|出发地)$/.test(label)) columns.from = col;
        if (/^(to|终点|目的地)$/.test(label)) columns.to = col;
        if (/^(nature|性质|作业|作业内容)$/.test(label)) columns.nature = col;
        if (/^(柜号|container|reference)$/.test(label)) columns.reference = col;
        if (/^(miles|里程)$/.test(label) && !columns.miles) columns.miles = col;
        if (label === 'rate' && !columns.rate) columns.rate = col;
      }
      if (!columns.from || !columns.to || !columns.nature) continue;
      let totalRow = 0;
      for (let r = row + 1; r <= rowCount; r++) if (/^(total|合计|总计)$/i.test(text(sheet.getCell(r, start)))) { totalRow = r; break; }
      let ratePayroll = false;
      if (!columns.driver && !columns.amount) {
        // A Rate column is payroll only in the CA layout with an explicit sum of its detail rows.
        if (columns.reference || columns.from !== start + 1 || columns.to !== start + 2 || columns.nature !== start + 3
          || columns.miles !== start + 4 || columns.rate !== start + 5 || totalRow <= row + 1) continue;
        const total = sheet.getCell(totalRow, columns.rate), col = total.address.replace(/\d+$/, '');
        const formula = total.formula?.replace(/[\s$]/g, '').replace(/^=/, '').toUpperCase();
        if (formula !== `SUM(${col}${row + 1}:${col}${totalRow - 1})`) continue;
        columns.driver = columns.rate;
        ratePayroll = true;
      }
      result.push({ name: columns.reference ? '海柜' : 'Local', start, end, totalRow, columns, headerRow: row, ratePayroll });
    }
    if (result.length) return result;
  }
  return [];
}

function sectionTotal(sheet: ExcelJS.Worksheet, rowCount: number, section: Section, kind: 'driver' | 'amount', warnings: Set<string>) {
  const col = section.columns[kind] || (!section.columns.driver && kind === 'driver' ? section.columns.amount : 0);
  if (!col) return null;
  const rows: PayrollCell[] = []; let sum = 0, populated = false, invalid = false;
  for (let r = section.headerRow + 1; r < (section.totalRow || rowCount + 1); r++) {
    const cell = sheet.getCell(r, col);
    if (cell.isMerged && cell.master.address !== cell.address) continue;
    const raw = cell.value;
    if (raw == null || raw === '') continue;
    const amount = cents(cell); rows.push(evidence(cell));
    if (amount == null) invalid = true; else { sum += amount; populated = true; }
  }
  const totalCell = section.totalRow ? sheet.getCell(section.totalRow, col) : null;
  const total = totalCell ? cents(totalCell) : null;
  if (totalCell && totalCell.value != null && total == null) warnings.add(`${section.name} ${totalCell.address} 合计无有效数值`);
  if (invalid) warnings.add(`${section.name} ${kind === 'driver' ? 'Driver' : 'Amount'} 明细含无效金额`);
  if (total != null && populated && !invalid && total !== sum) warnings.add(`${section.name} 合计与明细相差 $${(Math.abs(total - sum) / 100).toFixed(2)}`);
  return { amount: total != null ? total : !section.ratePayroll && populated && !invalid ? sum : null, cells: totalCell ? [evidence(totalCell), ...rows] : rows };
}

function combinedCandidate(sheet: ExcelJS.Worksheet, rowCount: number, blocks: Section[], kind: 'driver' | 'amount', warnings: Set<string>): PayrollCandidate | null {
  const parts = blocks.map(block => sectionTotal(sheet, rowCount, block, kind, warnings));
  if (parts.every(part => !part)) return null;
  const amount = parts.every(part => part?.amount != null) ? parts.reduce((sum, part) => sum + part!.amount!, 0) / 100 : null;
  const columnLabel = kind === 'amount' ? 'Amount' : blocks.every(block => block.ratePayroll) ? 'Rate' : 'Driver';
  return { id: kind, label: `${blocks.map(block => block.name).join(' + ')}合计（${columnLabel}）`, amount, cells: parts.flatMap(part => part?.cells || []) };
}

export async function parsePayrollWorkbook(buffer: Buffer, fileName: string, vehicles: OakVehicle[]): Promise<PayrollPreview> {
  if (!/\.xlsx$/i.test(fileName)) throw new Error('请选择 .xlsx 格式的工资 Excel');
  if (!buffer.length || buffer.length > MAX_DRIVER_WORKBOOK_BYTES) throw new Error('Excel 文件不能为空，且不能超过 4 MB');
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer, { ignoreNodes: ['drawing', 'picture', 'extLst'] }); }
  catch { throw new Error('无法读取 Excel，请确认文件未损坏、未加密'); }
  const dataSheets = workbookDataSheets(workbook);
  const blocksBySheet = dataSheets.map(data => /模板|template|油税/i.test(data.sheet.name) ? [] : sections(data));
  await restoreWorkbookCachedZeros(workbook, buffer);
  const sheets: PayrollSheet[] = [], skippedSheets: string[] = []; let firstDate = '';
  for (const [index, { sheet, rowCount }] of dataSheets.entries()) {
    const blocks = blocksBySheet[index];
    if (!blocks.length) { skippedSheets.push(sheet.name); continue; }
    for (const block of blocks) for (let r = block.headerRow + 1; r < (block.totalRow || rowCount + 1); r++) {
      const date = dateValue(sheet.getCell(r, block.start), null);
      if (date && (!firstDate || date < firstDate)) firstDate = date;
    }
    const warnings = new Set<string>(); const candidates: PayrollCandidate[] = [];
    const vehicle = vehicleForSubject(vehicles, sheet.name), role = payeeIdentity(sheet.name).type;
    if (!vehicle) warnings.add(payrollWarningLabels.vehicle);
    if (!role) warnings.add(payrollWarningLabels.payeeType);
    const driver = combinedCandidate(sheet, rowCount, blocks, 'driver', warnings), amount = combinedCandidate(sheet, rowCount, blocks, 'amount', new Set());
    if (driver) candidates.push(driver);
    if (amount) candidates.push(amount);
    const main = blocks[0];
    for (let row = (main.totalRow || main.headerRow) + 1; row <= Math.min(rowCount, (main.totalRow || main.headerRow) + 30); row++) {
      for (let col = main.start; col < Math.min(main.end, main.columns.driver || main.columns.amount); col++) {
        const cell = sheet.getCell(row, col), label = text(cell).replace(/\s/g, '');
        if (cell.isMerged && cell.master.address !== cell.address) continue;
        const kind = /^支票金额$/.test(label) ? 'check' : /^车主薪水$/.test(label) ? 'ownerSalary' : /^(total|合计|总计)$/i.test(label) && col > main.start ? 'final' : null;
        if (!kind) continue;
        const valueCell = sheet.getCell(row, main.columns.driver || main.columns.amount), value = cents(valueCell);
        candidates.push({ id: `${kind}-${valueCell.address}`, label: kind === 'final' ? '整表合计' : label, amount: value == null ? null : value / 100, cells: [evidence(cell), evidence(valueCell)] });
      }
    }
    const ownerHasSeparateAmounts = blocks.some(block => block.columns.owner && Array.from({ length: Math.max(0, (block.totalRow || block.headerRow) - block.headerRow - 1) }, (_, i) => cents(sheet.getCell(block.headerRow + 1 + i, block.columns.owner))).some(value => value != null && value > 0));
    const base = role === 'owner' && ownerHasSeparateAmounts ? amount : driver;
    const chosen = candidates.find(item => item.id.startsWith('check-')) || candidates.find(item => item.id.startsWith('final-')) || base;
    if (chosen?.amount != null && base?.amount != null && Math.round(chosen.amount * 100) !== Math.round(base.amount * 100)) warnings.add(`${chosen.label}与海柜/Local 合计不同，请核对`);
    if (chosen?.amount == null) warnings.add('未确认工资金额，请选择来源或人工填写');
    sheets.push({ sheetName: sheet.name, vehicleId: vehicle?.id || null, payeeType: role, candidateId: chosen?.id || 'manual', amount: chosen?.amount ?? null,
      selected: Boolean(vehicle && role && chosen?.amount != null && !warnings.size), candidates, warnings: [...warnings] });
  }
  if (!sheets.length) throw new Error('没有找到可识别的工资表：需要 Driver、Amount，或带合计公式的加州 Rate 列');
  if (!firstDate) throw new Error('无法确认工资周期年份，请在工作表中填写完整作业日期');
  const period = resolveDriverBatchPeriod(fileName, firstDate);
  for (const sheet of sheets) if (sheet.vehicleId && sheets.filter(other => other.vehicleId === sheet.vehicleId).length > 1) {
    sheet.warnings.push('同一车辆关联多张工资表，请只选一张，避免重复计算'); sheet.selected = false;
  }
  return { fileName, fileHash: createHash('sha256').update(buffer).digest('hex'), dateFrom: period.from, dateTo: period.to, sheets, skippedSheets };
}

export const payrollRequestKey = (fileHash: string, sheetName: string) => `payroll-${createHash('sha256').update(JSON.stringify([fileHash, sheetName])).digest('hex')}`;

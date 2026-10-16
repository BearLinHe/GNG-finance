import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import type { DriverTask, DriverWorkbookPreview } from "./oak-driver-types";
import { resolveDriverBatchPeriod } from "./oak-driver-batch";

export const MAX_DRIVER_WORKBOOK_BYTES = 4 * 1024 * 1024;

function cellValue(cell: ExcelJS.Cell): string | number | Date | null {
  const value = cell.value;
  if (value == null) return null;
  if (value instanceof Date || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) {
      const result = value.result;
      return result instanceof Date || typeof result === "string" || typeof result === "number" ? result : null;
    }
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return value.text;
  }
  return null;
}

function text(cell: ExcelJS.Cell) {
  const value = cellValue(cell);
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").trim();
}

function dateValue(cell: ExcelJS.Cell, year: number | null): string | null {
  const value = cellValue(cell);
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value !== "string") return null;
  const full = value.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s.*)?$/);
  const short = value.trim().match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?$/);
  const parts = full ? [Number(full[1]), Number(full[2]), Number(full[3])]
    : short && (short[3] || year) ? [Number(short[3] || year), Number(short[1]), Number(short[2])] : null;
  if (!parts) return null;
  const [y, m, d] = parts;
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d
    ? parsed.toISOString().slice(0, 10) : null;
}

const normalizedHeader = (value: string) => value.toLowerCase().replace(/[\s_]/g, "");

export async function parseDriverWorkbook(buffer: Buffer, fileName: string): Promise<DriverWorkbookPreview> {
  if (!/\.xlsx$/i.test(fileName)) throw new Error("请选择 .xlsx 格式的 Excel 文件");
  if (!buffer.length || buffer.length > MAX_DRIVER_WORKBOOK_BYTES) throw new Error("Excel 文件不能为空，且不能超过 4 MB");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer, { ignoreNodes: ["drawing", "picture", "extLst"] });
  } catch {
    throw new Error("无法读取 Excel，请确认文件未损坏、未加密，并使用 .xlsx 格式");
  }
  if (workbook.worksheets.length > 100) throw new Error("工作表过多，请将文件拆分为不超过 100 个工作表");
  if (workbook.worksheets.some(sheet => sheet.rowCount > 10000 || sheet.columnCount > 100)) {
    throw new Error("表格超出支持范围：每表最多 10000 行、100 列");
  }
  let year: number | null = null;
  for (const sheet of workbook.worksheets) {
    for (let r = 1; r <= Math.min(sheet.rowCount, 100); r++) {
      const value = cellValue(sheet.getCell(r, 1));
      if (value instanceof Date && Number.isFinite(value.getTime())) { year = value.getUTCFullYear(); break; }
    }
    if (year) break;
  }
  const preview: Omit<DriverWorkbookPreview, "batchPeriod"> = {
    fileName, fileHash: createHash("sha256").update(buffer).digest("hex"), sheets: [], tasks: [], skippedSheets: [], warnings: []
  };
  for (const sheet of workbook.worksheets) {
    if (/模板|template|油税/i.test(sheet.name)) {
      preview.skippedSheets.push({ sheetName: sheet.name, reason: "模板或油税表，不作为司机作业导入" });
      continue;
    }
    const sheetTasks: DriverTask[] = [];
    const warnings = new Set<string>();
    let recognized = false;
    for (let headerRow = 1; headerRow <= Math.min(sheet.rowCount, 20); headerRow++) {
      const dateColumns: number[] = [];
      for (let c = 1; c <= sheet.columnCount; c++) {
        if (/^(date|日期|作业日期)$/.test(normalizedHeader(text(sheet.getCell(headerRow, c))))) dateColumns.push(c);
      }
      for (let block = 0; block < dateColumns.length; block++) {
        const start = dateColumns[block];
        let end = (dateColumns[block + 1] || sheet.columnCount + 1) - 1;
        const columns: Record<string, number> = {};
        for (let c = start; c <= end; c++) {
          const label = normalizedHeader(text(sheet.getCell(headerRow, c)));
          if (!label && columns.from && columns.to && columns.nature) {
            if (!dateColumns[block + 1]) end = c - 1;
            break;
          }
          if (/^(柜号|container|reference)$/.test(label)) columns.reference = c;
          if (/^(nature|性质|作业|作业内容)$/.test(label)) columns.nature = c;
          if (/^(from|起点|出发地)$/.test(label)) columns.from = c;
          if (/^(to|终点|目的地)$/.test(label)) columns.to = c;
          if (/^(miles|里程)$/.test(label)) columns.miles = c;
        }
        if (!columns.from || !columns.to || !columns.nature) continue;
        recognized = true;
        const section = columns.reference ? "海柜" : "Local";
        let currentDate: string | null = null;
        for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
          const dateCell = sheet.getCell(r, start);
          const dateText = text(dateCell);
          if (/^(total|合计|总计)$/i.test(dateText)) break;
          const explicitDate = dateValue(dateCell, year);
          if (dateText && !explicitDate && /duty|detention|补助|补贴|工资|薪水|支票|合计|总计/i.test(dateText)) continue;
          if (explicitDate) currentDate = explicitDate;
          const read = (key: string) => columns[key] ? text(sheet.getCell(r, columns[key])) : "";
          const reference = read("reference");
          const nature = read("nature");
          const fromLocation = read("from");
          const toLocation = read("to");
          if (!reference && !fromLocation && !toLocation) continue;
          if (dateText && !explicitDate) currentDate = null;
          if (!currentDate) { warnings.add(`第 ${r} 行缺少可确认的作业日期，未导入`); continue; }
          const rawMiles = columns.miles ? cellValue(sheet.getCell(r, columns.miles)) : null;
          const parsedMiles = typeof rawMiles === "number" ? rawMiles : typeof rawMiles === "string" && rawMiles.trim() ? Number(rawMiles.replace(/,/g, "")) : NaN;
          const miles = Number.isFinite(parsedMiles) && parsedMiles >= 0 ? Math.round(parsedMiles * 100) / 100 : null;
          const rawCells: DriverTask["rawCells"] = {};
          const notes: string[] = [];
          const knownColumns = new Set([start, ...Object.values(columns)]);
          for (let c = start; c <= end; c++) {
            const cell = sheet.getCell(r, c);
            if (cell.isMerged && cell.master.address !== cell.address) continue;
            const value = cellValue(cell);
            if (value == null || value === "") continue;
            rawCells[cell.address] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
            if (!knownColumns.has(c) && typeof value === "string" && value.trim() && !/^#/.test(value)) notes.push(value.trim());
          }
          sheetTasks.push({ sheetName: sheet.name, section, sourceRow: r, driverName: sheet.name.trim(), workDate: currentDate,
            reference: reference || null, nature: nature || null, fromLocation: fromLocation || null, toLocation: toLocation || null,
            miles, notes: notes.length ? notes.join("；") : null, rawCells });
        }
      }
      if (recognized) break;
    }
    if (!recognized) { preview.skippedSheets.push({ sheetName: sheet.name, reason: "未找到日期、Nature、From、To 作业表头" }); continue; }
    const dates = sheetTasks.map(task => task.workDate).sort();
    preview.sheets.push({ sheetName: sheet.name, driverName: sheet.name.trim(), selected: sheetTasks.length > 0,
      taskCount: sheetTasks.length, dateFrom: dates[0] || null, dateTo: dates.at(-1) || null, warnings: [...warnings] });
    preview.tasks.push(...sheetTasks);
  }
  if (!preview.tasks.length) throw new Error("未识别到司机作业记录，请检查表内是否包含司机工作表以及日期、Nature、From、To 表头");
  if (preview.tasks.length > 15000) throw new Error("作业记录过多，请分批上传（每次最多 15000 段）");
  const signatures = new Map<string, string>();
  for (const sheet of preview.sheets.filter(item => item.taskCount > 0)) {
    const tasks = preview.tasks.filter(task => task.sheetName === sheet.sheetName);
    const signature = JSON.stringify(tasks.map(task => [task.workDate, task.reference, task.nature, task.fromLocation, task.toLocation, task.miles]));
    const duplicate = signatures.get(signature);
    if (duplicate) {
      sheet.warnings.push(`与“${duplicate}”的作业路线相同，请核对是否为同一趟作业或重复工作表`);
    } else signatures.set(signature, sheet.sheetName);
  }
  const batchPeriod = resolveDriverBatchPeriod(fileName, preview.tasks.map(task => task.workDate).sort()[0]);
  const outside = preview.tasks.filter(task => task.workDate < batchPeriod.from || task.workDate > batchPeriod.to);
  if (outside.length) preview.warnings.push(`${outside.length} 段作业日期超出批次 ${batchPeriod.from} 至 ${batchPeriod.to}，已保留原始日期，请核对`);
  return { ...preview, batchPeriod };
}

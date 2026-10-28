import ExcelJS from "exceljs";
import { SavInputError, type SavBaseline, type SavBaselineContainer } from "./sav-settings";
import type { SavContainerResult } from "./sav-accounting-types";

function scalar(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === "object" && "result" in value) return value.result;
  return value;
}
function numeric(cell: ExcelJS.Cell) {
  // ExcelJS omits a cached zero from cell.value's formula object, while
  // cell.result preserves zero. A missing cached result remains unavailable.
  const v = cell.type === ExcelJS.ValueType.Formula ? cell.result : scalar(cell.value);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function text(value: ExcelJS.CellValue) { return String(scalar(value) ?? "").trim(); }
export async function parseSavBaseline(files: Array<{ name: string; bytes: Uint8Array }>, previous?: SavBaseline): Promise<SavBaseline> {
  if (!files.length || files.length > 2) throw new SavInputError("请选择利润汇总和／或运输成本Excel（最多两个）");
  const baseline: SavBaseline = previous ? structuredClone(previous) : { sourceName: "", importedAt: "", containers: [] };
  let recognized = 0;
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".xlsx") || file.bytes.byteLength > 8 * 1024 * 1024) throw new SavInputError("仅支持8MB以内的xlsx文件");
    const workbook = new ExcelJS.Workbook();
    try { await workbook.xlsx.load(Buffer.from(file.bytes) as never); } catch { throw new SavInputError("Excel文件无法读取"); }
    const summary = workbook.getWorksheet("柜号汇总");
    const transport = workbook.getWorksheet("B运输成本");
    if (summary) {
      if (text(summary.getCell("A1").value) !== "柜号" || text(summary.getCell("C1").value) !== "总收入") throw new SavInputError("利润汇总表头与基准格式不符");
      const records = new Map<string, SavBaselineContainer>();
      summary.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const id = text(row.getCell(1).value);
        if (!id || id === "合计") return;
        if (records.has(id)) throw new SavInputError(`基准存在重复柜号：${id}`);
        records.set(id, { containerNumber: id, income: numeric(row.getCell(3)), expense: numeric(row.getCell(4)), profit: numeric(row.getCell(5)) });
      });
      workbook.getWorksheet("无收入记录")?.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const id = text(row.getCell(1).value);
        if (!id || id === "合计") return;
        if (records.has(id)) throw new SavInputError(`基准存在重复柜号：${id}`);
        records.set(id, { containerNumber: id, income: null, expense: numeric(row.getCell(3)), profit: null });
      });
      if (!records.size) throw new SavInputError("利润汇总表没有柜号数据");
      baseline.containers = [...records.values()]; baseline.sourceName = file.name;
      const sourceGoods = workbook.getWorksheet("B计价明细");
      const sourceTrips = workbook.getWorksheet("行程计价");
      const grouped = new Map<string, Array<{ id: string; method: string; amount: number | null }>>();
      sourceGoods?.eachRow((row, rowNumber) => {
        if (rowNumber < 5) return;
        const id = text(row.getCell(1).value); const tripId = text(row.getCell(11).value);
        if (!id || !tripId) return;
        const rows = grouped.get(tripId) || [];
        rows.push({ id, method: text(row.getCell(10).value), amount: numeric(row.getCell(15)) });
        grouped.set(tripId, rows);
      });
      baseline.tripEvidence = [];
      sourceTrips?.eachRow((row, rowNumber) => {
        if (rowNumber < 17) return;
        const id = text(row.getCell(1).value);
        const goods = grouped.get(id);
        if (!goods?.length || goods.every(item => item.method === "自提")) return;
        const miles = numeric(row.getCell(4)); const stops = numeric(row.getCell(5));
        const evidence: NonNullable<SavBaseline["tripEvidence"]>[number] = {
          id, goodsIds: goods.map(item => item.id), miles: miles !== null && miles >= 0 ? miles : null,
          stopCount: stops !== null && Number.isInteger(stops) && stops >= 1 ? stops : null,
          sourceReference: `${file.name} / 行程计价!A${rowNumber}:E${rowNumber} / 趟次 ${id}`
        };
        if (goods.every(item => item.method.toUpperCase() === "LTL" && item.amount !== null && item.amount >= 0)) {
          evidence.explicitAmount = Math.round(goods.reduce((sum, item) => sum + item.amount!, 0) * 100) / 100;
        }
        baseline.tripEvidence!.push(evidence);
      });
      recognized++;
    } else if (transport) {
      if (text(transport.getCell("B1").value) !== "货物来源柜号" || text(transport.getCell("F1").value) !== "分摊成本") throw new SavInputError("运输成本表头与基准格式不符");
      let goodsCount = 0; let knownExpense = 0;
      transport.eachRow((row, rowNumber) => { if (rowNumber > 1 && text(row.getCell(2).value)) { goodsCount++; knownExpense += numeric(row.getCell(6)) ?? 0; } });
      baseline.transport = { sourceName: file.name, goodsCount, knownExpense: Math.round(knownExpense * 100) / 100 }; recognized++;
    } else throw new SavInputError("未找到“柜号汇总”或“B运输成本”工作表");
  }
  if (!recognized) throw new SavInputError("没有识别到有效的Excel基准");
  baseline.importedAt = new Date().toISOString(); return baseline;
}
export type SavReconciliationRow = {
  containerNumber: string; actualIncome: number | null; actualExpense: number | null; expectedIncome: number | null; expectedExpense: number | null;
  incomeDifference: number | null; expenseDifference: number | null; status: "matched" | "different" | "pending" | "source_only" | "baseline_only";
};
export function reconcileSav(rows: SavContainerResult[], baseline?: SavBaseline) {
  const actual = new Map<string, { income: number | null; expense: number | null }>();
  for (const row of rows) {
    const before = actual.get(row.containerNumber);
    actual.set(row.containerNumber, before ? { income: before.income === null || row.income === null ? null : before.income + row.income, expense: before.expense === null || row.expense === null ? null : before.expense + row.expense } : { income: row.income, expense: row.expense });
  }
  const expected = new Map((baseline?.containers ?? []).map(row => [row.containerNumber, row]));
  const result: SavReconciliationRow[] = [];
  const summary = { matched: 0, different: 0, pending: 0, sourceOnly: 0, baselineOnly: 0 };
  if (!baseline?.containers.length) return { rows: result, summary };
  for (const id of new Set([...actual.keys(), ...expected.keys()])) {
    const a = actual.get(id); const e = expected.get(id);
    const difference = (v: number | null | undefined, target: number | null | undefined) => v == null || target == null ? null : Math.round((v - target) * 100) / 100;
    const incomeDifference = difference(a?.income, e?.income); const expenseDifference = difference(a?.expense, e?.expense);
    const knownDifference = (incomeDifference !== null && Math.abs(incomeDifference) > 0.01) || (expenseDifference !== null && Math.abs(expenseDifference) > 0.01);
    const status = !a ? "baseline_only" : !e ? "source_only" : knownDifference ? "different" : incomeDifference === null || expenseDifference === null ? "pending" : "matched";
    result.push({ containerNumber: id, actualIncome: a?.income ?? null, actualExpense: a?.expense ?? null, expectedIncome: e?.income ?? null, expectedExpense: e?.expense ?? null, incomeDifference, expenseDifference, status });
    summary[status === "source_only" ? "sourceOnly" : status === "baseline_only" ? "baselineOnly" : status]++;
  }
  return { rows: result, summary };
}

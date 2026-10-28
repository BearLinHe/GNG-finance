import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const round = value => Math.round(value * 100) / 100;
const number = value => typeof value === "number" && Number.isFinite(value) ? value : null;
function scalar(value) {
  if (value && typeof value === "object" && "result" in value) return value.result;
  return value;
}
// ExcelJS's cell.value omits a cached formula result when it is exactly zero;
// the public cell.result getter preserves that valid zero.
const moneyCell = cell => number(cell.type === ExcelJS.ValueType.Formula ? cell.result : scalar(cell.value));
const textCell = cell => String(scalar(cell.value) ?? "").trim();
const total = values => round(values.reduce((sum, value) => sum + (value ?? 0), 0));

export async function readSavVerificationBaseline(profitPath, transportPath) {
  const profit = new ExcelJS.Workbook();
  const transport = new ExcelJS.Workbook();
  await Promise.all([profit.xlsx.readFile(profitPath), transport.xlsx.readFile(transportPath)]);
  const summary = profit.getWorksheet("柜号汇总");
  const absentIncome = profit.getWorksheet("无收入记录");
  const transportSheet = transport.getWorksheet("B运输成本");
  if (!summary || !absentIncome || !transportSheet) throw new Error("核对文件缺少要求的工作表");
  const containers = new Map();
  let summaryCount = 0;
  let noIncomeCount = 0;
  let summaryControl = null;
  let noIncomeControl = null;
  for (const [sheet, isSummary] of [[summary, true], [absentIncome, false]]) {
    sheet.eachRow((row, index) => {
      if (index < 2) return;
      const containerNumber = textCell(row.getCell(1));
      if (!containerNumber) return;
      if (containerNumber === "合计") {
        if (isSummary) summaryControl = { count: moneyCell(row.getCell(2)), income: moneyCell(row.getCell(3)), expense: moneyCell(row.getCell(4)), profit: moneyCell(row.getCell(5)) };
        else noIncomeControl = { expense: moneyCell(row.getCell(3)) };
        return;
      }
      if (containers.has(containerNumber)) throw new Error(`Excel中重复柜号：${containerNumber}`);
      containers.set(containerNumber, { containerNumber,
        income: isSummary ? moneyCell(row.getCell(3)) : null,
        expense: moneyCell(row.getCell(isSummary ? 4 : 3)),
        profit: isSummary ? moneyCell(row.getCell(5)) : null,
        group: isSummary ? "柜号汇总" : "无收入记录" });
      if (isSummary) summaryCount++; else noIncomeCount++;
    });
  }
  let transportGoodsCount = 0;
  let transportPendingCount = 0;
  const transportCosts = [];
  transportSheet.eachRow((row, index) => {
    if (index < 2 || !textCell(row.getCell(2))) return;
    transportGoodsCount++;
    const amount = moneyCell(row.getCell(6));
    if (amount === null) transportPendingCount++;
    else transportCosts.push(amount);
  });
  const normal = profit.getWorksheet("正常支出明细");
  const normalCosts = [];
  normal?.eachRow((row, index) => { if (index >= 6 && textCell(row.getCell(1))) normalCosts.push(moneyCell(row.getCell(9))); });
  const records = [...containers.values()];
  const summaryRecords = records.filter(row => row.group === "柜号汇总");
  const noIncomeRecords = records.filter(row => row.group === "无收入记录");
  const checks = {
    summaryContainerCount: summaryCount,
    noIncomeContainerCount: noIncomeCount,
    summaryIncome: total(summaryRecords.map(row => row.income)),
    summaryExpense: total(summaryRecords.map(row => row.expense)),
    summaryProfit: total(summaryRecords.map(row => row.profit)),
    noIncomeExpense: total(noIncomeRecords.map(row => row.expense)),
    combinedExpense: total(records.map(row => row.expense)),
    normalDetailExpense: total(normalCosts),
    transportGoodsCount,
    transportPendingCount,
    transportKnownExpense: total(transportCosts)
  };
  if (!containers.size || !transportGoodsCount || !summaryControl || !noIncomeControl) throw new Error("Excel基准缺少柜号、运输记录或合计控制行");
  const expected = {
    summaryContainerCount: summaryControl.count,
    summaryIncome: summaryControl.income,
    summaryExpense: summaryControl.expense,
    summaryProfit: summaryControl.profit,
    noIncomeExpense: noIncomeControl.expense,
    normalDetailExpense: checks.combinedExpense
  };
  const baselineChecks = Object.entries(expected).map(([metric, target]) => ({ metric, expected: target, actual: checks[metric], matched: target !== null && Math.abs(checks[metric] - target) < 0.005 }));
  if (baselineChecks.some(check => !check.matched)) throw new Error(`Excel基准与本次确认的数据不同：${baselineChecks.filter(check => !check.matched).map(check => check.metric).join("、")}`);
  return { containers, checks, baselineChecks };
}

export function compareSavVerificationRows(rows, baseline) {
  const actual = new Map();
  for (const row of rows) {
    const before = actual.get(row.containerNumber);
    if (!before) actual.set(row.containerNumber, { ...row });
    else for (const field of ["income", "expense", "profit"]) before[field] = before[field] == null || row[field] == null ? null : round(before[field] + row[field]);
  }
  const comparison = [];
  const counts = { matched: 0, different: 0, pending: 0, sourceOnly: 0, baselineOnly: 0 };
  const fieldCounts = { income: { matched: 0, different: 0, pending: 0 }, expense: { matched: 0, different: 0, pending: 0 }, profit: { matched: 0, different: 0, pending: 0 } };
  for (const id of new Set([...actual.keys(), ...baseline.keys()])) {
    const a = actual.get(id);
    const b = baseline.get(id);
    const detail = { containerNumber: id, status: a ? "sourceOnly" : "baselineOnly", fields: {} };
    if (a && b) {
      for (const field of ["income", "expense", "profit"]) {
        const actualValue = number(a[field]);
        const expectedValue = number(b[field]);
        const difference = actualValue === null || expectedValue === null ? null : round(actualValue - expectedValue);
        const status = difference === null ? "pending" : Math.abs(difference) <= 0.01 ? "matched" : "different";
        detail.fields[field] = { actual: actualValue, expected: expectedValue, difference, status };
        fieldCounts[field][status]++;
      }
      const statuses = Object.values(detail.fields).map(item => item.status);
      detail.status = statuses.includes("different") ? "different" : statuses.includes("pending") ? "pending" : "matched";
    }
    counts[detail.status]++;
    comparison.push(detail);
  }
  return { counts, fieldCounts, comparison };
}

async function main() {
  const url = new URL("/api/sav-accounting", process.argv[2] || "http://localhost:3011");
  url.searchParams.set("dateFrom", "2026-09-07");
  url.searchParams.set("dateTo", "2026-10-25");
  url.searchParams.set("scope", "excel");
  url.searchParams.set("pageSize", "300");
  const profitPath = process.argv[3];
  const transportPath = process.argv[4];
  if (!profitPath || !transportPath) throw new Error("用法：node scripts/verify-sav-accounting.mjs <Finance地址> <利润汇总.xlsx路径> <运输成本.xlsx路径>");
  const baseline = await readSavVerificationBaseline(profitPath, transportPath);
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`读取SAV核算API失败（HTTP ${response.status}）`);
  const payload = await response.json();
  const rows = payload.rows ?? payload.result?.rows;
  if (!Array.isArray(rows)) throw new Error("SAV核算API没有返回柜号明细数组");
  const result = compareSavVerificationRows(rows, baseline.containers);
  const report = {
    verifiedAt: new Date().toISOString(),
    dateFrom: "2026-09-07", dateTo: "2026-10-25",
    baselineChecks: baseline.baselineChecks,
    baseline: baseline.checks,
    source: { containerCount: rows.length, summary: payload.summary ?? payload.result?.summary, snapshotAt: payload.snapshotAt ?? payload.source?.snapshotAt,
      notes: payload.sourceNotes ?? payload.notes ?? payload.source?.notes },
    ...result,
    interpretation: "只有收入、支出、利润均有可比数值且各自差额不超过$0.01才记为matched。缺失金额保持pending。运输表按送仓日期覆盖其他记录，其总金额不与提柜日期筛选下的支出总额直接比较；应匹配相同货物ID。"
  };
  await fs.mkdir(path.resolve(".data"), { recursive: true });
  await fs.writeFile(path.resolve(".data/sav-verification.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ baselineChecks: baseline.baselineChecks.every(check => check.matched), baseline: report.baseline,
    sourceContainers: rows.length, comparison: report.counts, fieldComparison: report.fieldCounts,
    sourceSummary: report.source.summary, report: ".data/sav-verification.json" }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "SAV对账验证失败"); process.exitCode = 1; });
}

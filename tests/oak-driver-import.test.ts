import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { parseDriverWorkbook } from "../lib/oak-driver-import";
import { driverSubjectLabel, summarizeDriverPeriods, summarizeDriverTasks, type DriverTask } from "../lib/oak-driver-types";
import { resolveDriverBatchPeriod } from "../lib/oak-driver-batch";

async function bytes(workbook: ExcelJS.Workbook) {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function addDriver(workbook: ExcelJS.Workbook, name: string) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow([`${name} 10/3-10/9`]);
  sheet.addRow(["Date", "柜号", "Nature", "From", "To", "Miles", "Driver", "Owner", "Amount", null,
    "Date", "From", "To", "Nature", "Miles", "Driver", "Owner", "Amount", null, "CA", "NV", null, "MILES"]);
  return sheet;
}

test("imports owner markers as separate payee metadata while preserving sheet names and raw pay columns", async () => {
  const workbook = new ExcelJS.Workbook();
  for (const name of ["O Don", "O王肃", "○ 李师傅", "Oliver", "张晓澄", "0608"]) {
    addDriver(workbook, name).getRow(3).values = [new Date("2026-10-03"), "trailer 1", "TCY1直送", "SFO", "95206", 68, 150, 400];
  }
  const preview = await parseDriverWorkbook(await bytes(workbook), "10_3-10_9.xlsx");
  assert.deepEqual(preview.sheets.map(sheet => sheet.payeeType), ["owner", "owner", "owner", "driver", "driver", null]);
  assert.deepEqual(preview.tasks.map(task => task.payeeType), ["owner", "owner", "owner", "driver", "driver", null]);
  assert.equal(preview.tasks[0].sheetName, "O Don"); assert.equal(preview.tasks[0].driverName, "O Don");
  assert.equal(preview.tasks[0].rawCells.G3, 150); assert.equal(preview.tasks[0].rawCells.H3, 400);
});

test("recognizes separate sea-container and Local sections, merged references, and carried dates", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = addDriver(workbook, "Driver A");
  sheet.getRow(3).values = [new Date("2026-10-03"), "trailer 001", "TCY1直送", "SFO", "95206", 68, 200];
  sheet.getRow(4).values = [null, null, null, "95206", "SFO", 68];
  sheet.mergeCells("B3:B4"); sheet.mergeCells("G3:G4");
  sheet.getCell("K3").value = new Date("2026-10-05");
  sheet.getCell("L3").value = "Shipper"; sheet.getCell("M3").value = "SFO";
  sheet.getCell("N3").value = "Local delivery"; sheet.getCell("O3").value = 21;
  sheet.getCell("W3").value = 999;
  sheet.getCell("A5").value = "燃油补助"; sheet.getCell("F5").value = 136;
  sheet.getCell("K5").value = "DETENTION"; sheet.mergeCells("K5:L5");
  sheet.getCell("A6").value = "Total"; sheet.getCell("K6").value = "Total";
  const preview = await parseDriverWorkbook(await bytes(workbook), "10_3-10_9.xlsx");
  assert.equal(preview.tasks.length, 3);
  assert.deepEqual(preview.batchPeriod, { from: "2026-10-03", to: "2026-10-09" });
  assert.deepEqual(preview.tasks.map(task => task.workDate), ["2026-10-03", "2026-10-03", "2026-10-05"]);
  assert.equal(preview.tasks[1].reference, "trailer 001");
  assert.equal(preview.tasks[2].section, "Local");
  assert.equal(preview.tasks[2].miles, 21);
  assert.ok(!("W3" in preview.tasks[2].rawCells));
  assert.deepEqual(preview.sheets[0].warnings, []);
  const days = summarizeDriverTasks(preview.tasks);
  assert.equal(days.find(day => day.workDate === "2026-10-03")?.miles, 136);
});

test("missing and invalid dates are flagged instead of borrowing dates from another section", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = addDriver(workbook, "Driver A");
  sheet.addRow([null, "C1", "提柜", "ETS", "SFO", 21]);
  sheet.addRow([new Date("2026-10-03"), "C2", "还柜", "SFO", "ETS", 21]);
  sheet.addRow(["2026-02-30", "C3", "提柜", "ETS", "SFO", 21]);
  sheet.addRow([null, "C4", "还柜", "SFO", "ETS", 21]);
  const preview = await parseDriverWorkbook(await bytes(workbook), "10_3-10_9.xlsx");
  assert.deepEqual(preview.tasks.map(task => task.reference), ["C2"]);
  assert.equal(preview.sheets[0].warnings.length, 3);
});

test("numbered vehicle sheets import by default and retain leading zeroes alongside named drivers", async () => {
  const workbook = new ExcelJS.Workbook();
  for (const name of ["Driver A", "Driver B", "0608", "模板", "John油税"]) {
    const sheet = addDriver(workbook, name);
    sheet.addRow([new Date("2026-10-03"), "C1", "提柜", "ETS", "SFO", 21]);
  }
  const preview = await parseDriverWorkbook(await bytes(workbook), "10_3-10_9.xlsx");
  assert.equal(preview.sheets.length, 3);
  assert.equal(preview.skippedSheets.length, 2);
  assert.equal(preview.sheets.find(sheet => sheet.sheetName === "Driver B")?.selected, true);
  assert.equal(preview.sheets.find(sheet => sheet.sheetName === "0608")?.selected, true);
  const vehicle = preview.tasks.find(task => task.sheetName === "0608")!;
  assert.equal(vehicle.driverName, "0608");
  assert.equal(driverSubjectLabel(vehicle.driverName), "车辆编号");
  assert.equal(driverSubjectLabel("Driver A"), "司机");
  assert.ok(!preview.sheets.find(sheet => sheet.sheetName === "0608")?.warnings.some(warning => warning.includes("默认不导入")));
  const days = summarizeDriverTasks(preview.tasks);
  assert.equal(days.length, 3);
  assert.equal(days.find(day => day.driverName === "0608")?.miles, 21);
});

test("actual dates outside filename period and tasks without route names remain inspectable", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = addDriver(workbook, "Driver A");
  sheet.addRow([new Date("2026-10-10"), "挪柜", null, null, null, null]);
  const preview = await parseDriverWorkbook(await bytes(workbook), "10_3-10_9.xlsx");
  assert.equal(preview.tasks[0].workDate, "2026-10-10");
  assert.equal(preview.tasks[0].miles, null);
  assert.equal(preview.warnings.length, 1);
  assert.deepEqual(preview.batchPeriod, { from: "2026-10-03", to: "2026-10-09" });
});

test("empty or invalid files fail with a useful error", async () => {
  await assert.rejects(parseDriverWorkbook(Buffer.from("invalid"), "file.csv"), /xlsx/);
  await assert.rejects(parseDriverWorkbook(Buffer.from("invalid"), "file.xlsx"), /无法读取/);
  const workbook = new ExcelJS.Workbook(); addDriver(workbook, "Driver A");
  await assert.rejects(parseDriverWorkbook(await bytes(workbook), "file.xlsx"), /未识别到/);
});

test("every worksheet is checked for size limits after a valid date has been found", async () => {
  const workbook = new ExcelJS.Workbook();
  const first = addDriver(workbook, "Driver A");
  first.addRow([new Date("2026-10-03"), "C1", "提柜", "ETS", "SFO", 21]);
  workbook.addWorksheet("Driver B").getCell("A10001").value = "Too many rows";
  await assert.rejects(parseDriverWorkbook(await bytes(workbook), "file.xlsx"), /表格超出支持范围/);
});

function task(driverName: string, workDate: string, nature: string | null, miles: number | null): DriverTask {
  return { driverName, workDate, nature, miles, sheetName: driverName, sourceRow: 3, section: "海柜",
    reference: null, fromLocation: "SFO", toLocation: "ETS", notes: null, rawCells: {} };
}

test("period summaries include every workday and group work types without dropping the latest date", () => {
  const days = summarizeDriverTasks([
    task("Driver A", "2026-10-09", null, 948),
    task("Driver A", "2026-10-04", "提柜", 68),
    task("Driver A", "2026-10-05", "提柜", 21),
    task("Driver A", "2026-10-05", "还柜", 21),
    task("0608", "2026-10-09", "提柜", null)
  ]);
  const periods = summarizeDriverPeriods(days);
  assert.equal(periods.length, 2);
  const driver = periods.find(period => period.driverName === "Driver A")!;
  assert.equal(driver.dateFrom, "2026-10-04");
  assert.equal(driver.dateTo, "2026-10-09");
  assert.equal(driver.dayCount, 3);
  assert.equal(driver.taskCount, 4);
  assert.equal(driver.miles, 1058);
  assert.deepEqual(driver.days.map(day => day.workDate), ["2026-10-04", "2026-10-05", "2026-10-09"]);
  assert.equal(driver.taskTypes.find(type => type.label === "提柜")?.count, 2);
  assert.equal(driver.taskTypes.reduce((sum, type) => sum + type.count, 0), driver.taskCount);
  assert.equal(periods.find(period => period.driverName === "0608")?.miles, null);
  assert.equal(days[0].workDate, "2026-10-09");
});

test("period summaries reflect the selected inclusive dates and keep an empty result empty", () => {
  const tasks = [task("Driver A", "2026-10-03", "提柜", 21), task("Driver A", "2026-10-05", "还柜", 21), task("Driver A", "2026-10-09", "提柜", 21)];
  const periods = summarizeDriverPeriods(summarizeDriverTasks(tasks.filter(item => item.workDate >= "2026-10-05" && item.workDate <= "2026-10-09")));
  assert.equal(periods[0].dayCount, 2);
  assert.equal(periods[0].taskCount, 2);
  assert.deepEqual(summarizeDriverPeriods([]), []);
});

test("batch labels use the file period even when actual work ends outside it", () => {
  assert.deepEqual(resolveDriverBatchPeriod("10_3-10_9.xlsx", "2026-10-10"), { from: "2026-10-03", to: "2026-10-09" });
  assert.deepEqual(resolveDriverBatchPeriod("12_26-1_1.xlsx", "2027-01-01"), { from: "2026-12-26", to: "2027-01-01" });
});

test("files without a named period use the Saturday-to-Friday week, including year boundaries", () => {
  assert.deepEqual(resolveDriverBatchPeriod("作业.xlsx", "2026-10-04"), { from: "2026-10-03", to: "2026-10-09" });
  assert.deepEqual(resolveDriverBatchPeriod("作业.xlsx", "2026-10-09"), { from: "2026-10-03", to: "2026-10-09" });
  assert.deepEqual(resolveDriverBatchPeriod("作业.xlsx", "2026-10-10"), { from: "2026-10-10", to: "2026-10-16" });
  assert.deepEqual(resolveDriverBatchPeriod("作业.xlsx", "2027-01-01"), { from: "2026-12-26", to: "2027-01-01" });
  assert.throws(() => resolveDriverBatchPeriod("作业.xlsx", "invalid"), /批次年份/);
});

import ExcelJS from "exceljs";

export function workbookDataSheets(workbook: ExcelJS.Workbook) {
  if (workbook.worksheets.length > 100) {
    throw new Error("工作表过多，请将文件拆分为不超过 100 个工作表");
  }
  return workbook.worksheets.map(sheet => {
    let rowCount = 0, columnCount = 0;
    // Excel keeps formatting and merged placeholders beyond the last cell with data.
    sheet.eachRow(row => row.eachCell((cell, column) => {
      const value = cell.value;
      if (cell.type === ExcelJS.ValueType.Merge || value == null || (typeof value === "string" && !value.trim())) return;
      if (row.number > 10000 || column > 100) {
        throw new Error(`表格超出支持范围：“${sheet.name}”的 ${cell.address} 有数据，每表最多读取前 10000 行、100 列`);
      }
      rowCount = Math.max(rowCount, row.number);
      columnCount = Math.max(columnCount, column);
    }));
    return { sheet, rowCount, columnCount };
  });
}

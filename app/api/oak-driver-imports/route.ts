import { NextResponse } from "next/server";
import { MAX_DRIVER_WORKBOOK_BYTES, parseDriverWorkbook } from "@/lib/oak-driver-import";
import { saveDriverWorkbook } from "@/lib/oak-driver-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("请选择要上传的 Excel 文件");
    if (file.size > MAX_DRIVER_WORKBOOK_BYTES) throw new Error("文件超过 4 MB，请拆分后上传");
    const fileName = file.name.split(/[\\/]/).pop()!.slice(0, 255);
    const preview = await parseDriverWorkbook(Buffer.from(await file.arrayBuffer()), fileName);
    if (form.get("action") !== "import") return NextResponse.json({ preview });
    const mappings: unknown = JSON.parse(String(form.get("mappings") || "[]"));
    if (!Array.isArray(mappings) || !mappings.length) throw new Error("请至少选择一个作业工作表");
    const names = new Map<string, string>();
    for (const item of mappings) {
      if (!item || typeof item.sheetName !== "string" || typeof item.driverName !== "string") throw new Error("作业归属信息无效");
      const name = item.driverName.trim();
      if (!name || name.length > 120) throw new Error("请填写司机姓名或车辆编号，最多 120 个字符");
      if (!preview.sheets.some(sheet => sheet.sheetName === item.sheetName && sheet.taskCount > 0)) throw new Error("所选工作表没有可导入的作业");
      names.set(item.sheetName, name);
    }
    const tasks = preview.tasks.filter(task => names.has(task.sheetName)).map(task => ({ ...task, driverName: names.get(task.sheetName)! }));
    return NextResponse.json(await saveDriverWorkbook(preview.fileName, preview.fileHash, tasks, preview.batchPeriod));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "上传失败" }, { status: 400 });
  }
}

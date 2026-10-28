import { NextResponse } from "next/server";
import { parseSavBaseline } from "@/lib/sav-baseline";
import { readSavSettings, saveSavBaseline } from "@/lib/sav-settings-db";
import { SavInputError } from "@/lib/sav-settings";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") || 0) > 17 * 1024 * 1024) throw new SavInputError("上传文件过大");
    const form = await request.formData(); const files = form.getAll("files");
    const inputs: Array<{ name: string; bytes: Uint8Array }> = [];
    for (const file of files) {
      if (typeof file === "string" || file.size > 8 * 1024 * 1024) throw new SavInputError("仅支持8MB以内的xlsx文件");
      inputs.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    }
    const settings = await readSavSettings();
    const baseline = await parseSavBaseline(inputs, settings.baseline);
    await saveSavBaseline(baseline);
    return NextResponse.json({ baseline });
  } catch (error) { return NextResponse.json({ error: error instanceof SavInputError ? error.message : "导入Excel对账基准失败" }, { status: error instanceof SavInputError ? 400 : 500 }); }
}

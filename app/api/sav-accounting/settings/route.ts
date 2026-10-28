import { NextResponse } from "next/server";
import { readSavSettings, saveSavSettings } from "@/lib/sav-settings-db";
import { SavInputError } from "@/lib/sav-settings";
import { parseSavQuery } from "@/lib/sav-query";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { const { scope } = parseSavQuery(new URL(request.url).searchParams); const settings = await readSavSettings(); return NextResponse.json({ ...settings, incomeOverrides: scope === "all" ? settings.allIncomeOverrides || {} : settings.incomeOverrides }); }
  catch { return NextResponse.json({ error: "读取SAV核算设置失败，请检查Finance数据库连接" }, { status: 500 }); }
}
export async function PUT(request: Request) {
  try {
    const body = await request.text();
    if (body.length > 128000) throw new SavInputError("提交内容过长");
    let input: unknown;
    try { input = JSON.parse(body); } catch { throw new SavInputError("提交内容不是有效JSON"); }
    const { scope } = parseSavQuery(new URL(request.url).searchParams);
    if (scope === "all" && input && typeof input === "object" && !Array.isArray(input)) {
      const patch = input as Record<string, unknown>;
      if (patch.incomeOverrides !== undefined) { input = { ...patch, allIncomeOverrides: patch.incomeOverrides }; delete (input as Record<string, unknown>).incomeOverrides; }
    }
    return NextResponse.json(await saveSavSettings(input));
  } catch (error) { return NextResponse.json({ error: error instanceof SavInputError ? error.message : "保存SAV核算设置失败" }, { status: error instanceof SavInputError ? 400 : 500 }); }
}

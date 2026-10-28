import { NextResponse } from "next/server";
import { getSavSourceAccounting } from "@/lib/sav-source-db";
import { readSavSettings, saveSavSettings } from "@/lib/sav-settings-db";
import { savCalibrationPatch } from "@/lib/sav-calibration";
import { SavInputError } from "@/lib/sav-settings";
import { parseSavQuery } from "@/lib/sav-query";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = parseSavQuery(params);
    if (query.scope !== "excel") throw new SavInputError("请切换到Excel私仓口径后补齐对应计价依据");
    const [source, settings] = await Promise.all([getSavSourceAccounting({ ...query, allRows: true }), readSavSettings()]);
    if (!settings.baseline?.tripEvidence?.length) throw new SavInputError("请先上传包含B计价明细和行程计价的利润汇总Excel");
    const result = savCalibrationPatch(source.input, settings);
    if (result.appliedCount) await saveSavSettings({ tripOverrides: result.tripOverrides });
    return NextResponse.json({ appliedCount: result.appliedCount, skippedCount: result.skippedCount, notes: result.notes });
  } catch (error) { return NextResponse.json({ error: error instanceof SavInputError ? error.message : "补齐Excel计价依据失败，请重试" }, { status: error instanceof SavInputError ? 400 : 500 }); }
}

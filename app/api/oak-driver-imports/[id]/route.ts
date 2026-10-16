import { NextResponse } from "next/server";
import { deleteDriverImport } from "@/lib/oak-driver-db";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: { id: string } }) {
  try {
    const id = Number(context.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("导入批次无效");
    if (!await deleteDriverImport(id)) return NextResponse.json({ error: "导入批次不存在" }, { status: 404 });
    return NextResponse.json({ id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "删除导入失败" }, { status: 400 });
  }
}

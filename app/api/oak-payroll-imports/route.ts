import { NextResponse } from 'next/server';
import { MAX_DRIVER_WORKBOOK_BYTES } from '@/lib/oak-driver-import';
import { previewPayrollWorkbook, importPayrollWorkbook } from '@/lib/oak-payroll-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const form = await request.formData(), file = form.get('file');
    if (!(file instanceof File)) throw new Error('请选择工资 Excel');
    if (file.size > MAX_DRIVER_WORKBOOK_BYTES) throw new Error('文件超过 4 MB，请拆分后上传');
    const fileName = file.name.split(/[\\/]/).pop()!.slice(0, 255);
    const buffer = Buffer.from(await file.arrayBuffer());
    if (form.get('action') !== 'import') return NextResponse.json(await previewPayrollWorkbook(buffer, fileName));
    let selection: unknown;
    try { selection = JSON.parse(String(form.get('selection') || 'null')); } catch { throw new Error('工资确认内容无效'); }
    return NextResponse.json(await importPayrollWorkbook(buffer, fileName, selection));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '工资导入失败' }, { status: 400 });
  }
}

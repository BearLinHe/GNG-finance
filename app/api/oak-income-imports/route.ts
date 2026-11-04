import {NextResponse} from 'next/server';
import {previewIncomeWorkbook,importIncomeWorkbook} from '@/lib/oak-income-import-db';
import {MAX_DRIVER_WORKBOOK_BYTES} from '@/lib/oak-driver-import';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function POST(request:Request){
  try{const form=await request.formData(),file=form.get('file');if(!(file instanceof File)||file.size>MAX_DRIVER_WORKBOOK_BYTES)throw Error('请选择不超过 4 MB 的 .xlsx 周表');
    const name=file.name.split(/[\\/]/).pop()!.slice(0,255),buffer=Buffer.from(await file.arrayBuffer());
    if(form.get('action')==='import')return NextResponse.json(await importIncomeWorkbook(buffer,name,JSON.parse(String(form.get('selection')||'null'))));
    return NextResponse.json(await previewIncomeWorkbook(buffer,name));
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'周表读取失败'},{status:400});}
}

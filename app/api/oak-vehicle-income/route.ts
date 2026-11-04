import {NextResponse} from 'next/server';
import {listVehicleIncome} from '@/lib/oak-vehicle-income-db';
import {IncomeInputError} from '@/lib/oak-income-db';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  try{return NextResponse.json(await listVehicleIncome(new URL(request.url).searchParams));}
  catch(error){return NextResponse.json({error:error instanceof IncomeInputError?error.message:'读取车辆收入失败'},{status:error instanceof IncomeInputError?400:500});}
}

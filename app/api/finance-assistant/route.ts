import {NextResponse} from 'next/server';
import { AssistantInputError, localAssistantRequest, validateAssistantPage } from '@/lib/finance-assistant';
import { chat, validTurns } from '@/lib/finance-assistant-agent';
import { confirmDraft, discardDraft, queryDriver } from '@/lib/finance-assistant-db';
import { IncomeInputError } from '@/lib/oak-income-db';

export const dynamic='force-dynamic';
const enabled=(r:Request)=>localAssistantRequest(r,process.env.NODE_ENV==='development' && process.env.NEXT_PUBLIC_OAK_LOCAL_ASSISTANT==='1');
const respond=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
const forbidden=()=>respond({error:'财务助手仅允许在本机开发环境使用'},403);
export function GET(r:Request){return enabled(r)?respond({configured:!!process.env.OPENAI_API_KEY}):forbidden();}
let running=0;
export async function POST(r:Request){
  if(!enabled(r))return forbidden();
  if(running>=3)return respond({error:'助手正在处理其他请求，请稍后再试'},429);
  running++;
  try{
    if(Number(r.headers.get('content-length'))>120000)throw new AssistantInputError('提交内容过大');
    const raw=await r.text();
    if(raw.length>100000)throw new AssistantInputError('提交内容过大');
    const body=JSON.parse(raw);
    if(!body||typeof body!=='object')throw new AssistantInputError('请求无效');
    if(body.action==='confirm')return respond({ids:await confirmDraft(body.token)});
    if(body.action==='discard'){discardDraft(body.token);return respond({discarded:true});}
    if(body.action==='sample'){
      const d=await queryDriver({driver:'David Gao',dateFrom:'2026-08-01',dateTo:'2026-10-25'});
      const money=(n:number|null)=>n==null?'待核对':n.toLocaleString('en-US',{style:'currency',currency:'USD'});
      return respond({text:`${d.driver} · ${d.dateFrom} 至 ${d.dateTo}\n作业收入 ${money(d.income.confirmed)}，工资 ${money(d.wages.confirmed)}，油费 ${money(d.fuel.confirmed)}，保险 ${money(d.insurance.confirmed)}，车辆维修费 ${money(d.maintenance.confirmed)}。\n周期净盈亏：${money(d.net)}。`,evidence:['只读试算 · 司机盈亏主表（未调用 AI）']});
    }
    if(body.action!=='chat'||!['read','draft'].includes(body.mode))throw new AssistantInputError('请求无效');
    const turns=validTurns(body.messages);
    if(!process.env.OPENAI_API_KEY)return respond({error:'尚未配置服务端 OPENAI_API_KEY，请在 .env.local 配置新密钥后重新启动。'},503);
    return respond(await chat(turns,body.mode==='draft',process.env.OPENAI_API_KEY,process.env.OPENAI_MODEL||'gpt-4.1-mini',undefined,validateAssistantPage(body.page)));
  }catch(e){
    if(e instanceof AssistantInputError||e instanceof IncomeInputError||e instanceof SyntaxError)return respond({error:e instanceof SyntaxError?'内容格式无效':e.message},400);
    return respond({error:'服务连接失败或超时。请稍后重新查询或核对草稿状态。'},502);
  }finally{running--;}
}

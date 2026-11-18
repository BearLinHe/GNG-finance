import {NextResponse} from 'next/server';
import { AssistantInputError, validateAssistantPage } from '@/lib/finance-assistant';
import {assistantAccess,issueAssistantSession,sameSecret,sessionCookie,sessionSeconds} from '@/lib/finance-assistant-access';
import { chat, validTurns } from '@/lib/finance-assistant-agent';
import { confirmDraft, discardDraft, queryDriver } from '@/lib/finance-assistant-db';
import { IncomeInputError, incomeId } from '@/lib/oak-income-db';
import { readTaskReviewContext } from '@/lib/oak-driver-db';
import { confirmWorkBatch, discardWorkBatch } from '@/lib/finance-work-review-db';
import {withPreviewSession} from '@/lib/finance-assistant-previews';

export const dynamic='force-dynamic';
const respond=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
const forbidden=()=>respond({error:'此环境或请求来源未启用财务助手'},403);
const locked=()=>respond({locked:true,error:'请先在左下角财务助手输入访问码'},401);
export function GET(r:Request){
  const access=assistantAccess(r,process.env);
  return access==='denied'?forbidden():access==='locked'?locked():respond({configured:!!process.env.OPENAI_API_KEY});
}
let running=0;
export async function POST(r:Request){
  const access=assistantAccess(r,process.env);
  if(access==='denied')return forbidden();
  if(r.headers.get('x-assistant-unlock')==='1'){
    const code=process.env.FINANCE_ASSISTANT_ACCESS_CODE;
    const auth=r.headers.get('authorization');
    if(!code||!auth?.startsWith('Bearer ')||!sameSecret(auth.slice(7),code))return respond({locked:true,error:'访问码不正确'},401);
    const response=respond({configured:!!process.env.OPENAI_API_KEY});
    response.cookies.set(sessionCookie,issueAssistantSession(code,r.headers.get('host')!),{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:sessionSeconds});
    return response;
  }
  if(access!=='allowed')return locked();
  const session=r.headers.get('cookie')?.split(/;\s*/).find(x=>x.startsWith(sessionCookie+'='))??'local';
  return withPreviewSession(session,()=>handleAuthorized(r));
}
async function handleAuthorized(r:Request){
  if(running>=3)return respond({error:'助手正在处理其他请求，请稍后再试'},429);
  running++;
  try{
    if(Number(r.headers.get('content-length'))>120000)throw new AssistantInputError('提交内容过大');
    const raw=await r.text();
    if(raw.length>100000)throw new AssistantInputError('提交内容过大');
    const body=JSON.parse(raw);
    if(!body||typeof body!=='object')throw new AssistantInputError('请求无效');
    if(body.action==='confirm-work')return respond({ids:await confirmWorkBatch(body.token)});
    if(body.action==='discard-work'){await discardWorkBatch(body.token);return respond({discarded:true});}
    if(body.action==='confirm')return respond({ids:await confirmDraft(body.token)});
    if(body.action==='discard'){await discardDraft(body.token);return respond({discarded:true});}
    if(body.action==='sample'){
      const d=await queryDriver({driver:'David Gao',dateFrom:'2026-08-01',dateTo:'2026-10-25'});
      const money=(n:number|null)=>n==null?'待核对':n.toLocaleString('en-US',{style:'currency',currency:'USD'});
      return respond({text:`${d.driver} · ${d.dateFrom} 至 ${d.dateTo}\n作业收入 ${money(d.income.confirmed)}，工资 ${money(d.wages.confirmed)}，油费 ${money(d.fuel.confirmed)}，保险 ${money(d.insurance.confirmed)}，车辆维修费 ${money(d.maintenance.confirmed)}。\n周期净盈亏：${money(d.net)}。`,evidence:['只读试算 · 司机盈亏主表（未调用 AI）']});
    }
    if(body.action!=='review' && (body.action!=='chat'||!['read','draft','assistant'].includes(body.mode)))throw new AssistantInputError('请求无效');
    const turns=validTurns(body.messages);
    if(!process.env.OPENAI_API_KEY)return respond({error:'尚未配置服务端 OPENAI_API_KEY，请联系管理员。'},503);
    const model=process.env.OPENAI_MODEL||'gpt-4.1-mini';
    if(body.action==='review')return respond(await chat(turns,false,process.env.OPENAI_API_KEY,model,undefined,undefined,await readTaskReviewContext(incomeId(body.taskId))));
    return respond(await chat(turns,body.mode==='draft',process.env.OPENAI_API_KEY,model,undefined,validateAssistantPage(body.page),undefined,body.mode==='assistant'||body.mode==='draft'));
  }catch(e){
    if(e instanceof AssistantInputError||e instanceof IncomeInputError||e instanceof SyntaxError)return respond({error:e instanceof SyntaxError?'内容格式无效':e.message},400);
    return respond({error:'服务连接失败或超时。请稍后重新查询或核对草稿状态。'},502);
  }finally{running--;}
}

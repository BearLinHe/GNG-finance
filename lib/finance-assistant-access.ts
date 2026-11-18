import {createHash, createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import {localAssistantRequest} from './finance-assistant';

export const sessionCookie='__Host-gng-assistant';
export const sessionSeconds=4*60*60;
type Config={NODE_ENV?:string;VERCEL?:string;VERCEL_ENV?:string;NEXT_PUBLIC_OAK_LOCAL_ASSISTANT?:string;FINANCE_ASSISTANT_ACCESS_CODE?:string};

export function assistantMode(env:Config):'off'|'local'|'hosted' {
  if(env.NODE_ENV==='development')return env.NEXT_PUBLIC_OAK_LOCAL_ASSISTANT==='1'?'local':'off';
  const key=env.FINANCE_ASSISTANT_ACCESS_CODE;
  return env.NODE_ENV==='production'&&(!env.VERCEL_ENV||env.VERCEL_ENV==='production')&&key&&/^[\x21-\x7e]{32,256}$/.test(key)&&!key.startsWith('sk-')?'hosted':'off';
}
export function assistantAccess(req:Request,env:Config) {
  const mode=assistantMode(env);
  if(mode==='local')return localAssistantRequest(req,true)?'allowed':'denied';
  if(mode!=='hosted')return 'denied';
  const url=new URL(req.url),host=req.headers.get('host');
  // Vercel terminates TLS; Next may construct the internal URL with the function's host/port.
  const forwardedTls=env.VERCEL==='1'&&req.headers.get('x-forwarded-proto')==='https';
  if(!host||!/^[a-z0-9.-]+(:\d+)?$/i.test(host)||(!forwardedTls&&(url.protocol!=='https:'||host!==url.host)))return 'denied';
  if(req.method!=='GET'&&(req.method!=='POST'||req.headers.get('origin')!=='https://'+host||req.headers.get('content-type')?.split(';')[0]!=='application/json'))return 'denied';
  const token=req.headers.get('cookie')?.split(/;\s*/).find(x=>x.startsWith(sessionCookie+'='))?.slice(sessionCookie.length+1)||'';
  const parts=token.split('.');
  if(parts.length!==3||!/^\d{10}$/.test(parts[0])||!/^[a-f0-9-]{36}$/.test(parts[1])||Number(parts[0])<=Date.now()/1000)return 'locked';
  return sameSecret(parts[2],sign(env.FINANCE_ASSISTANT_ACCESS_CODE!,host,parts[0]+'.'+parts[1]))?'allowed':'locked';
}
function sign(code:string,host:string,payload:string){return createHmac('sha256',code).update('assistant:'+host+':'+payload).digest('base64url');}
export function sameSecret(a:unknown,b:string){
  if(typeof a!=='string'||a.length>256)return false;
  const hash=(s:string)=>createHash('sha256').update(s).digest();
  return timingSafeEqual(hash(a),hash(b));
}
export function issueAssistantSession(code:string,host:string){
  const payload=(Math.floor(Date.now()/1000)+sessionSeconds)+'.'+randomUUID();
  return payload+'.'+sign(code,host,payload);
}

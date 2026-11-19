import {randomBytes} from 'node:crypto';
import {localAssistantRequest} from './finance-assistant';

export const sessionSeconds=4*60*60;
type Config={NODE_ENV?:string;VERCEL?:string;VERCEL_ENV?:string;NEXT_PUBLIC_OAK_LOCAL_ASSISTANT?:string};

export function assistantMode(env:Config):'off'|'local'|'hosted' {
  if(env.NODE_ENV==='development')return env.NEXT_PUBLIC_OAK_LOCAL_ASSISTANT==='1'?'local':'off';
  return env.NODE_ENV==='production'&&(!env.VERCEL_ENV||env.VERCEL_ENV==='production')?'hosted':'off';
}
export function assistantAccess(req:Request,env:Config) {
  if(req.headers.get('sec-fetch-site')==='cross-site'||!['GET','POST'].includes(req.method))return 'denied';
  const mode=assistantMode(env);
  if(mode==='local')return localAssistantRequest(req,true)?'local':'denied';
  if(mode!=='hosted')return 'denied';
  const url=new URL(req.url),host=req.headers.get('host');
  // Vercel terminates TLS; Next may construct the internal URL with the function's host/port.
  const forwardedTls=env.VERCEL==='1'&&req.headers.get('x-forwarded-proto')==='https';
  if(!host||!/^[a-z0-9.-]+(:\d+)?$/i.test(host)||(!forwardedTls&&(url.protocol!=='https:'||host!==url.host)))return 'denied';
  if(req.method!=='GET'&&(req.method!=='POST'||req.headers.get('origin')!=='https://'+host||req.headers.get('content-type')?.split(';')[0]!=='application/json'))return 'denied';
  return 'hosted';
}
// This is a browser's draft namespace, not a login or a shared public identity.
export function assistantVisitor(req:Request,mode:'local'|'hosted'){
  const name=mode==='hosted'?'__Host-gng-assistant-visitor':'gng-local-assistant-visitor';
  const value=req.headers.get('cookie')?.split(/;\s*/).find(x=>x.startsWith(name+'='))?.slice(name.length+1);
  if(value&&/^[a-f0-9]{64}$/.test(value))return {name,value,isNew:false};
  return {name,value:randomBytes(32).toString('hex'),isNew:true};
}

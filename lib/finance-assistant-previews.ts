import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {AssistantInputError} from './finance-assistant';
import {ensureSystemSchema,withSystemClient} from './system-db';

const actor=new AsyncLocalStorage<string>();
export function withPreviewSession<T>(session:string,fn:()=>T){
  return actor.run(createHash('sha256').update(session).digest('hex'),fn);
}
type Kind='expense'|'work';
const valid=(token:unknown):token is string=>typeof token==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(token);
async function db<T>(fn:(client:PoolClient)=>Promise<T>){await ensureSystemSchema();return withSystemClient(fn);}
async function transaction<T>(run:typeof db,fn:(c:PoolClient)=>Promise<T>){
  return run(async c=>{await c.query('begin');try{const result=await fn(c);await c.query('commit');return result;}catch(e){await c.query('rollback');throw e;}});
}
export async function storePreview(kind:Kind,payload:unknown,run=db){
  const token=randomUUID();
  await transaction(run,async c=>{
    await c.query('select pg_advisory_xact_lock(19432,1)');
    await c.query('delete from finance_assistant_previews where expires_at<=now()');
    const owner=actor.getStore()??'local';
    const response=await c.query(`insert into finance_assistant_previews(token,kind,owner,payload)
      select $1,$2,$3,$4::jsonb where (select count(*) from finance_assistant_previews where owner=$3 and result is null)<128`,[token,kind,owner,JSON.stringify(payload)]);
    if(!response.rowCount)throw new AssistantInputError('待确认草稿过多，请先放弃不用的草稿');
  });
  return token;
}
// Lock the preview, recheck the underlying books and record the outcome in one transaction.
export async function applyPreview<T>(kind:Kind,token:unknown,write:(c:PoolClient,payload:T)=>Promise<string[]>,run=db){
  if(!valid(token))throw new AssistantInputError('预览已失效，请重新核对');
  return transaction(run,async c=>{
    const {rows:[row]}=await c.query<{payload:T;result:string[]|null}>('select payload,result from finance_assistant_previews where token=$1 and kind=$2 and owner=$3 and expires_at>now() for update',[token,kind,actor.getStore()??'local']);
    if(!row)throw new AssistantInputError('预览已失效，请重新核对');
    if(row.result)return row.result;
    const ids=await write(c,row.payload);
    await c.query("update finance_assistant_previews set result=$2::jsonb,payload='null'::jsonb where token=$1",[token,JSON.stringify(ids)]);
    return ids;
  });
}
export async function dropPreview(kind:Kind,token:unknown,run=db){
  if(typeof token!=='string')throw new AssistantInputError('草稿编号无效');
  if(!valid(token))return;
  const {rowCount}=await run(c=>c.query('delete from finance_assistant_previews where token=$1 and kind=$2 and owner=$3 and result is null',[token,kind,actor.getStore()??'local']));
  if(!rowCount)throw new AssistantInputError('草稿已失效或已确认');
}

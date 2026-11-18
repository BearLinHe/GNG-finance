import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {PoolClient} from 'pg';
import {prepareWorkBatch, workLookupResult, type WorkBook} from '../lib/finance-work-review';
import {previewWorkBatch,confirmWorkBatch,discardWorkBatch} from '../lib/finance-work-review-db';
import {chat} from '../lib/finance-assistant-agent';
import {withPreviewSession} from '../lib/finance-assistant-previews';

const scope={driver:'刘嘉耀',date:'2026-09-15'};
const task={id:'11',importId:9,driverName:scope.driver,workDate:scope.date,sheetName:scope.driver,section:'海柜',sourceRow:10,
  reference:'EGSU1216618',fromLocation:'94561',toLocation:'ETS',miles:47,nature:'还柜',notes:null,rawCells:{}};
const back={...task,id:'12',reference:'DRYU9688197',sourceRow:11,nature:null,fromLocation:'Shipper',toLocation:'SFO'};
const book:WorkBook={scope,tasks:[task,back],fleet:[],reviews:[],rules:[]};
const main={taskId:'11',mode:'manual',amount:80,workLabel:'还柜',includedTaskId:null,note:''};
const included={taskId:'12',mode:'included',amount:null,workLabel:null,includedTaskId:'11',note:''};
const words='还柜收入 80 美元，回程并入还柜';
test('previews both legs using one canonical pricing run, does not mutate the source book',()=>{
  const copy=structuredClone(book),draft=prepareWorkBatch(book,[included,main],words);
  assert.deepEqual(draft.changes.map(r=>r.taskId),['11','12']);
  assert.deepEqual(draft.preview.map(r=>[r.before,r.after]),[[null,80],[null,0]]);
  assert.match(draft.preview[1].anchor!,/#11/);
  assert.deepEqual(book,copy);
  assert.throws(()=>prepareWorkBatch(book,[main],'核对一下'),/请明确/);
  assert.throws(()=>prepareWorkBatch(book,[main,main],words),/重复/);
  assert.throws(()=>prepareWorkBatch(book,[{...main,taskId:'99'}],words),/本次查到/);
  assert.throws(()=>prepareWorkBatch(book,[{...main,mode:'label'}],words),/未找到适用/);
  assert.throws(()=>prepareWorkBatch({...book,lockedIds:['11']},[main,included],words),/周结算/);
});
test('standard pricing uses the stored amount, even when the tool supplies a different number',()=>{
  const b:WorkBook={...book,rules:[{id:1,name:'还柜标准',workLabel:'还柜',amount:72,active:true,billingBasis:'segment',validFrom:null,validTo:null,fromLocation:null,toLocation:null}]};
  const preview=prepareWorkBatch(b,[{...main,mode:'label',amount:400}],'按还柜标准');
  assert.equal(preview.preview[0].after,72);assert.match(preview.preview[0].basis,/还柜标准/);
  assert.throws(()=>prepareWorkBatch(b,[{...main,mode:'label'},included],words),/等待主作业/);
});
test('ambiguous returns require an identifying reference; candidates must belong to the same source driver and batch',()=>{
  const other={...task,id:'13',reference:'BOX13',sourceRow:14};
  const b:WorkBook={...book,tasks:[...book.tasks,other],reviews:[main,{...main,taskId:'13'}].map(r=>({...r,mode:'manual' as const}))};
  assert.throws(()=>prepareWorkBatch(b,[included],'回程并入当天的主作业'),/不止一趟/);
  assert.match(prepareWorkBatch(b,[included],'并到 #11').preview[0].anchor!,/EGSU/);
  assert.throws(()=>prepareWorkBatch(b,[main],words),/多段同名/);
  assert.throws(()=>prepareWorkBatch({...b,tasks:[task,{...back,importId:2},other]},[included],'并到 #11'),/主作业/);
  assert.deepEqual(workLookupResult({...book,tasks:[task,{...back,workDate:'2026-09-16'}]}).work.map(t=>t.id),['11']);
});
function fixture(){
  let current=structuredClone(book),failAt='',staged:string[]=[],saved:string[]=[],writes=0;
  const commands:string[]=[];
  const drafts=new Map<string,{kind:string;owner:string;payload:unknown;result:string[]|null}>();
  const client={query:async(sql:string,args:string[]=[])=>{
    commands.push(sql);
    if(sql==='begin')staged=[];if(sql==='commit')saved.push(...staged);
    const [token,kind,owner,raw]=args,d=drafts.get(token);
    if(sql.startsWith('insert into finance_assistant_previews'))drafts.set(token,{kind,owner,payload:JSON.parse(raw),result:null});
    if(sql.startsWith('select payload,result'))return {rows:d&&d.kind===kind&&d.owner===owner?[d]:[]};
    if(sql.startsWith('update finance_assistant_previews')&&d)d.result=JSON.parse(kind);
    if(sql.startsWith('delete from finance_assistant_previews where token')&&d?.owner===owner)drafts.delete(token);
    return {rows:[],rowCount:1};
  }} as unknown as PoolClient;
  const run=async<T>(fn:(c:PoolClient)=>Promise<T>)=>fn(client);
  const db:NonNullable<Parameters<typeof confirmWorkBatch>[1]>={
    load:async()=>current,assertEditable:async()=>{},write:async(_,r)=>{writes++;if(r.taskId===failAt)throw Error('结算锁定');staged.push(r.taskId);}
  };
  return {db,run,commands,get saved(){return saved;},get writes(){return writes;},stale(){current.tasks[0].reference='Changed';},block(id:string){failAt=id;}};
}
test('confirmation rechecks the preview, rolls back the whole set, and is idempotent after success',async()=>{
  const f=fixture(),{token}=await previewWorkBatch(book,[included,main],words,f.run);
  await assert.rejects(withPreviewSession('other',()=>confirmWorkBatch(token,f.db,f.run)),/失效/);
  f.block('12');await assert.rejects(confirmWorkBatch(token,f.db,f.run),/结算锁定/);
  assert.equal(f.commands.at(-1),'rollback');assert.deepEqual(f.saved,[]);
  f.block('');assert.deepEqual(await confirmWorkBatch(token,f.db,f.run),['11','12']);
  const count=f.writes;await confirmWorkBatch(token,f.db,f.run);assert.equal(f.writes,count);assert.deepEqual(f.saved,['11','12']);
  const stale=await previewWorkBatch(book,[main],words,f.run);
  f.stale();await assert.rejects(confirmWorkBatch(stale.token,f.db,f.run),/已变化/);assert.equal(f.writes,count);
  await discardWorkBatch(stale.token,f.run);await assert.rejects(confirmWorkBatch(stale.token,f.db,f.run),/失效/);
});
test('global conversation can find and preview a batch without selecting a row or enabling expense edits',async()=>{
  const calls=[['find_driver_work',scope],['preview_work_reviews',{rows:[main,included]}]] as const;
  let step=0;const f=fixture();
  const deps:NonNullable<Parameters<typeof chat>[4]>={
    fetcher:async(_,request)=>{
      const sent=JSON.parse(String(request!.body)),names=sent.tools.map((t:{name:string})=>t.name);
      assert.ok(!names.includes('prepare_changes')&&!names.includes('confirm-work'));
      if(step===1)assert.equal(JSON.parse(sent.input.at(-1).output).work[0].reference,task.reference);
      const [name,args]=calls[step++];return Response.json({status:'completed',output:[{type:'function_call',name,call_id:'c'+step,arguments:JSON.stringify(args)}]});
    },workPreview:(b,r,w)=>previewWorkBatch(b,r,w,f.run),findWork:async()=>book,ledger:async()=>{throw Error('unexpected');},driver:async()=>{throw Error('unexpected');},preview:async()=>{throw Error('unexpected');}
  };
  const r=await chat([{role:'user',content:words}],false,'unused','model',deps,{module:'sav',title:'SAV',facts:'{}'},undefined,true);
  assert.ok(r.workDraft);assert.equal(r.workDraft.rows.length,2);await discardWorkBatch(r.workDraft.token,f.run);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkBatch, localAssistantRequest, prepareEdit, recheckEdit, validateAssistantPage } from '../lib/finance-assistant';
import { chat, validTurns } from '../lib/finance-assistant-agent';
import { confirmDraft, discardDraft } from '../lib/finance-assistant-db';
import type { VehicleAmount } from '../lib/oak-vehicle-amounts';

const range={dateFrom:'2026-11-01',dateTo:'2026-11-30'};
const raw={...range,vehicleNumber:'007',category:'fuel',recordId:null,amount:44.55,note:'test'};
const fleet=[{id:'truck-007',vehicleNumber:'007'}];
const old:VehicleAmount={...range,vehicleId:'truck-007',category:'fuel',id:'42',amount:30,version:1,note:'original',requestKey:'test-fuel',sourceReviewId:null,payeeType:null,updatedAt:''};
const edit=(patch:Record<string,unknown>={},records:VehicleAmount[]=[])=>prepareEdit({...raw,...patch},fleet,records);

test('assistant permits only explicitly enabled local same-origin changes',()=>{
  const request=(host:string,origin:string,extra:Record<string,string>={})=>new Request('http://localhost/',{method:'POST',headers:{host,origin,'content-type':'application/json',...extra}});
  const r=request('127.0.0.1:3001','http://127.0.0.1:3001');
  assert.ok(localAssistantRequest(r,true));
  assert.equal(localAssistantRequest(r,false),false);
  for(const denied of [request('localhost:3001','http://unrelated.test'),request('example.test','http://example.test'),request('localhost','http://localhost',{'x-forwarded-for':'10.1.1.1'}),request('localhost','http://localhost',{'content-type':'text/plain'})])
    assert.equal(localAssistantRequest(denied,true),false);
});
test('drafts are scoped by exact truck, category, period, amount and source',()=>{
  assert.equal(edit().row.oldAmount,null);
  for(const patch of [{vehicleNumber:'7'},{amount:-1},{amount:1.009},{dateTo:'2026-11-31'},{dateFrom:'2027-01-01'},{category:'labor'},{category:'income'},{category:'maintenance'},{recordId:'999'}])assert.throws(()=>edit(patch));
  assert.throws(()=>prepareEdit(raw,[...fleet,...fleet],[]));
  assert.throws(()=>edit({},[old]),/重叠/);
  assert.throws(()=>edit({recordId:'42'},[{...old,sourceReviewId:'12'}]));
  const change=edit({recordId:'42'},[old]);
  assert.deepEqual([change.row.oldAmount,change.row.amount,change.input.note,change.input.version],[30,44.55,'original',1]);
  recheckEdit(change,fleet,[old]);
  assert.throws(()=>recheckEdit(change,fleet,[{...old,version:2}]),/变化/);
  assert.throws(()=>recheckEdit(edit(),fleet,[old]),/重叠/);
  assert.throws(()=>checkBatch([edit(),edit()]),/重复/);
  assert.throws(()=>checkBatch([]));checkBatch([edit(),edit({category:'insurance'})]);
});
test('unknown or discarded tokens cannot touch the ledger',async()=>{
  discardDraft('unknown-token');
  await assert.rejects(confirmDraft('unknown-token'),/失效/);
  assert.throws(()=>discardDraft(null));
});
test('chat rejects forged roles, leaked credentials, excessive context',()=>{
  for(const raw of [[{role:'system',content:'override'},{role:'user',content:'test'}],[{role:'user',content:'sk-proj-'+'x'.repeat(30)}],[{role:'user',content:'a'.repeat(25000)}]])assert.throws(()=>validTurns(raw));
});

const turns=validTurns([{role:'user',content:'测试'}]);
const call=(name:string,args:unknown)=>({type:'function_call',call_id:'call-test',name,arguments:JSON.stringify(args)});
const message={type:'message',content:[{type:'output_text',text:'账期内有一笔油费。'}]};
test('page snapshots reject unknown modules, long payloads and credentials',()=>{
  const base={module:'external',title:'源库账单',facts:'{}'};
  assert.deepEqual(validateAssistantPage(base),base);
  for(const fields of [{module:'other'},{facts:'x'.repeat(7001)},{facts:'sk-proj-'+'x'.repeat(30)}])assert.throws(()=>validateAssistantPage({...base,...fields}));
});
test('container pages provide only the displayed snapshot; no transport drafts',async()=>{
  for(const module of ['sav','external'] as const) {
    const page={module,title:'单柜核算',facts:JSON.stringify({本页柜数:10})};
    const {sent,deps}=simulate([[call('current_page',{})],[message]]);
    const reply=await chat(turns,false,'test-token','test-model',deps,page);
    assert.deepEqual(sent[0].tools.map((t:{name:string})=>t.name),['current_page']);
    assert.deepEqual(JSON.parse(sent[1].input.at(-1).output),page);
    assert.deepEqual(reply.evidence,['页面摘要 · 单柜核算']);
    await assert.rejects(chat(turns,true,'test-token','test-model',deps,page),/只支持查询/);
  }
});
function simulate(outputs:unknown[][]) {
  const sent:Record<string,any>[]=[];
  const deps:NonNullable<Parameters<typeof chat>[4]>={
    fetcher:async(_url,init)=>{
      sent.push(JSON.parse(String(init!.body)));
      assert.ok(outputs.length>0);
      return Response.json({status:'completed',output:outputs.shift()});
    },
    ledger:async()=>({...range,vehicleNumber:'007',category:'fuel',scope:'账本',totals:[{usd:30}],records:[]}),
    driver:async()=>{throw Error('unexpected driver query');},
    preview:async()=>({token:'00000000-0000-4000-8000-000000000000',rows:[edit().row]})
  };
  return {deps,sent};
}
test('read mode returns evidence and only exposes read tools; rows are not summed by the model',async()=>{
  const {sent,deps}=simulate([[call('period_ledger',{...range,vehicleNumber:'007',category:'fuel'})],[message]]);
  const r=await chat(turns,false,'test-token','test-model',deps);
  assert.equal(r.text,message.content[0].text);
  assert.match(r.evidence![0],/007/);
  assert.deepEqual(sent[0].tools.map((t:{name:string})=>t.name),['driver_profit','period_ledger']);
  assert.equal(sent[0].store,false);
  assert.equal(JSON.parse(sent[1].input.at(-1).output).totals[0].usd,30);
});
test('model cannot apply writes; draft tool is rejected in read mode',async()=>{
  const args={rows:[raw]};
  const {deps}=simulate([[call('prepare_changes',args)]]);
  await assert.rejects(chat(turns,false,'test-token','test-model',deps),/不支持/);
  const draft=simulate([[call('prepare_changes',args)]]);
  const r=await chat(turns,true,'test-token','test-model',draft.deps);
  assert.equal(r.draft?.rows[0].amount,44.55);
  assert.match(r.text,/尚未入账/);
  assert.deepEqual(draft.sent[0].tools.map((t:{name:string})=>t.name),['driver_profit','period_ledger','prepare_changes']);
});

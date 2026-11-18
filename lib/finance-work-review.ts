import { createHash } from 'node:crypto';
import { AssistantInputError, taskReviewProposal } from './finance-assistant';
import { summarizeDriverTasks, type DriverTask } from './oak-driver-types';
import { priceDriverDays, type IncomeReview, type IncomeRule } from './oak-income';
import type { OakVehicle } from './oak-vehicles';

export type WorkScope = { driver:string; date:string };
export type WorkBook = { scope:WorkScope; tasks:DriverTask[]; rules:IncomeRule[]; reviews:IncomeReview[]; fleet:OakVehicle[]; lockedIds?:string[] };
export type WorkChange = {
  id:string; date:string; driver:string; reference:string; route:string; work:string;
  before:number|null; after:number|null; basis:string; anchor:string|null; automatic:boolean; note:string;
};
export type WorkDraft = {token:string; rows:WorkChange[]};
const fail=(s:string):never=>{throw new AssistantInputError(s);};
const anchorEligible=(t:DriverTask)=>t.income?.status==='priced' && (t.income.source==='manual'||t.income.billingBasis==='trip');
const label=(t:DriverTask)=>t.income?.workLabel||t.nature||'运输';
const route=(t:DriverTask)=>[t.fromLocation||'未知起点',t.toLocation||'未知终点'].join(' → ');
const describe=(t:DriverTask)=>`#${t.id} · ${t.workDate} · ${label(t)} · ${t.reference||'原表第 '+t.sourceRow+' 行'} · ${route(t)}`;
function rated(book:WorkBook, changes:IncomeReview[]=[]) {
  const all=new Map(book.reviews.map(r=>[r.taskId,r]));
  for(const r of changes)all.set(r.taskId,r);
  return priceDriverDays(summarizeDriverTasks(book.tasks),book.rules,[...all.values()],book.fleet).flatMap(d=>d.tasks);
}
export function workLookupResult(book:WorkBook) {
  const tasks=rated(book);
  const fields=(t:DriverTask)=>({id:t.id,date:t.workDate,driver:t.driverName,batch:t.importId,sourceRow:t.sourceRow,work:label(t),reference:t.reference,route:route(t),amount:t.income?.amount,basis:t.income?.basis,locked:book.lockedIds?.includes(t.id!)??false,canAnchor:anchorEligible(t)});
  return {scope:book.scope,work:tasks.filter(t=>t.workDate===book.scope.date).map(fields),otherDayAnchors:tasks.filter(t=>t.workDate!==book.scope.date && anchorEligible(t)).map(fields)};
}
function explicitlyIdentified(t:DriverTask, choices:DriverTask[], words:string) {
  const text=words.toLowerCase();
  return [`#${t.id}`,t.reference,label(t),route(t),`第${t.sourceRow}行`].some((s,i)=>{
    if(!s || !text.includes(s.toLowerCase()))return false;
    if(i===0)return new RegExp('#'+t.id+'(?![0-9])').test(text);
    if(i===1 && [...text.matchAll(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'ig'))].every(m=>/[a-z0-9]/i.test(text[m.index!+s.length]||' ')))return false;
    const same=choices.filter(c=>([null,c.reference,label(c),route(c),`第${c.sourceRow}行`][i]||'').toLowerCase()===s.toLowerCase());
    return same.length===1;
  });
}
export function prepareWorkBatch(book:WorkBook, raw:unknown, words:string) {
  if(!Array.isArray(raw)||!raw.length||raw.length>24)fail('每次请核对同一司机同一天的 1 至 24 段工单');
  const tasks=rated(book), before=new Map(tasks.map(t=>[t.id!,t]));
  const rows=raw as Record<string,unknown>[];
  if(rows.some(r=>!r||typeof r!=='object'||typeof r.taskId!=='string')||new Set(rows.map(r=>r.taskId)).size!==rows.length)fail('工单编号无效或重复');
  const selected=new Set(rows.map(r=>r.taskId));
  const proposedAnchors=new Set(rows.filter(r=>r.mode==='manual'||r.mode==='label').map(r=>r.taskId));
  const changes=rows.map(r=>{
    const task=before.get(String(r.taskId));
    if(!task||task.workDate!==book.scope.date)return fail('只能核对本次查到的司机和日期，请重新查工单');
    const similar=tasks.filter(t=>t.workDate===task.workDate && label(t)===label(task));
    const allAlike=similar.every(t=>selected.has(t.id) && rows.some(other=>other.taskId===t.id && other.mode===r.mode && other.amount===r.amount && other.workLabel===r.workLabel && other.includedTaskId===r.includedTaskId));
    if(similar.length>1 && !(allAlike && /全部|所有|每段|每笔|都按|均按/.test(words)) && !explicitlyIdentified(task,similar,words))
      fail('同日有多段同名作业，请指定路线、柜号或工单编号：'+similar.map(describe).join('；'));
    const anchors=tasks.filter(t=>t.id!==task.id && t.importId===task.importId && t.driverName===task.driverName && (anchorEligible(t)||proposedAnchors.has(t.id)));
    const review=taskReviewProposal(r,{task,anchors});
    if(!review.note)review.note=task.income?.review?.note||'';
    if(!review.workLabel)review.workLabel=task.income?.review?.workLabel||null;
    if(review.mode==='included') {
      const anchor=anchors.find(t=>t.id===review.includedTaskId)!;
      const sameDay=anchors.filter(t=>t.workDate===task.workDate);
      const choices=anchor.workDate===task.workDate && sameDay.length ? sameDay : anchors;
      if(choices.length>1 && !explicitlyIdentified(anchor,choices,words))fail('可能的主作业不止一趟，请指定主作业柜号或编号：'+choices.map(describe).join('；'));
    }
    if(review.mode==='manual'){
      const nums=words.replace(/(?<=\d),(?=\d{3}\b)/g,'').match(/(?<![A-Za-z\d.#-])\d+(?:\.\d+)?(?![A-Za-z\d.-])/g)||[];
      if(!nums.some(n=>Number(n)===review.amount) && !(review.amount===0 && /不收费|不计收入|零收入|免费/.test(words)))fail('请明确这段作业的公司收入金额（USD），不能用工资或相似路线推算');
    }
    return review;
  }).sort((a,b)=>Number(a.mode==='included')-Number(b.mode==='included'));
  const after=rated(book,changes), edits=new Map(changes.map(r=>[r.taskId,r]));
  const preview:WorkChange[]=[];
  for(const t of after){
    const old=before.get(t.id!)!, edit=edits.get(t.id!), income=t.income!;
    if(!edit && JSON.stringify(old.income)===JSON.stringify(income))continue;
    if(edit && (income.amount===null || (edit.mode==='included' && income.status!=='included')))
      fail(describe(t)+'：'+income.basis+'。请明确适用标准、主作业或人工金额。');
    if(!edit && income.amount===null && old.income?.amount!=null)fail(describe(t)+' 的已计价收入将变为待核对，请先核实主作业');
    const anchor=income.includedTaskId?after.find(a=>a.id===income.includedTaskId):undefined;
    preview.push({id:t.id!,driver:t.driverName,date:t.workDate,reference:t.reference||'原表第 '+t.sourceRow+' 行',route:route(t),work:label(t),
      before:old.income?.amount??null,after:income.amount,basis:income.basis,anchor:anchor?describe(anchor):null,automatic:!edit,note:edit?.note||''});
  }
  const stamp=createHash('sha256').update(JSON.stringify([tasks.map(t=>[describe(t),t.income]),changes,preview])).digest('hex');
  if(book.lockedIds?.some(id=>preview.some(r=>r.id===id)||changes.some(c=>c.includedTaskId===id || before.get(c.taskId)?.income?.includedTaskId===id)))
    fail('本批工单或主作业已进入确认的周结算，不能修改。整批未保存。');
  return {changes,preview,stamp};
}

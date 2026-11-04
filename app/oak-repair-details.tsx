"use client";
import {IncomeDialog,incomeMoney} from './oak-income-controls';
import type {RepairDetails} from '@/lib/oak-repair';
export default function OakRepairDetails({repair,onClose}:{repair:RepairDetails;onClose:()=>void}){
 return <IncomeDialog title={`维修库账单 · ${repair.invoiceNumber}`} busy={false} onClose={onClose} wide><div className="oak-income-form oak-repair-form"><div className="oak-income-fields oak-repair-document" aria-label="维修单完整明细">
  <div className="oak-repair-meta"><div><span>车号</span><strong>{repair.unitNumber}</strong></div><div><span>完工日期</span><strong>{repair.completedDate||'待核对'}</strong></div><div><span>进厂日期</span><strong>{repair.checkInDate||'未记录'}</strong></div><div><span>开票日期</span><strong>{repair.issuedDate||'未记录'}</strong></div></div>
  <div className="oak-repair-account"><span>来源账号</span><div><strong>{repair.sourceAccount?.name||repair.sourceAccount?.login||'未识别账号'}</strong><small>{repair.sourceAccount?.login||repair.sourceAccount?.id||'原账单未提供账号信息'}</small></div></div>
  <div className="oak-repair-company"><span>{repair.company||'未填写账单公司'}{repair.plate?` · 车牌 ${repair.plate}`:''}</span><span className="oak-source-tag">repair-quote · 只读</span></div>
  {repair.dateBasis!=='completed'?<div className="oak-batch-notice">缺少完工日期，当前展示的开票日期不作为已核对的维修日期。</div>:null}
  <div className="oak-repair-items"><h3>维修项目</h3>{repair.items.length?<ul>{repair.items.map((item,index)=><li key={index}>{item}</li>)}</ul>:<span className="muted">未单独记录维修项目</span>}</div>
  <h3>配件明细</h3><div className="table-wrap"><table aria-label="维修配件明细"><thead><tr><th>配件</th><th>数量</th><th>单价</th><th>金额</th></tr></thead><tbody>{repair.parts.map((part,index)=><tr key={index}><td>{part.name}</td><td>{part.qty}</td><td>{incomeMoney(part.unitPrice)}</td><td>{incomeMoney(part.amount)}</td></tr>)}{!repair.parts.length?<tr><td colSpan={4}>无配件明细</td></tr>:null}</tbody></table></div>
  <h3>人工明细</h3><div className="table-wrap"><table aria-label="维修人工明细"><thead><tr><th>项目</th><th>工时</th><th>工时单价</th><th>金额</th></tr></thead><tbody>{repair.labor.map((item,index)=><tr key={index}><td>{item.name}</td><td>{item.hours}</td><td>{incomeMoney(item.rate)}</td><td>{incomeMoney(item.amount)}</td></tr>)}{!repair.labor.length?<tr><td colSpan={4}>无人工明细</td></tr>:null}</tbody></table></div>
  <dl className="oak-repair-totals"><div><dt>配件</dt><dd>{incomeMoney(repair.partsAmount)}</dd></div><div><dt>人工</dt><dd>{incomeMoney(repair.laborAmount)}</dd></div><div><dt>清洁 / 其他</dt><dd>{incomeMoney(repair.cleaningAmount)}</dd></div><div><dt>税费</dt><dd>{incomeMoney(repair.taxAmount)}</dd></div><div><dt>正式账单总额</dt><dd>{incomeMoney(repair.total)}</dd></div></dl>
 </div><footer className="oak-dialog-actions"><button className="button ghost" onClick={onClose}>关闭</button></footer></div></IncomeDialog>;
}

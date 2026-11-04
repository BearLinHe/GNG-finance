import {test} from 'node:test';import assert from 'node:assert/strict';
import {excludedRepairOwnerIds,normalizeRepairInvoices,repairLocalDate,repairUnitAliases,repairUnitKey,type RepairFeedStatus} from '../lib/oak-repair';
import {oakVehicleSeeds} from '../lib/oak-vehicles';
import {calculateDatedVehicleAccounting,validateVehicleAmount,type VehicleAmount} from '../lib/oak-vehicle-amounts';
const vehicle=oakVehicleSeeds[4],date='2026-10-09',range={dateFrom:'2026-10-03',dateTo:date};
const invoice=(overrides:Record<string,unknown>={})=>({id:'invoice-1',case_id:'case-1',invoice_number:'INV-001',unit_number:'877',case_status:'COMPLETED',payment_status:'UNPAID',grand_total_cents:12345,parts_revenue_cents:8000,labor_revenue_cents:3000,cleaning_fee_cents:500,tax_cents:845,parts_cost_cents:1000,completed_ms:Date.parse('2026-10-10T02:00:00Z'),issued_ms:Date.parse('2026-10-11T02:00:00Z'),updated_ms:Date.parse('2026-10-11T02:00:00Z'),check_in_ms:Date.parse('2026-10-07T20:00:00Z'),snapshot:{repair_items:[{name:'更换刹车'}],parts:[{name:'刹车片',qty:2,unit_price_cents:4000,line_total_cents:8000}],labor:[{name:'更换',hours:1,rate_cents:3000,line_total_cents:3000}]},...overrides});
const feed=(values:Record<string,any>[])=>normalizeRepairInvoices([vehicle],[{unit_number:'877'}],values);
test('repair costs use completed non-void final invoice totals, never inventory cost',()=>{
 const result=feed([invoice(),invoice({id:'void',payment_status:'VOID'}),invoice({id:'draft',case_status:'IN_PROGRESS'})]);
 assert.equal(result.records.length,1);assert.equal(result.records[0].amount,123.45);assert.equal(result.records[0].repair?.partsAmount,80);assert.equal(result.records[0].repair?.taxAmount,8.45);assert.equal(result.records[0].source,'repair');
});
test('bearlinhe test-account cases never establish a matched vehicle or a zero repair cost',()=>{
 for(const owner of excludedRepairOwnerIds){
  const source=normalizeRepairInvoices([vehicle],[{unit_number:'877',clerk_user_id:owner}],[invoice({clerk_user_id:owner})]);
  assert.equal(source.records.length,0);assert.deepEqual(source.status.matchedVehicleIds,[]);
  assert.equal(calculateDatedVehicleAccounting(vehicle,range,[],[],null,'hash',source.records,source.status).lines.maintenance.amount,null);
 }
});
test('test-account invoices are excluded even when the work order belongs to another account',()=>{
 for(const owner of excludedRepairOwnerIds){
  const source=feed([invoice({clerk_user_id:'production-owner',invoice_owner_id:owner,grand_total_cents:-1})]);
  assert.equal(source.records.length,0);assert.deepEqual(source.status.warnings,[]);assert.deepEqual(source.status.reviewVehicleIds,[]);
 }
});
test('production invoices remain counted when a test account uses the same vehicle number',()=>{
 const source=normalizeRepairInvoices([vehicle],[{unit_number:'877',clerk_user_id:excludedRepairOwnerIds[0]},{unit_number:'877',clerk_user_id:'production-owner'}],
  [invoice({clerk_user_id:excludedRepairOwnerIds[0]}),invoice({id:'production',clerk_user_id:'production-owner',invoice_owner_id:'production-owner'})]);
 assert.deepEqual(source.status.matchedVehicleIds,[vehicle.id]);assert.equal(source.records.length,1);assert.equal(source.records[0].id,'repair-production');
 assert.equal(calculateDatedVehicleAccounting(vehicle,range,[],[],null,'hash',source.records,source.status).lines.maintenance.amount,123.45);
});
test('repair dates use Los Angeles completion day, not invoice day or UTC day',()=>{
 const record=feed([invoice()]).records[0];assert.equal(record.dateFrom,'2026-10-09');assert.equal(record.dateTo,'2026-10-09');assert.equal(record.repair?.issuedDate,'2026-10-10');assert.equal(repairLocalDate(Date.parse('2026-01-01T03:00:00Z')),'2025-12-31');
});
test('repair source account comes from the invoice owner, never the billing company',()=>{
 const source=feed([invoice({clerk_user_id:'case-owner',invoice_owner_id:'invoice-owner',account_name:'Repair Shop',account_login:'shop@example.com',bill_to_company:'Customer Company'})]);
 assert.deepEqual(source.records[0].repair?.sourceAccount,{id:'invoice-owner',name:'Repair Shop',login:'shop@example.com'});
 assert.deepEqual(feed([invoice({invoice_owner_id:'unknown-owner'})]).records[0].repair?.sourceAccount,{id:'unknown-owner',name:null,login:null});
});
test('vehicle matching preserves leading zeroes and never guesses a different unit number',()=>{
 const zero=oakVehicleSeeds.find(item=>item.vehicleNumber==='007')!;const result=normalizeRepairInvoices([zero],[{unit_number:'7'}],[invoice({unit_number:'7'})]);assert.equal(result.records.length,0);assert.equal(result.status.matchedVehicleIds.length,0);assert.equal(repairUnitKey(' ００７ '),'007');
});
test('California truck prefixes match the OAK unit while preserving the original repair label and account',()=>{
 const zero=oakVehicleSeeds.find(item=>item.vehicleNumber==='007')!;
 const result=normalizeRepairInvoices([zero],[{unit_number:'CA Truck 007',clerk_user_id:'production'}],
  [invoice({unit_number:'CA Truck 007',clerk_user_id:'production',invoice_owner_id:'production',grand_total_cents:766635})]);
 assert.deepEqual(result.status.matchedVehicleIds,[zero.id]);assert.equal(result.records.length,1);
 assert.equal(result.records[0].amount,7666.35);assert.equal(result.records[0].repair?.unitNumber,'CA Truck 007');
 assert.deepEqual(repairUnitAliases('007'),['007','TRUCK 007','CA TRUCK 007']);assert.equal(repairUnitKey(' ca  truck\t００７ '),'007');
});
test('legacy Truck 905 invoices map to vehicle 905 with their exact amount and completion date',()=>{
 const truck=oakVehicleSeeds.find(item=>item.vehicleNumber==='905')!;
 const result=normalizeRepairInvoices([truck],[{unit_number:'Truck 905',clerk_user_id:'production'}],[invoice({
  invoice_number:'2026091010458028',unit_number:'Truck 905',plate:'XP66080',clerk_user_id:'production',invoice_owner_id:'production',
  payment_status:'PAID',grand_total_cents:196900,completed_ms:Date.parse('2026-09-10T15:55:02.925Z')
 })]);
 assert.deepEqual(result.status.matchedVehicleIds,[truck.id]);assert.equal(result.records.length,1);
 const record=result.records[0];assert.equal(record.vehicleId,truck.id);assert.equal(record.amount,1969);
 assert.equal(record.dateFrom,'2026-09-10');assert.equal(record.repair?.unitNumber,'Truck 905');
 assert.equal(record.repair?.invoiceNumber,'2026091010458028');assert.equal(record.repair?.plate,'XP66080');
 assert.equal(calculateDatedVehicleAccounting(truck,{dateFrom:'2026-09-01',dateTo:'2026-09-30'},[],[],null,'hash',result.records,result.status).lines.maintenance.amount,1969);
 assert.equal(calculateDatedVehicleAccounting(truck,{dateFrom:'2026-10-01',dateTo:'2026-10-31'},[],[],null,'hash',result.records,result.status).lines.maintenance.amount,0);
});
test('plain, Truck and CA Truck aliases use the same exact key without losing leading zeroes',()=>{
 for(const vehicle of oakVehicleSeeds.filter(item=>item.vehicleNumber)){
  const number=vehicle.vehicleNumber!;
  for(const label of [number,`Truck ${number}`,`CA Truck ${number}`]){
   assert.equal(repairUnitKey(label),number);
   const result=normalizeRepairInvoices([vehicle],[{unit_number:label}],[invoice({unit_number:label})]);
   assert.equal(result.records[0]?.vehicleId,vehicle.id,label);
  }
 }
 assert.equal(repairUnitKey(' truck\t００７ '),'007');assert.notEqual(repairUnitKey('Truck 7'),repairUnitKey('Truck 007'));
 assert.notEqual(repairUnitKey('Truck 608'),repairUnitKey('Truck 0608'));
 assert.deepEqual(repairUnitAliases(null),[]);
});
test('the known owner annotation matches 0608 without changing its source label, amount or date',()=>{
 const truck=oakVehicleSeeds.find(item=>item.vehicleNumber==='0608')!;
 for(const label of ['CA Truck 0608（车主）','CA Truck 0608 (车主)','Truck 0608(车主)','0608（车主）',' ca  truck\t0608 （车主） ']){
  const result=normalizeRepairInvoices([truck],[{unit_number:label}],[invoice({unit_number:label,invoice_number:'2026100167792158',grand_total_cents:22000,completed_ms:Date.parse('2026-10-01T22:14:34.188Z')})]);
  assert.equal(repairUnitKey(label),'0608',label);assert.deepEqual(result.status.matchedVehicleIds,[truck.id]);
  assert.equal(result.records.length,1);assert.equal(result.records[0].vehicleId,truck.id);
  assert.equal(result.records[0].amount,220);assert.equal(result.records[0].dateFrom,'2026-10-01');
  assert.equal(result.records[0].repair?.unitNumber,label);
 }
});
test('owner annotations do not broaden matching to other states, equipment, numbers or unknown suffixes',()=>{
 const truck=oakVehicleSeeds.find(item=>item.vehicleNumber==='0608')!;
 for(const label of ['CA Truck 608（车主）','GA Truck 0608（车主）','CA Trailer 0608（车主）','CA Chassis 0608（车主）','Customer 0608（车主）','CA Truck 0608（其他）','CA Truck 0608（车主） extra','CA Truck 0608（车主维修）']){
  const result=normalizeRepairInvoices([truck],[{unit_number:label}],[invoice({unit_number:label})]);
  assert.equal(result.records.length,0,label);assert.deepEqual(result.status.matchedVehicleIds,[],label);
 }
 const label='CA Truck 0608（车主）';
 for(const owner of excludedRepairOwnerIds){
  const result=normalizeRepairInvoices([truck],[{unit_number:label,clerk_user_id:owner}],[invoice({unit_number:label,clerk_user_id:owner,invoice_owner_id:owner})]);
  assert.equal(result.records.length,0);assert.deepEqual(result.status.matchedVehicleIds,[]);
 }
 const ambiguous=normalizeRepairInvoices([truck,{...truck,id:'duplicate'}],[{unit_number:label}],[invoice({unit_number:label})]);
 assert.equal(ambiguous.records.length,0);assert.deepEqual(ambiguous.status.matchedVehicleIds,[]);
});
test('matching an owner-labelled repair does not override driver versus owner cost accounting',()=>{
 const truck=oakVehicleSeeds.find(item=>item.vehicleNumber==='0608')!,label='CA Truck 0608（车主）',range={dateFrom:'2026-10-01',dateTo:'2026-10-31'};
 const source=normalizeRepairInvoices([truck],[{unit_number:label}],[invoice({unit_number:label,grand_total_cents:22000,completed_ms:Date.parse('2026-10-01T22:14:34.188Z')})]);
 const wage:VehicleAmount={id:'1',vehicleId:truck.id,category:'labor',...range,amount:100,payeeType:'driver',note:'',version:1,requestKey:'test-wage',sourceReviewId:null,updatedAt:date};
 const driver=calculateDatedVehicleAccounting(truck,range,[],[],null,'hash',[...source.records,wage],source.status);
 assert.equal(driver.lines.maintenance.amount,220);assert.ok(!driver.lines.maintenance.notApplicable);
 const owner=calculateDatedVehicleAccounting(truck,range,[],[],null,'hash',[...source.records,{...wage,payeeType:'owner'}],source.status);
 assert.equal(owner.lines.maintenance.amount,0);assert.equal(owner.lines.maintenance.notApplicable,true);
 assert.equal(owner.lines.insurance.amount,0);assert.equal(owner.amounts?.filter(item=>item.source==='repair').length,1);
 assert.equal(calculateDatedVehicleAccounting(truck,{dateFrom:'2026-10-02',dateTo:'2026-10-31'},[],[],null,'hash',source.records,source.status).lines.maintenance.amount,0);
});
test('GA trucks, trailers, chassis and unrelated customer labels cannot cross-match the OAK roster',()=>{
 const zero=oakVehicleSeeds.find(item=>item.vehicleNumber==='007')!;
 for(const unit of ['GA Truck 007','CA Trailer 007','CA Chassis 007','Other Truck 007','CA Truck 7','CA Truck 007 extra','Customer 007']){
  const result=normalizeRepairInvoices([zero],[{unit_number:unit}],[invoice({unit_number:unit})]);
  assert.equal(result.records.length,0,unit);assert.deepEqual(result.status.matchedVehicleIds,[],unit);
 }
});
test('prefixed test-account records and ambiguous roster numbers still never count as repairs',()=>{
 for(const owner of excludedRepairOwnerIds){
  const result=normalizeRepairInvoices([vehicle],[{unit_number:'CA Truck 877',clerk_user_id:owner}],
   [invoice({unit_number:'CA Truck 877',clerk_user_id:owner,invoice_owner_id:owner})]);
  assert.equal(result.records.length,0);assert.deepEqual(result.status.matchedVehicleIds,[]);
 }
 const ambiguous=normalizeRepairInvoices([vehicle,{...vehicle,id:'duplicate'}],[{unit_number:'CA Truck 877'}],[invoice({unit_number:'CA Truck 877'})]);
 assert.equal(ambiguous.records.length,0);assert.deepEqual(ambiguous.status.matchedVehicleIds,[]);
});
test('invoice snapshots are authoritative and empty arrays do not double-count live case parts',()=>{
 const record=feed([invoice({snapshot:{parts:[],labor:[],repair_items:[]},parts:[{name:'new part',qty:1,unit_price_cents:100,line_total_cents:100}]})]).records[0];assert.equal(record.repair?.parts.length,0);assert.equal(record.repair?.labor.length,0);
});
test('source repair invoice identifiers cannot be submitted to the writable manual ledger',()=>{
 const record=feed([invoice()]).records[0];assert.throws(()=>validateVehicleAmount(record),/编号无效/);
});
test('source repairs flow to maintenance only inside their completion period',()=>{
 const source=feed([invoice()]);const result=calculateDatedVehicleAccounting(vehicle,range,[],[],null,'hash',source.records,source.status);assert.equal(result.lines.maintenance.amount,123.45);
 const other=calculateDatedVehicleAccounting(vehicle,{dateFrom:'2026-10-01',dateTo:'2026-10-08'},[],[],null,'hash',source.records,source.status);assert.equal(other.lines.maintenance.amount,0);
});
test('missing completion dates stay unverified instead of silently charging the invoice date',()=>{
 const source=feed([invoice({completed_ms:null})]);assert.equal(source.records[0].repair?.dateBasis,'issued');const result=calculateDatedVehicleAccounting(vehicle,{dateFrom:'2026-10-01',dateTo:'2026-10-31'},[],[],null,'hash',source.records,source.status);assert.equal(result.lines.maintenance.amount,null);assert.equal(result.net,null);
});
test('invalid repair totals do not silently become zero repair costs',()=>{
 const source=feed([invoice({grand_total_cents:-1})]);assert.equal(source.records.length,0);assert.ok(source.status.reviewVehicleIds?.includes(vehicle.id));assert.equal(calculateDatedVehicleAccounting(vehicle,range,[],[],null,'hash',[],source.status).lines.maintenance.amount,null);
});
test('source failure and unmatched unit numbers never produce an apparently complete zero expense',()=>{
 const unavailable:RepairFeedStatus={configured:true,available:false,message:'offline',matchedVehicleIds:[],warnings:[]};assert.equal(calculateDatedVehicleAccounting(vehicle,range,[],[],null,'hash',[],unavailable).lines.maintenance.amount,null);
 const unmatched={...unavailable,available:true};assert.equal(calculateDatedVehicleAccounting(vehicle,range,[],[],null,'hash',[],unmatched).lines.maintenance.amount,null);
});
test('manual additional repairs add once, while old aggregate overlap requires review',()=>{
 const source=feed([invoice()]);const manual:VehicleAmount={id:'1',vehicleId:vehicle.id,category:'maintenance',dateFrom:date,dateTo:date,amount:50,note:'外部维修',payeeType:null,version:1,requestKey:'manual-extra',sourceReviewId:null,updatedAt:date};
 assert.equal(calculateDatedVehicleAccounting(vehicle,range,[],[],null,'hash',[...source.records,manual],source.status).lines.maintenance.amount,173.45);
 const legacy={...manual,sourceReviewId:'1'};const pending=calculateDatedVehicleAccounting(vehicle,range,[],[],null,'hash',[...source.records,legacy],source.status);assert.equal(pending.lines.maintenance.amount,null);assert.equal(pending.net,null);
});

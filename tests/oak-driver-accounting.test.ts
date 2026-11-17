import assert from 'node:assert/strict';
import { test } from 'node:test';
import { davidDriverKey, davidTimeline, davidTrialRange, driverDirectory, driverProfit, effectiveDriverTimelines, hasSharedUse, validateDriverUses } from '../lib/oak-driver-accounting';
import type { RepairDetails } from '../lib/oak-repair';
import type { DriverTask } from '../lib/oak-driver-types';
import type { VehicleAmount } from '../lib/oak-vehicle-amounts';
import { oakVehicleSeeds as vehicles } from '../lib/oak-vehicles';

const { keyFor } = driverDirectory(vehicles, []);
const vehicle = (number: string) => vehicles.find(item => item.vehicleNumber === number)!.id;
const date = (dateFrom: string, dateTo = dateFrom) => ({ dateFrom, dateTo });
const timeline = davidTimeline(vehicles);
const fields = { dateFrom: '2026-08-01', dateTo: '2026-10-25', payeeType: null, version: 1, requestKey: 'test-entry', updatedAt: '', note: '', sourceReviewId: null } as const;
const amount = (category: VehicleAmount['category'], vehicleNumber: string, value: number, dates: ReturnType<typeof date>, id = '1'): VehicleAmount =>
  ({ ...fields, ...dates, id, category, vehicleId: vehicle(vehicleNumber), amount: value });
const task = (driverName: string, workDate: string, value: number): DriverTask => ({ driverName, sheetName: driverName, workDate, section: '', sourceRow: 1, reference: null, nature: null, fromLocation: null, toLocation: null, miles: 100, notes: null, rawCells: {},
  income: { status: 'priced', amount: value, workLabel: null, basis: '', source: 'rule', ruleId: 1, billingBasis: 'trip', includedTaskId: null, review: null } });
const payroll = (dates: ReturnType<typeof date>, sheetName = 'David Gao', vehicleNumber = '77', value = 700): VehicleAmount => ({ ...amount('labor', vehicleNumber, value, dates), payeeType: 'driver', payroll: {
  fileName: 'sample.xlsx', fileHash: 'sample', sheetName, candidate: { id: 'check', label: 'Check', amount: value, cells: [] }, warnings: [], note: '', originalAmount: value, confirmedAmount: value,
} });
const repairStatus = {configured:true, available:true, matchedVehicleIds:vehicles.map(v=>v.id), warnings:[], message:'维修库可用'};
const base = { range: davidTrialRange, timeline, timelines: [timeline], vehicles, tasks: [], amounts: [], sources: [], keyFor, repairStatus };

test('confirmed 877 assignment inherits existing monthly bills and yields to an explicit timeline', () => {
  const timelines = effectiveDriverTimelines([], vehicles), fixed = timelines.find(t=>t.driverKey==='张晓澄')!;
  const range = date('2026-10-01','2026-10-31');
  assert.deepEqual(validateDriverUses(fixed.uses,vehicles),fixed.uses);
  const result = driverProfit({...base,range,timelines,timeline:fixed, amounts:[
    amount('fuel','877',6754.66,range), amount('fuel','877',3580.49,range,'2'), amount('insurance','877',2038.79,range)
  ]});
  assert.deepEqual(result.periods.map(p=>p.vehicleId),[vehicle('877')]);
  assert.equal(result.fuel.amount,10335.15);
  assert.equal(result.insurance.amount,2038.79);
  const empty={...fixed,version:2,uses:[]};
  assert.deepEqual(effectiveDriverTimelines([empty],vehicles).filter(t=>t.driverKey===fixed.driverKey),[empty]);
});

test('repairs follow the completed date and assigned truck, including the David trial period', () => {
  const bill=(n:string,d:string,cost:number,id:string):VehicleAmount=>({...amount('maintenance',n,cost,date(d),id),source:'repair',repair:{dateBasis:'completed'} as RepairDetails});
  const invoices=[bill('77','2026-10-19',90,'r1'), bill('77','2026-10-20',120,'r2'),bill('3033','2026-10-20',75,'r3')];
  const result=driverProfit({...base,amounts:invoices});
  assert.equal(result.maintenance.amount,165);
  assert.equal(result.maintenance.sources.length,2);
  assert.equal(driverProfit({...base,repairStatus:{...repairStatus,available:false}}).maintenance.amount,null);
  assert.equal(driverProfit({...base,amounts:[...invoices,{...amount('maintenance','77',100,date('2026-10-19')),sourceReviewId:'42'}]}).maintenance.amount,null);
  const owner={...payroll(davidTrialRange),payeeType:'owner' as const};
  assert.equal(driverProfit({...base,amounts:[owner,...invoices]}).maintenance.amount,0);
});

test('David personal fuel and attributed insurance do not add legacy fleet expenses', () => {
  const result = driverProfit({ ...base, amounts: [amount('fuel', '77', 4321.83, date('2026-08-01', '2026-08-31')), amount('fuel', '3033', 11567.06, date('2026-10-01', '2026-10-31')), amount('insurance', '3033', 2485.63, date('2026-10-01', '2026-10-31'))] });
  assert.deepEqual(result.periods.map(p => [p.vehicleId, p.dateFrom, p.dateTo]), [
    [vehicle('2109'), '2026-08-01', '2026-08-31'], [vehicle('77'), '2026-09-01', '2026-10-19'], [vehicle('3033'), '2026-10-20', '2026-10-25'],
  ]);
  assert.equal(result.fuel.amount, 16023.88);
  assert.equal(result.insurance.amount, 3140.60);
  assert.equal(result.net, null);
});

test('extending David through October adds fuel but not unconfirmed insurance', () => {
  const result = driverProfit({ ...base, range: date('2026-08-01', '2026-10-31') });
  assert.equal(result.fuel.amount, 18940.09);
  assert.equal(result.insurance.amount, null);
  assert.equal(result.insurance.subtotal, 3140.60);
  assert.match(result.insurance.pending.join(), /10\/26/);
  const narrow = driverProfit({ ...base, range: date('2026-10-20', '2026-10-25') });
  assert.equal(narrow.insurance.amount, 497.13);
  assert.equal(narrow.fuel.amount, null);
});

test('income and payroll remain with the person across the swap, including previously linked vehicles', () => {
  const wages = payroll(date('2026-10-17', '2026-10-23'));
  const first = task('David Gao', '2026-10-19', 900);
  const second = task('David高', '2026-10-20', 900);
  const input = { ...base, range: date('2026-10-17', '2026-10-23'), tasks: [first, second, task('周亚峰', second.workDate, 400)], amounts: [wages, payroll(date('2026-10-17', '2026-10-23'), '周亚峰', '3033')], sources: [{ fileHash: 'sample', sheetNames: ['David Gao'] }] };
  const result = driverProfit(input);
  assert.equal(keyFor('○ David Gao'), davidDriverKey);
  assert.equal(keyFor('77'), null);
  assert.equal(result.income.amount, 1800);
  assert.equal(result.labor.amount, 700);
  const altered = { ...timeline, uses: [] };
  const missingVehicle = driverProfit({ ...input, timeline: altered, timelines: [altered] });
  assert.equal(missingVehicle.income.amount, 1800);
  assert.equal(missingVehicle.labor.amount, 700);
  assert.equal(missingVehicle.insurance.amount, null);
});

test('handoff apportions one vehicle shared bill by verified miles for fuel and by days for insurance', () => {
  const a = { driverKey: keyFor('张晓澄')!, version: 1, uses: [{ ...date('2026-11-01', '2026-11-10'), vehicleId: vehicle('877') }] };
  const b = { driverKey: keyFor('刘嘉耀')!, version: 1, uses: [{ ...date('2026-11-11', '2026-11-30'), vehicleId: vehicle('877') }] };
  const full = date('2026-11-01', '2026-11-30');
  const monthly = [amount('fuel', '877', 1200, full), amount('insurance', '877', 900, full), payroll(date('2026-11-01', '2026-11-10'), '张晓澄', '877')];
  const input = { ...base, timeline: a, timelines: [a, b], range: date('2026-11-01', '2026-11-10'), amounts: monthly, tasks: [task('张晓澄', '2026-11-08', 2000)], sources: [{ fileHash: 'sample', sheetNames: ['张晓澄'] }] };
  const mileage = { [a.driverKey]: { coverage: [full], days: [{ workDate: '2026-11-08', miles: 100 }], gaps: [] },
    [b.driverKey]: { coverage: [full], days: [{ workDate: '2026-11-16', miles: 300 }], gaps: [] } };
  const result = driverProfit({ ...input, mileage });
  assert.equal(result.fuel.amount, 300);
  assert.equal(result.insurance.amount, 300);
  assert.equal(result.net, 700);
  const repaired = driverProfit({...input,mileage,amounts:[...monthly,amount('maintenance','877',85,date('2026-11-09'))]});
  assert.equal(repaired.maintenance.amount,85);
  assert.equal(repaired.net,615);
  const offline = driverProfit({...input,mileage,repairStatus:{...repairStatus,available:false}});
  assert.equal(offline.maintenance.amount,null);
  assert.equal(offline.net,null);
  const incomplete = driverProfit({ ...input, mileage: { [a.driverKey]: mileage[a.driverKey] } });
  assert.equal(incomplete.fuel.amount, null);
  assert.equal(incomplete.net, null);
});

test('rejects reversed, overlapping and unnumbered vehicle records before saving', () => {
  assert.deepEqual(validateDriverUses([...timeline.uses].reverse(), vehicles), timeline.uses);
  assert.throws(() => validateDriverUses([{ ...timeline.uses[0], dateTo: '2026-07-30' }], vehicles), /结束日期/);
  assert.throws(() => validateDriverUses([{ ...timeline.uses[0], dateTo: null }, timeline.uses[1]], vehicles), /不能重叠/);
  assert.throws(() => validateDriverUses([{ ...timeline.uses[0], vehicleId: 'missing' }], vehicles), /车号/);
  assert.equal(hasSharedUse(timeline.uses, [{ ...timeline.uses[0], dateFrom: '2026-08-31' }]), true);
  assert.equal(hasSharedUse(timeline.uses, [{ ...timeline.uses[0], dateFrom: '2026-09-01', dateTo: null }]), false);
});

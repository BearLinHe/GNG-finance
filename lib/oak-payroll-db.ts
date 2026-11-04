import { ensureSystemSchema, withSystemClient } from './system-db';
import { readOakVehicles } from './oak-vehicles-db';
import { readVehicleAmounts } from './oak-vehicle-amounts-db';
import { overlaps } from './oak-vehicle-amounts';
import { parsePayrollWorkbook, payrollRequestKey } from './oak-payroll-import';
import { validatePayrollSelection, type PayrollSource } from './oak-payroll';
import {parseDriverWorkbook} from './oak-driver-import';
import {mergeIncomeWorkbook} from './oak-income-import-db';

export async function previewPayrollWorkbook(buffer: Buffer, fileName: string) {
  await ensureSystemSchema();
  return withSystemClient(async client => {
    const vehicles = await readOakVehicles(client);
    const preview = await parsePayrollWorkbook(buffer, fileName, vehicles);
    const existing = await readVehicleAmounts(client, preview);
    const keys = preview.sheets.map(sheet => payrollRequestKey(preview.fileHash, sheet.sheetName));
    const previous = (await client.query('select id::text,request_key,voided_at from oak_vehicle_amounts where request_key=any($1::text[])', [keys])).rows;
    for (const sheet of preview.sheets) {
      const duplicate = previous.find(row => row.request_key === payrollRequestKey(preview.fileHash, sheet.sheetName));
      if (duplicate) {
        sheet.existingId = duplicate.id; sheet.selected = false;
        sheet.warnings.push(duplicate.voided_at ? '此文件的工作表曾导入后删除，请核对已有记录' : '此工作表已导入，不会重复计入');
      } else if (existing.some(record => record.category === 'labor' && record.vehicleId === sheet.vehicleId && overlaps(record, preview))) {
        sheet.selected = false; sheet.warnings.push('此车辆同期已有工资明细，请先核对，不能重复导入');
      }
    }
    return { preview, vehicles };
  });
}

export async function importPayrollWorkbook(buffer: Buffer, fileName: string, value: unknown) {
  await ensureSystemSchema();
  return withSystemClient(async client => {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock_shared(19431,0)');
    try {
      for (const lock of [2, 3]) await client.query('select pg_advisory_xact_lock(19431,$1)', [lock]);
      const vehicles = await readOakVehicles(client);
      const preview = await parsePayrollWorkbook(buffer, fileName, vehicles);
      const input = validatePayrollSelection(value, preview, vehicles);
      const records = await readVehicleAmounts(client, input);
      let imported = 0, duplicates = 0;
      for (const selection of input.selections) {
        const key = payrollRequestKey(preview.fileHash, selection.sheetName);
        const previous = (await client.query('select id::text,vehicle_id,date_from::text,date_to::text,amount::float8,payee_type,payroll_source,voided_at from oak_vehicle_amounts where request_key=$1 for update', [key])).rows[0];
        if (previous) {
          if (previous.voided_at) throw new Error(`${selection.sheetName} 曾导入后删除，请在工资明细核对后处理`);
          const original = previous.payroll_source as PayrollSource | null;
          if (previous.vehicle_id !== selection.vehicleId || previous.date_from !== input.dateFrom || previous.date_to !== input.dateTo || previous.payee_type !== selection.payeeType || original?.candidate.id !== selection.candidateId || original?.confirmedAmount !== selection.amount || original?.note !== selection.note) throw new Error(`${selection.sheetName} 已导入，但本次确认内容不同，请直接修改已有工资明细`);
          duplicates++; continue;
        }
        if (records.some(record => record.category === 'labor' && record.vehicleId === selection.vehicleId && overlaps(record, input))) throw new Error(`${selection.sheetName}：此车辆同期已有工资明细，请先核对并处理，未重复入账`);
        const sheet = preview.sheets.find(item => item.sheetName === selection.sheetName)!;
        const candidate = sheet.candidates.find(item => item.id === selection.candidateId) || { id: 'manual', label: '人工核定', amount: null, cells: [] };
        const source: PayrollSource = { fileName: preview.fileName, fileHash: preview.fileHash, sheetName: sheet.sheetName, candidate,
          originalAmount: candidate.amount, confirmedAmount: selection.amount, warnings: sheet.warnings, note: selection.note };
        const note = `${preview.fileName} · ${sheet.sheetName} · ${candidate.label}${selection.note ? ` · ${selection.note}` : ''}`.slice(0, 1000);
        const saved = await client.query(`insert into oak_vehicle_amounts(vehicle_id,category,date_from,date_to,amount,payee_type,note,request_key,payroll_source)
          values($1,'labor',$2::date,$3::date,$4,$5,$6,$7,$8::jsonb) returning id::text`, [selection.vehicleId, input.dateFrom, input.dateTo, selection.amount, selection.payeeType, note, key, JSON.stringify(source)]);
        await client.query(`insert into oak_workflow_audit(entity_kind,entity_id,event,details) values('vehicle_amount',$1,'Excel 工资导入',$2::jsonb)`, [saved.rows[0].id, JSON.stringify({ ...input, selections: [selection], source })]);
        imported++;
      }
      let activities:{added:number;skipped:number}|undefined,activityWarning:string|undefined;
      await client.query('savepoint payroll_activity_sync');
      try{
        const work=await parseDriverWorkbook(buffer,fileName);
        const safe=input.selections.filter(selection=>work.sheets.some(sheet=>sheet.sheetName===selection.sheetName&&sheet.taskCount>0&&!sheet.warnings.length));
        if(work.warnings.length||safe.length!==input.selections.length)throw Error('周表作业含日期或路线提示，请在车辆收入页核对后同步');
        activities=await mergeIncomeWorkbook(client,work,safe.map(selection=>({sheetName:selection.sheetName,vehicleId:selection.vehicleId,payeeType:selection.payeeType})),vehicles);
        await client.query('release savepoint payroll_activity_sync');
      }catch(error){await client.query('rollback to savepoint payroll_activity_sync');activityWarning=error instanceof Error?error.message:'周表作业待同步';}
      await client.query('commit'); return { success: true, imported, duplicates, dateFrom: input.dateFrom, dateTo: input.dateTo,activities,activityWarning };
    } catch (error) { await client.query('rollback'); throw error; }
  });
}

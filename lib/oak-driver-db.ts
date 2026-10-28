import { ensureSystemSchema, withSystemClient } from "./system-db";
import { summarizeDriverPeriods, type DriverActivitiesResponse, type DriverImport, type DriverTask } from "./oak-driver-types";
import { resolveDriverBatchPeriod, type DriverBatchPeriod } from "./oak-driver-batch";
import { priceDriverDays, summarizeIncome } from "./oak-income";
import { readIncomeContext, readIncomeReviews, readIncomeRules } from "./oak-income-db";
import { summarizePayeeTypes } from "./oak-payee";

export async function saveDriverWorkbook(fileName: string, fileHash: string, tasks: DriverTask[], batchPeriod?: DriverBatchPeriod) {
  if (!tasks.length) throw new Error("请至少选择一个有作业记录的工作表");
  await ensureSystemSchema();
  const period = batchPeriod || resolveDriverBatchPeriod(fileName, tasks.map(task => task.workDate).sort()[0]);
  return withSystemClient(async (client) => {
    await client.query("begin");
    try {
      const added = await client.query(`
        insert into oak_driver_imports(file_name, file_hash, period_from, period_to) values ($1, $2, $3::date, $4::date)
        on conflict(file_hash) do nothing returning id
      `, [fileName, fileHash, period.from, period.to]);
      if (!added.rows.length) {
        const existing = await client.query("select id from oak_driver_imports where file_hash=$1", [fileHash]);
        await client.query("commit");
        return { importId: Number(existing.rows[0].id), duplicate: true };
      }
      const importId = Number(added.rows[0].id);
      await client.query(`
        insert into oak_driver_tasks (
          import_id, sheet_name, section, source_row, driver_name, work_date,
          reference, nature, from_location, to_location, miles, notes, raw_cells, payee_type
        )
        select $1, t."sheetName", t.section, t."sourceRow", t."driverName", t."workDate"::date,
          t.reference, t.nature, t."fromLocation", t."toLocation", t.miles, t.notes, t."rawCells", t."payeeType"
        from jsonb_to_recordset($2::jsonb) as t(
          "sheetName" text, section text, "sourceRow" integer, "driverName" text, "workDate" text,
          reference text, nature text, "fromLocation" text, "toLocation" text, miles numeric, notes text, "rawCells" jsonb, "payeeType" text
        )
      `, [importId, JSON.stringify(tasks)]);
      await client.query("commit");
      return { importId, duplicate: false };
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

export async function listDriverActivities(params: {
  driverName: string; dateFrom: string; dateTo: string; search: string;
  importId: number | null; page: number; pageSize: number;
}): Promise<DriverActivitiesResponse> {
  await ensureSystemSchema();
  return withSystemClient(async (client) => {
    const result = await client.query(`
      with filtered as (
        select t.*, i.file_name
        from oak_driver_tasks t join oak_driver_imports i on i.id=t.import_id
        where ($1::text = '' or t.driver_name=$1)
          and ($2::date is null or t.work_date >= $2::date)
          and ($3::date is null or t.work_date <= $3::date)
          and ($4::bigint is null or t.import_id=$4)
      ), days as (
        select driver_name, work_date, count(*)::int as task_count, sum(miles)::float8 as miles,
          jsonb_agg(jsonb_build_object(
            'id',id::text,'importId',import_id::int,
            'payeeType',payee_type,
            'sheetName',sheet_name,'section',section,'sourceRow',source_row,'driverName',driver_name,
            'workDate',work_date::text,'reference',reference,'nature',nature,'fromLocation',from_location,
            'toLocation',to_location,'miles',miles::float8,'notes',notes,'rawCells',raw_cells,'fileName',file_name
          ) order by import_id, sheet_name, section, source_row, id) as tasks
        from filtered group by driver_name,work_date
      ), imports as (
        select i.id::int as id,i.file_name as "fileName",i.created_at::text as "createdAt",
          count(t.id)::int as "taskCount",count(distinct t.driver_name)::int as "driverCount",
          i.period_from::text as "periodFrom", i.period_to::text as "periodTo",
          min(t.work_date)::text as "recordDateFrom",max(t.work_date)::text as "recordDateTo"
        from oak_driver_imports i join oak_driver_tasks t on t.import_id=i.id
        group by i.id order by i.created_at desc,i.id desc
      )
      select jsonb_build_object(
        'periodDays',coalesce((select jsonb_agg(jsonb_build_object(
          'driverName',driver_name,'workDate',work_date::text,'taskCount',task_count,'miles',miles,'tasks',tasks
        ) order by driver_name,work_date) from days),'[]'::jsonb),
        'dateRange',(select jsonb_build_object('from',min(work_date)::text,'to',max(work_date)::text) from filtered),
        'totalCount',(select count(distinct driver_name)::int from filtered),
        'summary',(select jsonb_build_object('driverCount',count(distinct driver_name)::int,
          'dayCount',count(distinct work_date)::int,'taskCount',count(*)::int,'miles',sum(miles)::float8) from filtered),
        'drivers',coalesce((select jsonb_agg(driver_name order by driver_name) from (select distinct driver_name from oak_driver_tasks) d),'[]'::jsonb),
        'subjectRoles',coalesce((select jsonb_agg(jsonb_build_object('driverName',driver_name,'sheetName',sheet_name,'payeeType',payee_type)) from (select distinct driver_name,sheet_name,payee_type from oak_driver_tasks) d),'[]'::jsonb),
        'imports',coalesce((select jsonb_agg(to_jsonb(i) order by "createdAt" desc,id desc) from imports i),'[]'::jsonb)
      ) as payload
    `, [params.driverName, params.dateFrom || null, params.dateTo || null, params.importId]);
    const { periodDays, subjectRoles, ...payload } = result.rows[0].payload;
    const subjects = payload.drivers.map((name: string) => {
      const identity = summarizePayeeTypes(subjectRoles.filter((task: DriverTask) => task.driverName === name));
      return { name, payeeType: identity.type, conflict: identity.conflict };
    });
    type RawImport = Omit<DriverImport, "dateFrom" | "dateTo" | "hasOutOfPeriodRecords"> & { periodFrom: string | null; periodTo: string | null };
    const imports = payload.imports.map(({ periodFrom, periodTo, ...item }: RawImport): DriverImport => {
      const period = periodFrom && periodTo ? { from: periodFrom, to: periodTo } : resolveDriverBatchPeriod(item.fileName, item.recordDateFrom);
      return { ...item, dateFrom: period.from, dateTo: period.to,
        hasOutOfPeriodRecords: item.recordDateFrom < period.from || item.recordDateTo > period.to };
    });
    const rules = await readIncomeRules(client);
    const reviews = await readIncomeReviews(client, periodDays.flatMap((day: { tasks: DriverTask[] }) => day.tasks.map(task => task.id!)));
    const context = await readIncomeContext(client, periodDays.flatMap((day: { tasks: DriverTask[] }) => day.tasks.map(task => task.id!)), reviews);
    // Price complete driver-days before text search so an included return keeps its main-job context.
    const search = params.search.trim().toLocaleLowerCase();
    const ratedDays = priceDriverDays([...periodDays, ...context.days], rules, [...reviews, ...context.reviews]).slice(0, periodDays.length).map(day => {
      const tasks = search ? day.tasks.filter(task => [task.reference, task.nature, task.fromLocation, task.toLocation, task.notes, task.income?.workLabel].filter(Boolean).join(" ").toLocaleLowerCase().includes(search)) : day.tasks;
      const mileValues = tasks.map(task => task.miles).filter((miles): miles is number => miles != null);
      return { ...day, tasks, taskCount: tasks.length, miles: mileValues.length ? Math.round(mileValues.reduce((sum, miles) => sum + miles, 0) * 100) / 100 : null, revenue: summarizeIncome(tasks) };
    }).filter(day => day.tasks.length);
    const periods = summarizeDriverPeriods(ratedDays);
    const tasks = ratedDays.flatMap(day => day.tasks);
    const dates = ratedDays.map(day => day.workDate).sort();
    const miles = tasks.map(task => task.miles).filter((value): value is number => value != null);
    return { ...payload, subjects, imports, periods: periods.slice((params.page - 1) * params.pageSize, params.page * params.pageSize),
      dateRange: { from: dates[0] || null, to: dates.at(-1) || null }, totalCount: periods.length,
      summary: { driverCount: periods.length, dayCount: new Set(dates).size, taskCount: tasks.length,
        miles: miles.length ? Math.round(miles.reduce((sum, value) => sum + value, 0) * 100) / 100 : null, revenue: summarizeIncome(tasks) },
      page: params.page, pageSize: params.pageSize };
  });
}

export async function deleteDriverImport(id: number) {
  await ensureSystemSchema();
  return withSystemClient(async (client) => {
    const linked = await client.query(`select s.id from oak_settlement_tasks st join oak_driver_tasks t on t.id=st.task_id
      join oak_weekly_settlements s on s.id=st.settlement_id where t.import_id=$1 limit 1`, [id]);
    if (linked.rowCount) throw new Error(`该批次已关联周结算单 #${linked.rows[0].id}，请先处理结算单，不能直接删除`);
    const result = await client.query("delete from oak_driver_imports where id=$1 returning id", [id]);
    return result.rowCount === 1;
  });
}

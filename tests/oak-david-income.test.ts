import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { summarizeDriverTasks, type DriverTask } from "../lib/oak-driver-types";
import { priceDriverDays, type IncomeReview } from "../lib/oak-income";
import { readRatedDriverTasks } from "../lib/oak-income-db";
import { oakVehicleSeeds } from "../lib/oak-vehicles";

const date = "2026-08-04";
function leg(row: number, fromLocation: string, toLocation: string, extra: Partial<DriverTask> = {}): DriverTask {
  return { id: String(row), sourceRow: row, importId: 1, sheetName: "David Gao", section: "海柜",
    driverName: "David Gao", workDate: date, fromLocation, toLocation, reference: "R002", nature: null, miles: 5,
    notes: null, rawCells: {}, ...extra };
}
const loop = [leg(12, "94587", "95014"), leg(13, "95014", "95014"), leg(14, "95014", "94587")];
const rate = (tasks: DriverTask[], reviews: IncomeReview[] = []) =>
  priceDriverDays(summarizeDriverTasks(tasks), [], reviews).flatMap(day => day.tasks);

function liLeg(row: number, from: string, to: string, extra: Partial<DriverTask> = {}) {
  return leg(row, from, to, { driverName: "李屈", sheetName: "李屈", workDate: "2026-10-14", reference: null, ...extra });
}

test("Li R003: start date inclusive, each complete loop once, SFO transfers excluded", () => {
  const tasks = [liLeg(1,"SFO","94587"),liLeg(2,"94587","95035"),liLeg(3,"95035","94040"),liLeg(4,"94040","94587"),
    liLeg(5,"94587","94804",{reference:"r003"}),liLeg(6,"94804","94589",{nature:"R003"}),liLeg(7,"94589","94587"),
    liLeg(8,"94587","SFO"),liLeg(9,"SFO","94587"),liLeg(10,"94587","95035")];
  const rated = rate(tasks);
  assert.deepEqual(rated.map(t=>t.income?.amount),[null,900,0,0,900,0,0,null,null,null]);
  assert.deepEqual(rated.slice(1,7).map(t=>t.income?.workLabel),Array(6).fill("R003"));
  assert.deepEqual(rated.slice(1,7).map(t=>t.income?.includedTaskId),[null,"2","2",null,"5","5"]);
  assert.ok(rate(tasks.map(t=>({...t,workDate:"2026-10-13"}))).every(t=>t.income?.amount==null));
});

test("Li R003 does not infer trips across unrelated jobs, broken routes or other drivers' sheets", () => {
  const first = liLeg(2,"94587","95035"), last = liLeg(3,"95035","94587");
  for(const fields of [{reference:"R002"},{reference:"空车"},{nature:"PU+DEL"},{toLocation:"SFO"},
    {fromLocation:"94040"},{sourceRow:4},{sheetName:"另一张表"},{driverName:"David Gao"}]){
    assert.ok(rate([first,{...last,...fields}]).every(t=>t.income?.amount==null));
  }
  const both = rate([first,last,...loop.map(t=>({...t,workDate:first.workDate,importId:2}))]);
  assert.deepEqual(both.filter(t=>t.income?.amount===900).map(t=>t.income?.workLabel).sort(),["R002","R003"]);
  assert.deepEqual(rate([first,last],[{taskId:"2",mode:"manual",workLabel:null,amount:850,note:"",includedTaskId:null}])
    .map(t=>t.income?.amount),[850,0]);
});

test("each return to 94587 closes one David R002 trip, including same-ZIP intermediate legs", () => {
  const input = [leg(11, "SFO", "94587", { reference: "空车" }), ...loop,
    leg(15, "94587", "94589"), leg(16, "94589", "94804"), leg(17, "94804", "94587"),
    leg(18, "94587", "SFO", { reference: "空车" })];
  const rated = rate([...input].reverse()).sort((a, b) => a.sourceRow - b.sourceRow);
  assert.deepEqual(rated.map(task => task.income?.amount), [null, 900, 0, 0, 900, 0, 0, null]);
  assert.deepEqual(rated.map(task => task.income?.includedTaskId), [null, null, "12", "12", null, "15", "15", null]);
  assert.ok(input.every(task => !task.income));
});

test("wrong base, missing or broken legs, other drivers, and duplicate batches do not receive the fixed rate", () => {
  for (const tasks of [loop.slice(0, 2), [loop[0], { ...loop[2], sourceRow: 13, fromLocation: "94804" }],
    [loop[0], { ...loop[2] }], [{ ...loop[0], fromLocation: "94578" }, loop[1], { ...loop[2], toLocation: "94578" }],
    loop.map(task => ({ ...task, driverName: "Another driver" })), loop.map(task => ({ ...task, reference: "R001" })),
    [...loop, ...loop.map(task => ({ ...task, id: `2${task.id}`, importId: 2 }))]]) {
    assert.ok(rate(tasks).every(task => task.income?.amount == null));
  }
  assert.equal(rate(loop.map(task => ({ ...task, driverName: "David高" })))[0].income?.amount, 900);
});

test("existing manual income is not overwritten or supplemented with a duplicate trip price", () => {
  const manual = { mode: "manual" as const, workLabel: null, includedTaskId: null, note: "已核对", amount: 725 };
  assert.deepEqual(rate(loop, [{ ...manual, taskId: "12" }]).map(task => task.income?.amount), [725, 0, 0]);
  assert.deepEqual(rate(loop, [{ ...manual, taskId: "13" }]).map(task => task.income?.amount), [null, 725, null]);
});

test("date-filtered income reads a cross-day trip's source context but returns only selected legs", async () => {
  const returnDate = "2026-08-05";
  const toDb = (task: DriverTask) => ({ id: task.id, source_row: task.sourceRow, import_id: task.importId,
    sheet_name: task.sheetName, section: task.section, driver_name: task.driverName, date_text: task.workDate,
    from_location: task.fromLocation, to_location: task.toLocation, reference: task.reference, miles: task.miles });
  const tasks = [loop[0], loop[1], { ...loop[2], workDate: returnDate }];
  for (const selectedDate of [date, returnDate]) {
    const selected = tasks.filter(task => task.workDate === selectedDate);
    const client = { async query(sql: string, args: unknown[]) {
      if (sql.includes('from oak_driver_tasks t join oak_driver_imports')) return { rows: selected };
      if (sql.includes('with trip_sheets')) {
        assert.deepEqual(args[2], selected.map(task => task.id));
        return { rows: tasks.filter(task => task.workDate !== selectedDate).map(toDb) };
      }
      assert.match(sql, /from oak_task_income_reviews/);
      return { rows: [] };
    } } as unknown as PoolClient;
    const rated = await readRatedDriverTasks(client, { dateFrom: selectedDate, dateTo: selectedDate }, oakVehicleSeeds, []);
    assert.deepEqual(rated.map(task => task.id), selected.map(task => task.id));
    assert.deepEqual(rated.map(task => task.income?.amount), selectedDate === date ? [900, 0] : [0]);
    if (selectedDate === returnDate) assert.equal(rated[0].income?.includedTaskId, "12");
  }
});

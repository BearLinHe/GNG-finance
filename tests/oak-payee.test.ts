import assert from "node:assert/strict";
import test from "node:test";
import { payeeIdentity, summarizePayeeTypes, taskPayeeType } from "../lib/oak-payee";
import { driverSubjectLabel, type DriverTask } from "../lib/oak-driver-types";
import { settlementSnapshot } from "../lib/oak-workflow";

test("leading owner markers recognize existing English and Chinese worksheet names", () => {
  for (const [name, recipient] of [["O Don", "Don"], ["O MARCO", "MARCO"], ["O王肃", "王肃"], ["O钟兴海", "钟兴海"], ["O 冯学飞", "冯学飞"], ["○ Don", "Don"], ["◯李师傅", "李师傅"], ["〇王师傅", "王师傅"], ["Ｏ Don", "Don"], ["o Don", "Don"]]) {
    assert.equal(payeeIdentity(name).type, "owner", name); assert.equal(payeeIdentity(name).payeeName, recipient);
    assert.equal(driverSubjectLabel(name), "车主");
  }
});
test("ordinary O names and numeric vehicle IDs do not become owners", () => {
  for (const name of ["Oliver", "Oscar", "Owen", "O'Donald", "张晓澄", "郭晓光", "0 Don"]) assert.equal(payeeIdentity(name).type, "driver", name);
  const vehicle = payeeIdentity("0608"); assert.equal(vehicle.type, null); assert.equal(vehicle.label, "车辆编号"); assert.equal(vehicle.payeeName, "");
  assert.equal(payeeIdentity("O 0608").payeeName, "");
});
test("owner identity survives import aliases and explicit role assignments", () => {
  assert.equal(taskPayeeType({ driverName: "Don", sheetName: "O Don" }), "owner");
  assert.equal(taskPayeeType({ driverName: "Don", sheetName: "Don", payeeType: "owner" }), "owner");
  assert.equal(taskPayeeType({ driverName: "0608", sheetName: "0608", payeeType: "owner" }), "owner");
  assert.equal(taskPayeeType({ driverName: "0608", sheetName: "0608", payeeType: "driver" }), "driver");
});
test("mixed identities are surfaced rather than silently selecting one payee price", () => {
  const owner = { driverName: "Don", sheetName: "O Don" }; const driver = { driverName: "Don", sheetName: "Don" };
  assert.deepEqual(summarizePayeeTypes([owner, owner]), { type: "owner", conflict: false, unknownCount: 0 });
  assert.equal(summarizePayeeTypes([owner, driver]).conflict, true);
  assert.equal(summarizePayeeTypes([{ driverName: "0608", sheetName: "0608" }]).type, null);
});
test("settlement snapshots record owner/driver identity without changing source names or amounts", () => {
  const make = (name: string): DriverTask => ({ id: "1", importId: 1, sheetName: name, driverName: name, section: "海柜", sourceRow: 3, workDate: "2026-09-05", reference: "trailer", nature: "TCY1直送", fromLocation: "SFO", toLocation: "95206", miles: 68, notes: null, rawCells: { G3: 100, H3: 400 } });
  const owner = make("O Don"); const before = JSON.stringify(owner);
  const snapshot = settlementSnapshot("O Don", "2026-09-05", [owner]);
  assert.equal(snapshot.payeeType, "owner"); assert.equal(snapshot.payeeConflict, false); assert.equal(snapshot.tasks[0].payeeType, "owner");
  assert.equal(snapshot.subject, "O Don"); assert.equal(snapshot.tasks[0].rawCells.H3, 400); assert.equal(JSON.stringify(owner), before);
  assert.equal(settlementSnapshot("郭晓光", "2026-09-05", [make("郭晓光")]).payeeType, "driver");
});

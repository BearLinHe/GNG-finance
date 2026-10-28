import assert from "node:assert/strict";
import test from "node:test";
import { parseSavQuery } from "../lib/sav-query";

const query = (value = "") => parseSavQuery(new URLSearchParams(value));

test("SAV default query covers all history and all operations instead of the Excel date window", () => {
  const parsed = query();
  assert.equal(parsed.scope, "all");
  assert.equal(parsed.dateFrom, undefined);
  assert.equal(parsed.dateTo, undefined);
  assert.equal(parsed.operationMode, undefined);
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 100);
});

test("cabinet-only search remains unbounded by pickup dates, including orders with no pickup date", () => {
  const parsed = query("search=OLD-SAV-CABINET&dateFrom=&dateTo=&operationMode=all");
  assert.equal(parsed.search, "OLD-SAV-CABINET");
  assert.equal(parsed.dateFrom, undefined);
  assert.equal(parsed.dateTo, undefined);
  assert.equal(parsed.operationMode, undefined);
});

test("explicit Excel comparison scope keeps supplied dates while all-history queries support long and single-sided ranges", () => {
  const excel = query("scope=excel&dateFrom=2026-09-07&dateTo=2026-10-25");
  assert.equal(excel.scope, "excel");
  assert.equal(excel.dateFrom, "2026-09-07");
  assert.equal(excel.dateTo, "2026-10-25");
  assert.equal(query("dateFrom=2020-01-01&dateTo=2026-10-27").dateFrom, "2020-01-01");
  assert.equal(query("dateFrom=2020-01-01").dateTo, undefined);
  assert.equal(query("dateTo=2026-10-27").dateFrom, undefined);
});

test("server pagination allows later pages and rejects invalid numeric requests instead of silently truncating", () => {
  const parsed = query("page=17&pageSize=300");
  assert.equal(parsed.page, 17);
  assert.equal(parsed.pageSize, 300);
  for (const value of ["0", "-1", "1.5", "NaN", "Infinity", "text"]) {
    assert.throws(() => query(`page=${value}`));
    assert.throws(() => query(`pageSize=${value}`));
  }
  assert.throws(() => query("pageSize=301"));
});

test("date, scope, operation and status validation exposes invalid filters", () => {
  for (const search of [
    "dateFrom=2026-02-30", "dateTo=2026-13-01", "dateFrom=2026-10-28&dateTo=2026-10-27",
    "scope=private", "operationMode=bad%20mode", "status=unrecognized"
  ]) assert.throws(() => query(search));
  assert.equal(query("operationMode=__none__").operationMode, "__none__");
  assert.equal(query("operationMode=direct_delivery").operationMode, "direct_delivery");
  assert.equal(query("status=missing_income").status, "missing_income");
});

import assert from "node:assert/strict";
import test from "node:test";
import { SavRuntimeError, savRuntimeClientError, savRuntimeDiagnostic, savRuntimeError } from "../lib/sav-runtime-error";
import { savApiError, savApiStatus } from "../lib/sav-accounting-service";
import { SavInputError } from "../lib/sav-settings";
import { getSavSourceAccounting, SavSourceInputError } from "../lib/sav-source-db";

const sensitiveMessage = "postgresql://private-user:private-password@private-host/database?token=private-token";
function driverError(code: string) { return Object.assign(new Error(sensitiveMessage), { code, detail: sensitiveMessage }); }

test("missing source configuration produces actionable safe diagnostics and a service-unavailable status", () => {
  const error = new SavRuntimeError("SAV_SOURCE_NOT_CONFIGURED", "source");
  assert.match(savApiError(error).error, /SAV_DATABASE_URL/);
  assert.equal(savApiStatus(error), 503);
  assert.deepEqual(savRuntimeDiagnostic(error), { code: "SAV_SOURCE_NOT_CONFIGURED", stage: "source" });
});

test("a deployment without SAV configuration reaches the actionable error before opening a connection", async () => {
  const keys = ["SAV_DATABASE_URL", "DB_INSTANCES", "CORE_FLOW_ENV_PATH"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    delete process.env.SAV_DATABASE_URL;
    delete process.env.DB_INSTANCES;
    process.env.CORE_FLOW_ENV_PATH = "/__missing_sav_diagnostic_configuration__";
    await assert.rejects(getSavSourceAccounting(), error => error instanceof SavRuntimeError && error.code === "SAV_SOURCE_NOT_CONFIGURED" && savApiStatus(error) === 503);
  } finally {
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
});

test("source driver failures distinguish authentication, permissions, schema and timeout without exposing connection details", () => {
  const cases = [
    ["28P01", "SAV_SOURCE_AUTH_FAILED", 503], ["42501", "SAV_SOURCE_PERMISSION_DENIED", 503],
    ["42P01", "SAV_SOURCE_SCHEMA_MISMATCH", 500], ["42703", "SAV_SOURCE_SCHEMA_MISMATCH", 500],
    ["57014", "SAV_SOURCE_TIMEOUT", 503], ["ECONNREFUSED", "SAV_SOURCE_CONNECTION_FAILED", 503]
  ] as const;
  for (const [code, expected, status] of cases) {
    const error = savRuntimeError("source", driverError(code));
    assert.equal(error.code, expected);
    assert.equal(savApiStatus(error), status);
    const serialized = JSON.stringify({ client: savApiError(error), log: savRuntimeDiagnostic(error), error });
    for (const part of ["private-password", "private-user", "private-host", "private-token", "postgresql://"]) assert.equal(serialized.includes(part), false);
  }
});

test("Finance settings errors remain distinguishable from the SAV source", () => {
  assert.equal(savRuntimeError("settings", new Error("SYSTEM_DATABASE_URL is not configured")).code, "FINANCE_NOT_CONFIGURED");
  assert.equal(savRuntimeError("settings", driverError("42501")).code, "FINANCE_PERMISSION_DENIED");
  assert.equal(savRuntimeError("settings", driverError("42P01")).code, "FINANCE_SCHEMA_MISMATCH");
  assert.equal(savRuntimeError("settings", driverError("57014")).code, "FINANCE_TIMEOUT");
  const error = savRuntimeError("settings", driverError("ECONNRESET"));
  assert.equal(error.code, "FINANCE_CONNECTION_FAILED");
  assert.deepEqual(savRuntimeDiagnostic(error), { code: "FINANCE_CONNECTION_FAILED", stage: "settings" });
});

test("unknown error text is never returned or logged and invalid request status remains 400", () => {
  const unknown = new Error(sensitiveMessage);
  assert.deepEqual(savRuntimeClientError(unknown), { error: "SAV 核算处理失败，请稍后重试。", code: "SAV_ACCOUNTING_FAILED" });
  assert.deepEqual(savRuntimeDiagnostic(unknown), { code: "SAV_ACCOUNTING_FAILED", stage: "accounting" });
  assert.equal(savApiStatus(unknown), 500);
  for (const error of [new SavInputError("日期无效"), new SavSourceInputError("日期无效")]) {
    assert.equal(savApiStatus(error), 400);
    assert.deepEqual(savApiError(error), { error: "日期无效" });
  }
  const maliciousCode = savRuntimeError("source", driverError(sensitiveMessage));
  assert.deepEqual(savRuntimeDiagnostic(maliciousCode), { code: "SAV_SOURCE_CONNECTION_FAILED", stage: "source" });
  assert.deepEqual(savRuntimeDiagnostic(new SavRuntimeError("SAV_SOURCE_CONNECTION_FAILED", "source", 503, sensitiveMessage)), { code: "SAV_SOURCE_CONNECTION_FAILED", stage: "source" });
});

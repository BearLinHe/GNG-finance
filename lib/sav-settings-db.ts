import { withSystemClient } from "./system-db";
import { defaultSavSettings, mergeSavSettings, type SavBaseline, type SavSettings } from "./sav-settings";

let ready: Promise<void> | undefined;
async function ensureSavSchema() {
  ready ??= withSystemClient(async client => {
    await client.query(`create table if not exists sav_accounting_settings (
      id integer primary key check(id=1), payload jsonb not null, updated_at timestamptz not null default now())`);
    await client.query(`create table if not exists sav_accounting_audit (
      id bigserial primary key, action text not null, payload jsonb not null, created_at timestamptz not null default now())`);
    await client.query("insert into sav_accounting_settings(id,payload) values(1,$1::jsonb) on conflict do nothing", [JSON.stringify(defaultSavSettings())]);
  }).catch(error => { ready = undefined; throw error; });
  await ready;
}
export async function readSavSettings(): Promise<SavSettings> {
  await ensureSavSchema();
  return withSystemClient(async client => {
    const result = await client.query("select payload from sav_accounting_settings where id=1");
    return { ...defaultSavSettings(), ...result.rows[0].payload } as SavSettings;
  });
}
async function updateSavSettings(action: string, change: (current: SavSettings) => SavSettings) {
  await ensureSavSchema();
  return withSystemClient(async client => {
    await client.query("begin");
    try {
      const result = await client.query("select payload from sav_accounting_settings where id=1 for update");
      const next = change({ ...defaultSavSettings(), ...result.rows[0].payload } as SavSettings);
      await client.query("update sav_accounting_settings set payload=$1::jsonb,updated_at=now() where id=1", [JSON.stringify(next)]);
      await client.query("insert into sav_accounting_audit(action,payload) values($1,$2::jsonb)", [action, JSON.stringify(next)]);
      await client.query("commit"); return next;
    } catch (error) { await client.query("rollback"); throw error; }
  });
}
export async function saveSavSettings(input: unknown) { return updateSavSettings("核对计价与收入", current => mergeSavSettings(current, input)); }
export async function saveSavBaseline(baseline: SavBaseline) { return updateSavSettings("导入Excel对账基准", current => ({ ...current, baseline })); }

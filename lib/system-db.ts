import { Pool, type PoolClient } from "pg";
import { toNumber } from "./money";

const amountSourceKeys = ["operator", "finance", "warehouse", "transport"] as const;
const amountSourceKeySet = new Set<string>(amountSourceKeys);

export const statusLabels: Record<string, string> = {
  draft: "草稿",
  pending_review: "待审核",
  approved: "已审核",
  rejected: "已退回",
  sent: "已发送客户"
};

export type LocalBill = {
  id: number;
  source_order_id: number;
  container_number: string;
  customer_name: string | null;
  product_type: string | null;
  order_date: string | null;
  pickup_date: string | null;
  return_deadline: string | null;
  operation_mode: string | null;
  container_type: string | null;
  source_invoice_numbers: string | null;
  matched_fee_names: string | null;
  matched_fee_count: number;
  preset_receivable_amount: number;
  source_balance_amount: number;
  operation_bill_amount: number;
  operation_bill_notes: string | null;
  status: string;
  review_notes: string | null;
  sent_to_customer_at: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
};

export type RoleAmountRecord = {
  id: number;
  bill_id: number;
  role_key: string;
  receivable_amount: number;
  expense_amount: number;
  expense_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type FeePrice = {
  id: number;
  source_fee_id: number | null;
  source_origin: string;
  source_standard_id: number | null;
  source_standard_price_id: number | null;
  fee_code: string;
  fee_name: string;
  unit: string | null;
  unit_price: number;
  currency: string;
  scope_type: string;
  customer_name: string | null;
  container_type: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ContainerRoleAmountItem = {
  id: number;
  source_order_id: number;
  container_number: string;
  role_key: string;
  amount_type: "receivable" | "expense";
  expense_category: string | null;
  item_name: string;
  amount: number;
  warehouse_point: string | null;
  vendor_name: string | null;
  expense_date: string | null;
  reference_number: string | null;
  pricing_method: "manual" | "standard";
  standard_amount: number | null;
  pricing_rule_id: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type TransportPricingRule = {
  id: number;
  rule_code: string;
  rule_name: string;
  rule_type: "fixed_route" | "amazon_warehouse";
  warehouse_point: string | null;
  price_group: string | null;
  address: string | null;
  condition_key: string;
  amount: number;
  is_active: boolean;
};

export type WarehousePickupPricingRule = {
  id: number;
  rule_code: string;
  rule_name: string;
  warehouse_point: string;
  price_group: string | null;
  address: string | null;
  amount: number;
  is_temporary: boolean;
  is_active: boolean;
};

export type ExpenseStandard = {
  id: number;
  category: "transport" | "warehouse" | "domestic";
  standard_kind: "fixed" | "monthly";
  standard_name: string;
  amount: number;
  unit: string;
  billing_month: string | null;
  period_start: string | null;
  period_end: string | null;
  vendor_name: string | null;
  application_rule: "per_container" | "monthly_manual" | "monthly_prorated";
  operation_mode: "unload" | "direct_delivery" | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

let pool: Pool | null = null;
let schemaReadyPromise: Promise<void> | null = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.SYSTEM_DATABASE_URL;
    if (!connectionString) {
      throw new Error("SYSTEM_DATABASE_URL is not configured");
    }

    pool = new Pool({
      connectionString,
      max: 6,
      ssl: { rejectUnauthorized: true }
    });
  }

  return pool;
}

export async function withSystemClient<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try {
    await client.query("set statement_timeout = '20s'");
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function ensureSystemSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensureSystemSchemaOnce().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  await schemaReadyPromise;
}

async function ensureSystemSchemaOnce() {
  await withSystemClient(async (client) => {
    await client.query("begin");
    try {
      await client.query(`
        create table if not exists container_bills (
          id bigserial primary key,
          source_order_id bigint not null unique,
          container_number varchar(100) not null,
          customer_name varchar(200),
          product_type varchar(200),
          order_date date,
          pickup_date timestamptz,
          return_deadline date,
          operation_mode varchar(50),
          container_type varchar(50),
          source_invoice_numbers text,
          matched_fee_names text,
          matched_fee_count integer not null default 0,
          preset_receivable_amount numeric(12, 2) not null default 0,
          source_balance_amount numeric(12, 2) not null default 0,
          operation_bill_amount numeric(12, 2) not null default 0,
          operation_bill_notes text,
          status varchar(30) not null default 'draft',
          review_notes text,
          sent_to_customer_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          submitted_at timestamptz,
          reviewed_at timestamptz
        )
      `);
      await client.query("alter table container_bills add column if not exists order_date date");
      await client.query("alter table container_bills add column if not exists pickup_date timestamptz");
      await client.query("alter table container_bills add column if not exists return_deadline date");
      await client.query("alter table container_bills add column if not exists operation_mode varchar(50)");
      await client.query("alter table container_bills add column if not exists container_type varchar(50)");
      await client.query("alter table container_bills add column if not exists matched_fee_names text");
      await client.query("alter table container_bills add column if not exists matched_fee_count integer not null default 0");
      await client.query(`
        create table if not exists role_amount_records (
          id bigserial primary key,
          bill_id bigint not null references container_bills(id) on delete cascade,
          role_key varchar(30) not null,
          receivable_amount numeric(12, 2) not null default 0,
          expense_amount numeric(12, 2) not null default 0,
          expense_reason text,
          notes text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          unique (bill_id, role_key)
        )
      `);
      await client.query(`
        create table if not exists fee_prices (
          id bigserial primary key,
          source_fee_id bigint unique,
          source_origin varchar(30) not null default 'manual',
          source_standard_id bigint,
          source_standard_price_id bigint,
          fee_code varchar(80) not null,
          fee_name varchar(200) not null,
          unit varchar(30),
          unit_price numeric(12, 2) not null default 0,
          currency varchar(10) not null default 'USD',
          scope_type varchar(30) not null default 'all',
          customer_name varchar(200),
          container_type varchar(50),
          effective_date date,
          expiration_date date,
          description text,
          is_active boolean not null default true,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
      await client.query("alter table fee_prices add column if not exists source_origin varchar(30) not null default 'manual'");
      await client.query("alter table fee_prices add column if not exists source_standard_id bigint");
      await client.query("alter table fee_prices add column if not exists source_standard_price_id bigint");
      await client.query("alter table fee_prices add column if not exists effective_date date");
      await client.query("alter table fee_prices add column if not exists expiration_date date");
      await client.query(`
        create table if not exists container_role_amount_items (
          id bigserial primary key,
          source_order_id bigint not null,
          container_number varchar(100) not null,
          role_key varchar(30) not null,
          amount_type varchar(20) not null,
          expense_category varchar(30),
          item_name varchar(200) not null,
          amount numeric(12, 2) not null default 0,
          notes text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
      await client.query("alter table container_role_amount_items add column if not exists expense_category varchar(30)");
      await client.query("alter table container_role_amount_items add column if not exists warehouse_point varchar(120)");
      await client.query("alter table container_role_amount_items add column if not exists vendor_name varchar(200)");
      await client.query("alter table container_role_amount_items add column if not exists expense_date date");
      await client.query("alter table container_role_amount_items add column if not exists reference_number varchar(120)");
      await client.query("alter table container_role_amount_items add column if not exists pricing_method varchar(30) not null default 'manual'");
      await client.query("alter table container_role_amount_items add column if not exists standard_amount numeric(12, 2)");
      await client.query("alter table container_role_amount_items add column if not exists pricing_rule_id bigint");
      await client.query(`
        create table if not exists transport_pricing_rules (
          id bigserial primary key,
          rule_code varchar(120) not null unique,
          rule_name varchar(240) not null,
          rule_type varchar(30) not null,
          warehouse_point varchar(120),
          price_group varchar(50),
          address text,
          condition_key varchar(60) not null default 'manual',
          amount numeric(12, 2) not null,
          is_active boolean not null default true,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
      await client.query("alter table transport_pricing_rules add column if not exists price_group varchar(50)");
      await client.query("alter table transport_pricing_rules add column if not exists address text");
      await client.query("alter table transport_pricing_rules add column if not exists condition_key varchar(60) not null default 'manual'");
      await client.query(`
        create table if not exists warehouse_pickup_pricing_rules (
          id bigserial primary key,
          rule_code varchar(120) not null unique,
          rule_name varchar(240) not null,
          warehouse_point varchar(120) not null,
          price_group varchar(50),
          address text,
          amount numeric(12, 2) not null,
          is_temporary boolean not null default true,
          is_active boolean not null default true,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
      await client.query(`
        create table if not exists expense_standards (
          id bigserial primary key,
          category varchar(30) not null,
          standard_kind varchar(20) not null,
          standard_name varchar(200) not null,
          amount numeric(12, 2) not null default 0,
          unit varchar(40) not null default '柜',
          billing_month date,
          period_start date,
          period_end date,
          vendor_name varchar(200),
          application_rule varchar(40) not null default 'per_container',
          operation_mode varchar(40),
          description text,
          is_active boolean not null default true,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
      await client.query("alter table expense_standards add column if not exists operation_mode varchar(40)");
      await client.query("alter table expense_standards add column if not exists period_start date");
      await client.query("alter table expense_standards add column if not exists period_end date");
      await client.query(`
        insert into expense_standards (
          category, standard_kind, standard_name, amount, unit,
          application_rule, operation_mode, description
        )
        select
          'warehouse', 'fixed', '拆柜工人费', 200, '柜',
          'per_container', 'unload', '拆柜作业每柜默认工人支出'
        where not exists (
          select 1
          from expense_standards
          where category = 'warehouse'
            and standard_kind = 'fixed'
            and standard_name = '拆柜工人费'
            and is_active = true
        )
      `);
      await client.query(`
        insert into expense_standards (
          category, standard_kind, standard_name, amount, unit,
          application_rule, operation_mode, description
        )
        select
          'warehouse', 'monthly', '仓租', 135000, '月',
          'monthly_prorated', 'unload', '每月 $150,000 × 0.9，按当月拆柜日期的拆柜柜数平均分摊'
        where not exists (
          select 1
          from expense_standards
          where category = 'warehouse'
            and standard_kind = 'monthly'
            and standard_name = '仓租'
            and application_rule = 'monthly_prorated'
            and is_active = true
        )
      `);
      await client.query(`
        insert into transport_pricing_rules (rule_code, rule_name, rule_type, warehouse_point, amount, condition_key)
        values
          ('OAK_TERMINAL_PICKUP', '奥克兰码头提柜', 'fixed_route', '奥克兰码头', 60, 'pickup_out'),
          ('OAK_TERMINAL_RETURN_EMPTY', '奥克兰码头还空', 'fixed_route', '奥克兰码头', 60, 'return_empty'),
          ('OAK_TO_HAYWARD', '奥克兰码头送 Hayward 仓库', 'fixed_route', 'Hayward', 100, 'unload_pickup_out'),
          ('HAYWARD_TO_OAK', 'Hayward 仓库回奥克兰码头', 'fixed_route', 'Hayward', 100, 'unload_return_empty')
        on conflict (rule_code) do update
        set rule_name = excluded.rule_name,
            rule_type = excluded.rule_type,
            warehouse_point = excluded.warehouse_point,
            amount = excluded.amount,
            condition_key = excluded.condition_key,
            is_active = true,
            updated_at = now()
      `);
      await client.query(`
        insert into transport_pricing_rules (
          rule_code, rule_name, rule_type, warehouse_point, price_group, address, amount, condition_key
        ) values
          ('AMAZON_SJC7', '送亚马逊仓库 SJC7', 'amazon_warehouse', 'SJC7', 'A类', '188 Mountain House Pkwy, Tracy, CA 95391', 360, 'amazon_delivery'),
          ('AMAZON_SMF3', '送亚马逊仓库 SMF3', 'amazon_warehouse', 'SMF3', 'B类', '3923 S B St, Stockton, CA 95206, USA', 400, 'amazon_delivery'),
          ('AMAZON_SCK4', '送亚马逊仓库 SCK4', 'amazon_warehouse', 'SCK4', 'B类', '6001 S Austin Rd, Stockton, CA 95215, USA', 400, 'amazon_delivery'),
          ('AMAZON_SCK1', '送亚马逊仓库 SCK1', 'amazon_warehouse', 'SCK1', 'B类', '4532 Newcastle Rd, Stockton, CA 95215', 400, 'amazon_delivery'),
          ('AMAZON_TCY1', '送亚马逊仓库 TCY1', 'amazon_warehouse', 'TCY1', 'B类', '2690 Arch Airport Rd, Stockton, CA 95206', 400, 'amazon_delivery'),
          ('AMAZON_TCY2', '送亚马逊仓库 TCY2', 'amazon_warehouse', 'TCY2', 'B类', '6201 Newcastle Rd, Stockton, CA 95215', 400, 'amazon_delivery'),
          ('AMAZON_QXY5', '送亚马逊仓库 QXY5', 'amazon_warehouse', 'QXY5', 'B类', '4532 Newcastle Rd, Stockton, CA 95215, USA', 400, 'amazon_delivery'),
          ('AMAZON_OAK3', '送亚马逊仓库 OAK3', 'amazon_warehouse', 'OAK3', 'C类', '255 Park Center Drive, Patterson, CA 95363, USA', 400, 'amazon_delivery'),
          ('AMAZON_SCK3', '送亚马逊仓库 SCK3', 'amazon_warehouse', 'SCK3', 'C类', '3565 Airport Way, Manteca, CA 95336', 400, 'amazon_delivery'),
          ('AMAZON_SMF7', '送亚马逊仓库 SMF7', 'amazon_warehouse', 'SMF7', 'C类', '4800 Midday Road, Vacaville, CA 95688, USA', 400, 'amazon_delivery'),
          ('AMAZON_SCK8', '送亚马逊仓库 SCK8', 'amazon_warehouse', 'SCK8', 'C类', '4700 Wilbur Ave, Oakley, CA 94561-2677, USA', 400, 'amazon_delivery'),
          ('AMAZON_SMF6', '送亚马逊仓库 SMF6', 'amazon_warehouse', 'SMF6', 'D类', '4930 Albaugh Drive, Sacramento, CA 95837', 520, 'amazon_delivery'),
          ('AMAZON_MCC1', '送亚马逊仓库 MCC1', 'amazon_warehouse', 'MCC1', 'D类', '3500 Rancho Cordova Pkwy, Rancho Cordova, CA 95742', 520, 'amazon_delivery'),
          ('AMAZON_WALMART_SMF1N', '送仓 Walmart-SMF1N', 'amazon_warehouse', 'Walmart-SMF1N', 'D类', '7000 Powerline Rd, Sacramento, CA 95837', 480, 'amazon_delivery'),
          ('AMAZON_HLI2', '送亚马逊仓库 HLI2', 'amazon_warehouse', 'HLI2', 'E类', '600 Ernie Dr, Hollister, CA 95023', 440, 'amazon_delivery'),
          ('AMAZON_MCE1', '送亚马逊仓库 MCE1', 'amazon_warehouse', 'MCE1', 'E类', '3200 Fulkerth Road, Turlock, CA 95380, USA', 460, 'amazon_delivery'),
          ('AMAZON_FAT2', '送亚马逊仓库 FAT2', 'amazon_warehouse', 'FAT2', 'E类', '3315 N Kelsey St, Visalia, CA 93291', 760, 'amazon_delivery'),
          ('AMAZON_RNO4', '送亚马逊仓库 RNO4', 'amazon_warehouse', 'RNO4', 'E类', '8000 N Virginia St, Reno, NV 89506', 920, 'amazon_delivery'),
          ('AMAZON_MIT2', '送亚马逊仓库 MIT2', 'amazon_warehouse', 'MIT2', 'E类', '5408 Express Avenue, Shafter, CA 93263, USA', 880, 'amazon_delivery'),
          ('AMAZON_GEG2', '送亚马逊仓库 GEG2', 'amazon_warehouse', 'GEG2', 'F类', null, 3500, 'amazon_delivery'),
          ('AMAZON_BFI3', '送亚马逊仓库 BFI3', 'amazon_warehouse', 'BFI3', 'F类', null, 3000, 'amazon_delivery'),
          ('AMAZON_IWA6', '送亚马逊仓库 IWA6', 'amazon_warehouse', 'IWA6', 'F类', null, 3000, 'amazon_delivery'),
          ('AMAZON_PSC2', '送亚马逊仓库 PSC2', 'amazon_warehouse', 'PSC2', 'F类', null, 3000, 'amazon_delivery'),
          ('AMAZON_OLM1', '送亚马逊仓库 OLM1', 'amazon_warehouse', 'OLM1', 'F类', null, 2960, 'amazon_delivery'),
          ('AMAZON_PDX7', '送亚马逊仓库 PDX7', 'amazon_warehouse', 'PDX7', 'F类', null, 2480, 'amazon_delivery')
        on conflict (rule_code) do update
        set rule_name = excluded.rule_name,
            rule_type = excluded.rule_type,
            warehouse_point = excluded.warehouse_point,
            price_group = excluded.price_group,
            address = excluded.address,
            amount = excluded.amount,
            condition_key = excluded.condition_key,
            is_active = true,
            updated_at = now()
      `);
      await client.query(`
        insert into warehouse_pickup_pricing_rules (
          rule_code, rule_name, warehouse_point, price_group, address, amount, is_temporary
        )
        select
          'AMAZON_PICKUP_' || upper(regexp_replace(warehouse_point, '[^A-Za-z0-9]+', '_', 'g')),
          '亚马逊自提 ' || warehouse_point,
          warehouse_point,
          price_group,
          address,
          amount + 50,
          true
        from transport_pricing_rules
        where rule_type = 'amazon_warehouse'
          and is_active = true
          and warehouse_point is not null
        on conflict (rule_code) do nothing
      `);
      await client.query("create index if not exists idx_container_bills_status on container_bills(status)");
      await client.query("create index if not exists idx_container_bills_container_number on container_bills(container_number)");
      await client.query("create index if not exists idx_container_bills_operation_mode on container_bills(operation_mode)");
      await client.query("create index if not exists idx_container_bills_order_date on container_bills(order_date)");
      await client.query("create index if not exists idx_role_amount_records_bill on role_amount_records(bill_id)");
      await client.query("create index if not exists idx_fee_prices_active on fee_prices(is_active)");
      await client.query("create index if not exists idx_fee_prices_code on fee_prices(fee_code)");
      await client.query("create index if not exists idx_fee_prices_scope on fee_prices(scope_type)");
      await client.query("create index if not exists idx_fee_prices_source_origin on fee_prices(source_origin)");
      await client.query("create unique index if not exists idx_fee_prices_source_standard_price on fee_prices(source_standard_price_id) where source_standard_price_id is not null");
      await client.query("create index if not exists idx_container_role_amount_items_order on container_role_amount_items(source_order_id)");
      await client.query("create index if not exists idx_container_role_amount_items_container on container_role_amount_items(container_number)");
      await client.query("create index if not exists idx_container_role_amount_items_role on container_role_amount_items(role_key)");
      await client.query("create index if not exists idx_container_role_amount_items_category on container_role_amount_items(expense_category)");
      await client.query("create index if not exists idx_container_role_amount_items_expense_date on container_role_amount_items(expense_date)");
      await client.query("create index if not exists idx_transport_pricing_rules_type on transport_pricing_rules(rule_type)");
      await client.query("create index if not exists idx_transport_pricing_rules_warehouse on transport_pricing_rules(warehouse_point)");
      await client.query("create index if not exists idx_warehouse_pickup_pricing_warehouse on warehouse_pickup_pricing_rules(warehouse_point)");
      await client.query("create index if not exists idx_expense_standards_category_kind on expense_standards(category, standard_kind)");
      await client.query("create index if not exists idx_expense_standards_month on expense_standards(billing_month)");
      await client.query(`
        create table if not exists oak_driver_imports (
          id bigserial primary key,
          file_hash varchar(64) not null unique,
          file_name varchar(255) not null,
          created_at timestamptz not null default now()
        )
      `);
      await client.query("alter table oak_driver_imports add column if not exists period_from date");
      await client.query("alter table oak_driver_imports add column if not exists period_to date");
      await client.query(`
        create table if not exists oak_driver_tasks (
          id bigserial primary key,
          import_id bigint not null references oak_driver_imports(id) on delete cascade,
          sheet_name varchar(120) not null,
          section varchar(30) not null,
          source_row integer not null,
          driver_name varchar(120) not null,
          work_date date not null,
          reference text,
          nature text,
          from_location text,
          to_location text,
          miles numeric(12, 2),
          notes text,
          raw_cells jsonb not null default '{}'::jsonb,
          unique (import_id, sheet_name, section, source_row)
        )
      `);
      await client.query("create index if not exists idx_oak_driver_tasks_date_driver on oak_driver_tasks(work_date, driver_name)");
      await client.query("create index if not exists idx_oak_driver_tasks_import on oak_driver_tasks(import_id)");
      await client.query("alter table oak_driver_tasks add column if not exists payee_type varchar(20) check(payee_type in ('driver','owner'))");
      await client.query(`
        create table if not exists oak_income_rules (
          id bigserial primary key,
          name varchar(120) not null,
          work_label varchar(120) not null,
          from_location varchar(100), to_location varchar(100),
          amount numeric(12, 2) not null check (amount >= 0),
          billing_basis varchar(20) not null check (billing_basis in ('segment', 'trip')),
          valid_from date, valid_to date,
          active boolean not null default true,
          updated_at timestamptz not null default now(),
          check (valid_from is null or valid_to is null or valid_from <= valid_to)
        )
      `);
      await client.query(`
        create table if not exists oak_task_income_reviews (
          task_id bigint primary key references oak_driver_tasks(id) on delete cascade,
          mode varchar(20) not null check (mode in ('label', 'manual', 'included')),
          work_label varchar(120), amount numeric(12, 2) check (amount >= 0),
          included_task_id bigint references oak_driver_tasks(id) on delete cascade,
          note varchar(1000) not null default '',
          updated_at timestamptz not null default now(),
          check ((mode = 'manual' and amount is not null and included_task_id is null)
            or (mode = 'included' and amount is null and included_task_id is not null and included_task_id <> task_id)
            or (mode = 'label' and work_label is not null and amount is null and included_task_id is null))
        )
      `);
      await client.query("create index if not exists idx_oak_income_reviews_anchor on oak_task_income_reviews(included_task_id)");
      await client.query(`create table if not exists oak_weekly_settlements (
        id bigserial primary key, subject varchar(120) not null, week_start date not null, week_end date not null,
        payee_name varchar(150) not null, payee_type varchar(20) not null check(payee_type in ('driver','owner')),
        base_amount numeric(12,2) not null check(base_amount >= 0), adjustments jsonb not null default '[]',
        total_amount numeric(12,2) not null check(total_amount >= 0), note varchar(1000) not null,
        status varchar(20) not null default 'draft' check(status in ('draft','confirmed')),
        snapshot jsonb not null, source_hash varchar(64) not null, confirmed_at timestamptz,
        updated_at timestamptz not null default now(), unique(subject,week_start),
        check(extract(dow from week_start)=6 and week_end=week_start+6)
      )`);
      await client.query(`create table if not exists oak_settlement_tasks (
        settlement_id bigint not null references oak_weekly_settlements(id) on delete cascade,
        task_id bigint not null unique references oak_driver_tasks(id) on delete restrict,
        primary key(settlement_id,task_id)
      )`);
      await client.query(`create table if not exists oak_settlement_payments (
        id bigserial primary key, settlement_id bigint not null references oak_weekly_settlements(id) on delete restrict,
        amount numeric(12,2) not null check(amount>0), payment_date date not null, reference varchar(200) not null,
        note varchar(1000) not null default '', voided_at timestamptz, void_reason varchar(1000),
        created_at timestamptz not null default now()
      )`);
      await client.query("create index if not exists idx_oak_settlement_payments_parent on oak_settlement_payments(settlement_id)");
      await client.query(`create table if not exists oak_workflow_audit (
        id bigserial primary key, entity_kind varchar(30) not null, entity_id bigint not null,
        event varchar(60) not null, details jsonb not null default '{}', created_at timestamptz not null default now()
      )`);
      await client.query("create index if not exists idx_oak_workflow_audit_entity on oak_workflow_audit(entity_kind,entity_id,id)");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

function normalizeBill(row: Record<string, unknown>): LocalBill {
  const dateString = (value: unknown) => {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
  };

  return {
    id: Number(row.id),
    source_order_id: Number(row.source_order_id),
    container_number: String(row.container_number),
    customer_name: row.customer_name ? String(row.customer_name) : null,
    product_type: row.product_type ? String(row.product_type) : null,
    order_date: dateString(row.order_date),
    pickup_date: dateString(row.pickup_date),
    return_deadline: dateString(row.return_deadline),
    operation_mode: row.operation_mode ? String(row.operation_mode) : null,
    container_type: row.container_type ? String(row.container_type) : null,
    source_invoice_numbers: row.source_invoice_numbers ? String(row.source_invoice_numbers) : null,
    matched_fee_names: row.matched_fee_names ? String(row.matched_fee_names) : null,
    matched_fee_count: Number(row.matched_fee_count || 0),
    preset_receivable_amount: toNumber(row.preset_receivable_amount),
    source_balance_amount: toNumber(row.source_balance_amount),
    operation_bill_amount: toNumber(row.operation_bill_amount),
    operation_bill_notes: row.operation_bill_notes ? String(row.operation_bill_notes) : null,
    status: String(row.status),
    review_notes: row.review_notes ? String(row.review_notes) : null,
    sent_to_customer_at: dateString(row.sent_to_customer_at),
    created_at: dateString(row.created_at) || "",
    updated_at: dateString(row.updated_at) || "",
    submitted_at: dateString(row.submitted_at),
    reviewed_at: dateString(row.reviewed_at)
  };
}

function normalizeRecord(row: Record<string, unknown>): RoleAmountRecord {
  const dateString = (value: unknown) => {
    if (!value) return "";
    if (value instanceof Date) return value.toISOString();
    return String(value);
  };

  return {
    id: Number(row.id),
    bill_id: Number(row.bill_id),
    role_key: String(row.role_key),
    receivable_amount: toNumber(row.receivable_amount),
    expense_amount: toNumber(row.expense_amount),
    expense_reason: row.expense_reason ? String(row.expense_reason) : null,
    notes: row.notes ? String(row.notes) : null,
    created_at: dateString(row.created_at),
    updated_at: dateString(row.updated_at)
  };
}

function normalizeFeePrice(row: Record<string, unknown>): FeePrice {
  const dateString = (value: unknown) => {
    if (!value) return "";
    if (value instanceof Date) return value.toISOString();
    return String(value);
  };

  return {
    id: Number(row.id),
    source_fee_id: row.source_fee_id == null ? null : Number(row.source_fee_id),
    source_origin: String(row.source_origin || (row.source_fee_id == null ? "manual" : "legacy_fee")),
    source_standard_id: row.source_standard_id == null ? null : Number(row.source_standard_id),
    source_standard_price_id: row.source_standard_price_id == null ? null : Number(row.source_standard_price_id),
    fee_code: String(row.fee_code),
    fee_name: String(row.fee_name),
    unit: row.unit ? String(row.unit) : null,
    unit_price: toNumber(row.unit_price),
    currency: String(row.currency || "USD"),
    scope_type: String(row.scope_type || "all"),
    customer_name: row.customer_name ? String(row.customer_name) : null,
    container_type: row.container_type ? String(row.container_type) : null,
    effective_date: row.effective_date ? dateString(row.effective_date).slice(0, 10) : null,
    expiration_date: row.expiration_date ? dateString(row.expiration_date).slice(0, 10) : null,
    description: row.description ? String(row.description) : null,
    is_active: Boolean(row.is_active),
    created_at: dateString(row.created_at),
    updated_at: dateString(row.updated_at)
  };
}

function normalizeContainerAmountItem(row: Record<string, unknown>): ContainerRoleAmountItem {
  const dateString = (value: unknown) => {
    if (!value) return "";
    if (value instanceof Date) return value.toISOString();
    return String(value);
  };

  return {
    id: Number(row.id),
    source_order_id: Number(row.source_order_id),
    container_number: String(row.container_number),
    role_key: String(row.role_key),
    amount_type: String(row.amount_type) === "expense" ? "expense" : "receivable",
    expense_category: row.expense_category ? String(row.expense_category) : null,
    item_name: String(row.item_name),
    amount: toNumber(row.amount),
    warehouse_point: row.warehouse_point ? String(row.warehouse_point) : null,
    vendor_name: row.vendor_name ? String(row.vendor_name) : null,
    expense_date: row.expense_date ? dateString(row.expense_date).slice(0, 10) : null,
    reference_number: row.reference_number ? String(row.reference_number) : null,
    pricing_method: String(row.pricing_method) === "standard" ? "standard" : "manual",
    standard_amount: row.standard_amount == null ? null : toNumber(row.standard_amount),
    pricing_rule_id: row.pricing_rule_id == null ? null : Number(row.pricing_rule_id),
    notes: row.notes ? String(row.notes) : null,
    created_at: dateString(row.created_at),
    updated_at: dateString(row.updated_at)
  };
}

export async function listBills(filters: { search?: string; status?: string }) {
  await ensureSystemSchema();
  return withSystemClient(async (client) => {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters.search?.trim()) {
      params.push(`%${filters.search.trim()}%`);
      clauses.push(`(container_number ilike $${params.length} or customer_name ilike $${params.length} or source_invoice_numbers ilike $${params.length})`);
    }

    if (filters.status?.trim()) {
      params.push(filters.status.trim());
      clauses.push(`status = $${params.length}`);
    }

    const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
    const result = await client.query(`
      select *
      from container_bills
      ${where}
      order by updated_at desc, id desc
      limit 300
    `, params);

    return result.rows.map(normalizeBill);
  });
}

export async function getBill(id: number) {
  await ensureSystemSchema();
  return withSystemClient(async (client) => getBillWithClient(client, id));
}

async function getBillWithClient(client: PoolClient, id: number) {
  const billResult = await client.query("select * from container_bills where id = $1", [id]);
  if (!billResult.rows[0]) {
    return null;
  }

  const recordsResult = await client.query(
    `
      select *
      from role_amount_records
      where bill_id = $1
      order by case role_key
        when 'operator' then 1
        when 'finance' then 2
        when 'warehouse' then 3
        when 'transport' then 4
        else 5
      end
    `,
    [id]
  );

  return {
    bill: normalizeBill(billResult.rows[0]),
    records: recordsResult.rows.map(normalizeRecord)
  };
}

export async function getBillsBySourceOrderIds(sourceOrderIds: number[]) {
  await ensureSystemSchema();
  if (!sourceOrderIds.length) {
    return new Map<number, LocalBill>();
  }

  return withSystemClient(async (client) => {
    const result = await client.query(
      "select * from container_bills where source_order_id = any($1::bigint[])",
      [sourceOrderIds]
    );
    return new Map(result.rows.map((row) => {
      const bill = normalizeBill(row);
      return [bill.source_order_id, bill] as const;
    }));
  });
}

export async function upsertBillFromSource(source: {
  sourceOrderId: number;
  containerNumber: string;
  customerName: string | null;
  productType: string | null;
  orderDate?: string | null;
  pickupDate?: string | null;
  returnDeadline?: string | null;
  operationMode?: string | null;
  containerType?: string | null;
  presetReceivableAmount: number;
  sourceBalanceAmount: number;
  invoiceNumbers: string | null;
  matchedFeeNames?: string | null;
  matchedFeeCount?: number;
}) {
  await ensureSystemSchema();
  return withSystemClient(async (client) => {
    await client.query("begin");
    try {
      const presetAmount = toNumber(source.presetReceivableAmount);
      const upsertResult = await client.query(`
        insert into container_bills (
          source_order_id,
          container_number,
          customer_name,
          product_type,
          order_date,
          pickup_date,
          return_deadline,
          operation_mode,
          container_type,
          source_invoice_numbers,
          matched_fee_names,
          matched_fee_count,
          preset_receivable_amount,
          source_balance_amount,
          operation_bill_amount,
          status,
          updated_at
        )
        values ($1, $2, $3, $4, $5::date, $6::timestamptz, $7::date, $8, $9, $10, $11, $12, $13, $14, $13, 'draft', now())
        on conflict(source_order_id) do update set
          container_number = excluded.container_number,
          customer_name = excluded.customer_name,
          product_type = excluded.product_type,
          order_date = excluded.order_date,
          pickup_date = excluded.pickup_date,
          return_deadline = excluded.return_deadline,
          operation_mode = excluded.operation_mode,
          container_type = excluded.container_type,
          source_invoice_numbers = excluded.source_invoice_numbers,
          matched_fee_names = excluded.matched_fee_names,
          matched_fee_count = excluded.matched_fee_count,
          preset_receivable_amount = excluded.preset_receivable_amount,
          source_balance_amount = excluded.source_balance_amount,
          operation_bill_amount = case
            when container_bills.status in ('draft', 'rejected')
              and container_bills.operation_bill_amount = container_bills.preset_receivable_amount
            then excluded.preset_receivable_amount
            else container_bills.operation_bill_amount
          end,
          updated_at = now()
        returning *
      `, [
        source.sourceOrderId,
        source.containerNumber,
        source.customerName,
        source.productType,
        source.orderDate || null,
        source.pickupDate || null,
        source.returnDeadline || null,
        source.operationMode || null,
        source.containerType || null,
        source.invoiceNumbers,
        source.matchedFeeNames || null,
        source.matchedFeeCount || 0,
        presetAmount,
        toNumber(source.sourceBalanceAmount)
      ]);

      const bill = normalizeBill(upsertResult.rows[0]);
      for (const amountSourceKey of amountSourceKeys) {
        await client.query(`
          insert into role_amount_records (bill_id, role_key, receivable_amount, expense_amount)
          values ($1, $2, 0, 0)
          on conflict(bill_id, role_key) do nothing
        `, [bill.id, amountSourceKey]);
      }

      await client.query("commit");
      return bill;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

export async function listSystemFees(filters: {
  search?: string;
  scopeType?: string;
  active?: string;
  page?: number;
  pageSize?: number;
}) {
  await ensureSystemSchema();
  return withSystemClient(async (client) => {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const pageSize = Math.min(Math.max(filters.pageSize || 50, 10), 200);
    const page = Math.max(filters.page || 1, 1);
    const offset = (page - 1) * pageSize;

    if (filters.search?.trim()) {
      params.push(`%${filters.search.trim()}%`);
      clauses.push(`(fee_code ilike $${params.length} or fee_name ilike $${params.length} or coalesce(customer_name, '') ilike $${params.length} or coalesce(container_type, '') ilike $${params.length})`);
    }

    if (filters.scopeType?.trim()) {
      params.push(filters.scopeType.trim());
      clauses.push(`scope_type = $${params.length}`);
    }

    if (filters.active === "true" || filters.active === "false") {
      params.push(filters.active === "true");
      clauses.push(`is_active = $${params.length}`);
    }

    const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
    params.push(pageSize);
    const limitIndex = params.length;
    params.push(offset);
    const offsetIndex = params.length;
    const result = await client.query(`
      select *, count(*) over()::int as total_count
      from fee_prices
      ${where}
      order by is_active desc, container_type nulls last, fee_code, fee_name, customer_name nulls last
      limit $${limitIndex}
      offset $${offsetIndex}
    `, params);

    return {
      fees: result.rows.map(normalizeFeePrice),
      totalCount: Number(result.rows[0]?.total_count || 0)
    };
  });
}

export async function getSystemFeesBySourceIds(sourceFeeIds: number[]) {
  await ensureSystemSchema();
  if (!sourceFeeIds.length) {
    return new Map<number, FeePrice>();
  }

  return withSystemClient(async (client) => {
    const result = await client.query(
      "select * from fee_prices where source_fee_id = any($1::bigint[])",
      [sourceFeeIds]
    );
    return new Map(result.rows.map((row) => {
      const fee = normalizeFeePrice(row);
      return [fee.source_fee_id || 0, fee] as const;
    }));
  });
}

export async function getSystemFeesBySourceStandardPriceIds(sourceStandardPriceIds: number[]) {
  await ensureSystemSchema();
  if (!sourceStandardPriceIds.length) {
    return new Map<number, FeePrice>();
  }

  return withSystemClient(async (client) => {
    const result = await client.query(
      "select * from fee_prices where source_standard_price_id = any($1::bigint[])",
      [sourceStandardPriceIds]
    );
    return new Map(result.rows.map((row) => {
      const fee = normalizeFeePrice(row);
      return [fee.source_standard_price_id || 0, fee] as const;
    }));
  });
}

export async function listCandidateSystemFeesByNames(productNames: string[]) {
  await ensureSystemSchema();
  const normalizedNames = Array.from(
    new Set(productNames.map((name) => name.trim().toLowerCase()).filter(Boolean))
  );

  if (!normalizedNames.length) {
    return [];
  }

  return withSystemClient(async (client) => {
    const result = await client.query(
      `
        select *
        from fee_prices
        where is_active = true
          and lower(fee_name) = any($1::text[])
        order by
          case when lower(fee_code) = 'all in' then 0 else 1 end,
          scope_type desc,
          customer_name nulls last,
          container_type nulls last,
          id desc
      `,
      [normalizedNames]
    );

    return result.rows.map(normalizeFeePrice);
  });
}

export async function saveSystemFee(params: {
  id?: number | null;
  sourceFeeId?: number | null;
  sourceOrigin?: string | null;
  sourceStandardId?: number | null;
  sourceStandardPriceId?: number | null;
  feeCode: string;
  feeName: string;
  unit?: string | null;
  unitPrice: number;
  currency?: string | null;
  scopeType: string;
  customerName?: string | null;
  containerType?: string | null;
  effectiveDate?: string | null;
  expirationDate?: string | null;
  description?: string | null;
  isActive: boolean;
}) {
  const feeCode = params.feeCode.trim();
  const feeName = params.feeName.trim();

  if (!feeCode) {
    throw new Error("费用编码不能为空");
  }
  if (!feeName) {
    throw new Error("费用名称不能为空");
  }

  await ensureSystemSchema();
  return withSystemClient(async (client) => {
    let id = params.id || null;

    if (!id && params.sourceStandardPriceId) {
      const existing = await client.query(
        "select id from fee_prices where source_standard_price_id = $1 limit 1",
        [params.sourceStandardPriceId]
      );
      id = existing.rows[0]?.id ? Number(existing.rows[0].id) : null;
    }

    if (!id && params.sourceFeeId) {
      const existing = await client.query(
        "select id from fee_prices where source_fee_id = $1 limit 1",
        [params.sourceFeeId]
      );
      id = existing.rows[0]?.id ? Number(existing.rows[0].id) : null;
    }

    const sourceOrigin =
      params.sourceOrigin?.trim()
      || (params.sourceStandardPriceId ? "standard_price" : params.sourceFeeId ? "legacy_fee" : "manual");

    if (id) {
      const result = await client.query(`
        update fee_prices
        set source_fee_id = $1,
            source_origin = $2,
            source_standard_id = $3,
            source_standard_price_id = $4,
            fee_code = $5,
            fee_name = $6,
            unit = $7,
            unit_price = $8,
            currency = $9,
            scope_type = $10,
            customer_name = $11,
            container_type = $12,
            effective_date = $13,
            expiration_date = $14,
            description = $15,
            is_active = $16,
            updated_at = now()
        where id = $17
        returning *
      `, [
        params.sourceFeeId || null,
        sourceOrigin,
        params.sourceStandardId || null,
        params.sourceStandardPriceId || null,
        feeCode,
        feeName,
        params.unit?.trim() || null,
        toNumber(params.unitPrice),
        params.currency?.trim() || "USD",
        params.scopeType?.trim() || "all",
        params.customerName?.trim() || null,
        params.containerType?.trim() || null,
        params.effectiveDate?.trim() || null,
        params.expirationDate?.trim() || null,
        params.description?.trim() || null,
        params.isActive,
        id
      ]);

      if (!result.rows[0]) {
        throw new Error("费用不存在");
      }

      return normalizeFeePrice(result.rows[0]);
    }

    const result = await client.query(`
      insert into fee_prices (
        source_fee_id,
        source_origin,
        source_standard_id,
        source_standard_price_id,
        fee_code,
        fee_name,
        unit,
        unit_price,
        currency,
        scope_type,
        customer_name,
        container_type,
        effective_date,
        expiration_date,
        description,
        is_active
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      returning *
    `, [
      params.sourceFeeId || null,
      sourceOrigin,
      params.sourceStandardId || null,
      params.sourceStandardPriceId || null,
      feeCode,
      feeName,
      params.unit?.trim() || null,
      toNumber(params.unitPrice),
      params.currency?.trim() || "USD",
      params.scopeType?.trim() || "all",
      params.customerName?.trim() || null,
      params.containerType?.trim() || null,
      params.effectiveDate?.trim() || null,
      params.expirationDate?.trim() || null,
      params.description?.trim() || null,
      params.isActive
    ]);

    return normalizeFeePrice(result.rows[0]);
  });
}

export async function updateOperationBill(params: {
  id: number;
  amount: number;
  notes?: string | null;
}) {
  await ensureSystemSchema();
  return withSystemClient(async (client) => {
    await client.query(`
      update container_bills
      set operation_bill_amount = $1,
          operation_bill_notes = $2,
          updated_at = now()
      where id = $3 and status in ('draft', 'rejected')
    `, [toNumber(params.amount), params.notes || null, params.id]);
    return getBillWithClient(client, params.id);
  });
}

export async function changeBillStatus(params: {
  id: number;
  status: "pending_review" | "approved" | "rejected" | "sent";
  reviewNotes?: string | null;
}) {
  await ensureSystemSchema();
  return withSystemClient(async (client) => {
    await client.query("begin");
    try {
      const currentResult = await client.query("select * from container_bills where id = $1 for update", [params.id]);
      const current = currentResult.rows[0] ? normalizeBill(currentResult.rows[0]) : null;
      if (!current) {
        throw new Error("账单不存在");
      }

      if (params.status === "pending_review" && !["draft", "rejected"].includes(current.status)) {
        throw new Error("只有草稿或退回账单可以提交审核");
      }
      if (["approved", "rejected"].includes(params.status) && current.status !== "pending_review") {
        throw new Error("只有待审核账单可以会计审核");
      }
      if (params.status === "sent" && current.status !== "approved") {
        throw new Error("只有已审核账单可以发送客户");
      }

      await client.query(`
        update container_bills
        set status = $1,
            review_notes = coalesce($2, review_notes),
            submitted_at = case when $1 = 'pending_review' then now() else submitted_at end,
            reviewed_at = case when $1 in ('approved', 'rejected') then now() else reviewed_at end,
            sent_to_customer_at = case when $1 = 'sent' then now() else sent_to_customer_at end,
            updated_at = now()
        where id = $3
      `, [params.status, params.reviewNotes || null, params.id]);

      const updated = await getBillWithClient(client, params.id);
      await client.query("commit");
      return updated;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

export async function listContainerAmountItems(sourceOrderId: number) {
  await ensureSystemSchema();
  return withSystemClient(async (client) => {
    const result = await client.query(
      `
        select *
        from container_role_amount_items
        where source_order_id = $1
        order by case role_key
          when 'operator' then 1
          when 'finance' then 2
          when 'warehouse' then 3
          when 'transport' then 4
          else 5
        end,
        case amount_type when 'receivable' then 1 else 2 end,
        id asc
      `,
      [sourceOrderId]
    );

    return result.rows.map(normalizeContainerAmountItem);
  });
}

export async function saveContainerAmountItem(params: {
  id?: number | null;
  sourceOrderId: number;
  containerNumber: string;
  amountSourceKey: string;
  amountType: "receivable" | "expense";
  expenseCategory?: string | null;
  itemName: string;
  amount: number;
  warehousePoint?: string | null;
  vendorName?: string | null;
  expenseDate?: string | null;
  referenceNumber?: string | null;
  pricingMethod?: "manual" | "standard";
  standardAmount?: number | null;
  pricingRuleId?: number | null;
  notes?: string | null;
}) {
  if (!amountSourceKeySet.has(params.amountSourceKey)) {
    throw new Error("未知金额来源");
  }
  if (!["receivable", "expense"].includes(params.amountType)) {
    throw new Error("金额类型无效");
  }
  if (
    params.expenseCategory &&
    !["transport", "warehouse", "domestic", "other"].includes(params.expenseCategory)
  ) {
    throw new Error("支出分类无效");
  }
  if (!params.itemName.trim()) {
    throw new Error("金额名目不能为空");
  }

  await ensureSystemSchema();
  return withSystemClient(async (client) => {
    if (params.id) {
      const result = await client.query(
        `
          update container_role_amount_items
          set role_key = $1,
              amount_type = $2,
              expense_category = $3,
              item_name = $4,
              amount = $5,
              notes = $6,
              warehouse_point = case when $15 then $9 else warehouse_point end,
              vendor_name = case when $16 then $10 else vendor_name end,
              expense_date = case when $17 then $11 else expense_date end,
              reference_number = case when $18 then $12 else reference_number end,
              pricing_method = case when $19 then $13 else pricing_method end,
              standard_amount = case when $20 then $14 else standard_amount end,
              pricing_rule_id = case when $22 then $21 else pricing_rule_id end,
              updated_at = now()
          where id = $7 and source_order_id = $8
          returning *
        `,
        [
          params.amountSourceKey,
          params.amountType,
          params.expenseCategory || null,
          params.itemName.trim(),
          toNumber(params.amount),
          params.notes?.trim() || null,
          params.id,
          params.sourceOrderId,
          params.warehousePoint?.trim() || null,
          params.vendorName?.trim() || null,
          params.expenseDate || null,
          params.referenceNumber?.trim() || null,
          params.pricingMethod === "standard" ? "standard" : "manual",
          params.standardAmount == null ? null : toNumber(params.standardAmount),
          params.warehousePoint !== undefined,
          params.vendorName !== undefined,
          params.expenseDate !== undefined,
          params.referenceNumber !== undefined,
          params.pricingMethod !== undefined,
          params.standardAmount !== undefined,
          params.pricingRuleId == null ? null : Number(params.pricingRuleId),
          params.pricingRuleId !== undefined
        ]
      );

      if (!result.rows[0]) {
        throw new Error("金额明细不存在");
      }

      return normalizeContainerAmountItem(result.rows[0]);
    }

    const result = await client.query(
      `
        insert into container_role_amount_items (
          source_order_id,
          container_number,
          role_key,
          amount_type,
          expense_category,
          item_name,
          amount,
          notes,
          warehouse_point,
          vendor_name,
          expense_date,
          reference_number,
          pricing_method,
          standard_amount,
          pricing_rule_id
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        returning *
      `,
      [
        params.sourceOrderId,
        params.containerNumber,
        params.amountSourceKey,
        params.amountType,
        params.expenseCategory || null,
        params.itemName.trim(),
        toNumber(params.amount),
        params.notes?.trim() || null,
        params.warehousePoint?.trim() || null,
        params.vendorName?.trim() || null,
        params.expenseDate || null,
        params.referenceNumber?.trim() || null,
        params.pricingMethod === "standard" ? "standard" : "manual",
        params.standardAmount == null ? null : toNumber(params.standardAmount),
        params.pricingRuleId == null ? null : Number(params.pricingRuleId)
      ]
    );

    return normalizeContainerAmountItem(result.rows[0]);
  });
}

export async function listTransportPricingRules() {
  await ensureSystemSchema();
  return withSystemClient(async (client) => {
    const result = await client.query(`
      select id, rule_code, rule_name, rule_type, warehouse_point, price_group, address, condition_key, amount, is_active
      from transport_pricing_rules
      where is_active = true
      order by case rule_type when 'fixed_route' then 1 else 2 end, rule_name asc
    `);
    return result.rows.map((row) => ({
      id: Number(row.id),
      rule_code: String(row.rule_code),
      rule_name: String(row.rule_name),
      rule_type: String(row.rule_type) === "amazon_warehouse" ? "amazon_warehouse" : "fixed_route",
      warehouse_point: row.warehouse_point ? String(row.warehouse_point) : null,
      price_group: row.price_group ? String(row.price_group) : null,
      address: row.address ? String(row.address) : null,
      condition_key: String(row.condition_key || "manual"),
      amount: toNumber(row.amount),
      is_active: Boolean(row.is_active)
    })) as TransportPricingRule[];
  });
}

export async function listWarehousePickupPricingRules() {
  await ensureSystemSchema();
  return withSystemClient(async (client) => {
    const result = await client.query(`
      select id, rule_code, rule_name, warehouse_point, price_group, address,
             amount, is_temporary, is_active
      from warehouse_pickup_pricing_rules
      where is_active = true
      order by warehouse_point asc, id asc
    `);
    return result.rows.map((row) => ({
      id: Number(row.id),
      rule_code: String(row.rule_code),
      rule_name: String(row.rule_name),
      warehouse_point: String(row.warehouse_point),
      price_group: row.price_group ? String(row.price_group) : null,
      address: row.address ? String(row.address) : null,
      amount: toNumber(row.amount),
      is_temporary: Boolean(row.is_temporary),
      is_active: Boolean(row.is_active)
    })) as WarehousePickupPricingRule[];
  });
}

function normalizeExpenseStandard(row: Record<string, unknown>): ExpenseStandard {
  const dateString = (value: unknown) => {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
  };
  return {
    id: Number(row.id),
    category: String(row.category) as ExpenseStandard["category"],
    standard_kind: String(row.standard_kind) as ExpenseStandard["standard_kind"],
    standard_name: String(row.standard_name),
    amount: toNumber(row.amount),
    unit: String(row.unit || "柜"),
    billing_month: dateString(row.billing_month),
    period_start: dateString(row.period_start),
    period_end: dateString(row.period_end),
    vendor_name: row.vendor_name ? String(row.vendor_name) : null,
    application_rule: row.application_rule === "monthly_prorated"
      ? "monthly_prorated"
      : row.application_rule === "monthly_manual"
      ? "monthly_manual"
      : "per_container",
    operation_mode: row.category === "transport" && row.standard_kind === "monthly" && row.application_rule === "monthly_prorated"
      ? null
      : row.operation_mode === "unload" || row.operation_mode === "direct_delivery"
      ? row.operation_mode
      : null,
    description: row.description ? String(row.description) : null,
    is_active: Boolean(row.is_active),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at)
  };
}

export async function listExpenseStandards(params?: {
  category?: ExpenseStandard["category"];
  standardKind?: ExpenseStandard["standard_kind"];
}) {
  await ensureSystemSchema();
  return withSystemClient(async (client) => {
    const result = await client.query(
      `
        select *
        from expense_standards
        where is_active = true
          and ($1::text is null or category = $1)
          and ($2::text is null or standard_kind = $2)
        order by billing_month desc nulls last, standard_name asc, id desc
      `,
      [params?.category || null, params?.standardKind || null]
    );
    return result.rows.map(normalizeExpenseStandard);
  });
}

export async function saveExpenseStandard(params: {
  id?: number;
  category: ExpenseStandard["category"];
  standardKind: ExpenseStandard["standard_kind"];
  standardName: string;
  amount: number;
  unit?: string;
  billingMonth?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  applicationRule?: ExpenseStandard["application_rule"];
  operationMode?: ExpenseStandard["operation_mode"];
  vendorName?: string | null;
  description?: string | null;
}) {
  await ensureSystemSchema();
  return withSystemClient(async (client) => {
    const values = [
      params.category,
      params.standardKind,
      params.standardName.trim(),
      toNumber(params.amount),
      params.unit?.trim() || (params.standardKind === "monthly" ? "月" : "柜"),
      params.standardKind === "monthly"
        ? params.billingMonth || (params.periodStart ? `${params.periodStart.slice(0, 7)}-01` : null)
        : null,
      params.vendorName?.trim() || null,
      params.applicationRule || (params.standardKind === "monthly" ? "monthly_manual" : "per_container"),
      params.description?.trim() || null,
      params.standardKind === "monthly" ? params.periodStart || null : null,
      params.standardKind === "monthly" ? params.periodEnd || null : null,
      params.operationMode || null
    ];
    const result = params.id
      ? await client.query(
        `
          update expense_standards
          set category = $1, standard_kind = $2, standard_name = $3, amount = $4,
              unit = $5, billing_month = $6::date, vendor_name = $7,
              application_rule = $8, description = $9, period_start = $10::date,
              period_end = $11::date,
              operation_mode = case
                when $1 = 'transport' and $2 = 'monthly' and $8 = 'monthly_prorated' then null
                else coalesce($12, operation_mode)
              end,
              updated_at = now()
          where id = $13 and is_active = true
          returning *
        `,
        [...values, params.id]
      )
      : await client.query(
        `
          insert into expense_standards (
            category, standard_kind, standard_name, amount, unit, billing_month,
            vendor_name, application_rule, description, period_start, period_end, operation_mode
          ) values ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10::date, $11::date, $12)
          returning *
        `,
        values
      );
    if (!result.rows[0]) throw new Error("支出标准不存在");
    return normalizeExpenseStandard(result.rows[0]);
  });
}

export async function deleteExpenseStandard(id: number) {
  await ensureSystemSchema();
  return withSystemClient(async (client) => {
    const result = await client.query(
      "update expense_standards set is_active = false, updated_at = now() where id = $1 returning id",
      [id]
    );
    return result.rows[0] ? Number(result.rows[0].id) : null;
  });
}

export async function listOperatingExpenses(params: {
  category: "transport" | "warehouse" | "domestic";
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(params.page || 1, 1);
  const pageSize = Math.min(Math.max(params.pageSize || 50, 10), 200);
  const offset = (page - 1) * pageSize;
  const search = `%${params.search?.trim() || ""}%`;

  await ensureSystemSchema();
  return withSystemClient(async (client) => {
    const result = await client.query(
      `
        select *, count(*) over()::int as total_count
        from container_role_amount_items
        where amount_type = 'expense'
          and expense_category = $1
          and ($2 = '%%'
            or container_number ilike $2
            or item_name ilike $2
            or coalesce(warehouse_point, '') ilike $2
            or coalesce(vendor_name, '') ilike $2
            or coalesce(reference_number, '') ilike $2)
          and ($3::date is null or expense_date >= $3::date)
          and ($4::date is null or expense_date <= $4::date)
        order by expense_date desc nulls last, id desc
        limit $5 offset $6
      `,
      [params.category, search, params.dateFrom || null, params.dateTo || null, pageSize, offset]
    );

    const items = result.rows.map(normalizeContainerAmountItem);
    return {
      items,
      totalCount: Number(result.rows[0]?.total_count || 0),
      page,
      pageSize
    };
  });
}

export async function getOperatingExpenseSummary() {
  await ensureSystemSchema();
  return withSystemClient(async (client) => {
    const result = await client.query(`
      select
        expense_category,
        count(*)::int as count,
        coalesce(sum(amount), 0)::float8 as total
      from container_role_amount_items
      where amount_type = 'expense'
        and expense_category in ('transport', 'warehouse', 'domestic')
      group by expense_category
    `);

    const summary = {
      transport: { count: 0, total: 0 },
      warehouse: { count: 0, total: 0 },
      domestic: { count: 0, total: 0 }
    };
    for (const row of result.rows) {
      const category = String(row.expense_category) as keyof typeof summary;
      summary[category] = { count: Number(row.count), total: toNumber(row.total) };
    }
    return summary;
  });
}

export async function deleteContainerAmountItem(id: number) {
  await ensureSystemSchema();
  return withSystemClient(async (client) => {
    const result = await client.query(
      "delete from container_role_amount_items where id = $1 returning id",
      [id]
    );
    return Number(result.rows[0]?.id || 0);
  });
}

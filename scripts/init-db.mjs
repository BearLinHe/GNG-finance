import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.SYSTEM_DATABASE_URL;
if (!connectionString) {
  throw new Error("SYSTEM_DATABASE_URL is not configured");
}

const pool = new Pool({
  connectionString,
  max: 1,
  ssl: { rejectUnauthorized: true }
});

const client = await pool.connect();

try {
  await client.query("begin");
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
      fee_code varchar(80) not null,
      fee_name varchar(200) not null,
      unit varchar(30),
      unit_price numeric(12, 2) not null default 0,
      currency varchar(10) not null default 'USD',
      scope_type varchar(30) not null default 'all',
      customer_name varchar(200),
      container_type varchar(50),
      description text,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await client.query(`
    create table if not exists container_role_amount_items (
      id bigserial primary key,
      source_order_id bigint not null,
      container_number varchar(100) not null,
      role_key varchar(30) not null,
      amount_type varchar(20) not null,
      item_name varchar(200) not null,
      amount numeric(12, 2) not null default 0,
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await client.query("create index if not exists idx_container_bills_status on container_bills(status)");
  await client.query("create index if not exists idx_container_bills_container_number on container_bills(container_number)");
  await client.query("create index if not exists idx_container_bills_operation_mode on container_bills(operation_mode)");
  await client.query("create index if not exists idx_container_bills_order_date on container_bills(order_date)");
  await client.query("create index if not exists idx_role_amount_records_bill on role_amount_records(bill_id)");
  await client.query("create index if not exists idx_fee_prices_active on fee_prices(is_active)");
  await client.query("create index if not exists idx_fee_prices_code on fee_prices(fee_code)");
  await client.query("create index if not exists idx_fee_prices_scope on fee_prices(scope_type)");
  await client.query("create index if not exists idx_container_role_amount_items_order on container_role_amount_items(source_order_id)");
  await client.query("create index if not exists idx_container_role_amount_items_container on container_role_amount_items(container_number)");
  await client.query("create index if not exists idx_container_role_amount_items_role on container_role_amount_items(role_key)");
  await client.query("commit");
  console.log("Initialized system database");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}

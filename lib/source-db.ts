import { Pool, type PoolClient } from "pg";

export type SourceContainer = {
  sourceOrderId: number;
  containerNumber: string;
  customerName: string | null;
  productType: string | null;
  presetReceivableAmount: number;
  sourceBalanceAmount: number;
  receivableCount: number;
  invoiceCount: number;
  invoiceNumbers: string | null;
  latestInvoiceDate: string | null;
};

export type SourceFee = {
  sourceFeeId: number;
  sourceType: "standard_price" | "legacy_fee";
  sourceStandardId: number | null;
  sourceStandardPriceId: number | null;
  feeCode: string;
  feeName: string;
  unit: string | null;
  unitPrice: number;
  currency: string;
  scopeType: string;
  containerType: string | null;
  customerId: number | null;
  customerName: string | null;
  customerCode: string | null;
  sourceIsActive: boolean | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  description: string | null;
  notes: string | null;
  updatedAt: string | null;
  totalCount: number;
};

export type SourceContainerProfile = {
  sourceOrderId: number;
  containerNumber: string;
  customerName: string | null;
  orderDate: string | null;
  status: string | null;
  containerType: string | null;
  etaDate: string | null;
  lfdDate: string | null;
  pickupDate: string | null;
  returnDeadline: string | null;
  mblNumber: string | null;
  warehouseAccount: string | null;
  portLocation: string | null;
  deliveryLocation: string | null;
  carrierName: string | null;
  operationMode: string | null;
  productTypes: string | null;
  invoiceNumbers: string | null;
  invoiceCount: number;
  invoiceTotalAmount: number;
  receivableAmount: number;
  allocatedAmount: number;
  balanceAmount: number;
  receivableCount: number;
  orderDetailCount: number;
  totalQuantity: number;
  totalEstimatedPallets: number;
  appointmentCount: number;
  firstAppointmentAt: string | null;
  lastAppointmentAt: string | null;
  inboundStatus: string | null;
  plannedUnloadAt: string | null;
  unloadBillAmount: number;
  pickupOut: boolean;
  returnEmpty: boolean;
  deliveryTrips: Array<{
    appointmentId: number;
    warehousePoint: string | null;
    deliveryMethod: string | null;
    appointmentStatus: string | null;
    totalPallets: number;
  }>;
};

export type SourceContainerExpenseFacts = {
  sourceOrderId: number;
  directRejectionUnload: boolean;
  pickupOut: boolean;
  returnEmpty: boolean;
  warehouseAllocations: Array<{
    orderDetailId: number;
    warehousePoint: string | null;
    proportion: number;
    estimatedPallets: number;
  }>;
  methodAllocations: Array<{
    orderDetailId: number;
    warehousePoint: string | null;
    deliveryMethod: string | null;
    appointmentCount: number;
    appointmentPallets: number;
  }>;
  rejectionTrips: Array<{
    warehousePoint: string | null;
    deliveryMethod: string | null;
    rejectionCount: number;
    rejectedPallets: number;
  }>;
  deliveryTrips: Array<{
    appointmentId: number;
    warehousePoint: string | null;
    deliveryMethod: string | null;
    appointmentStatus: string | null;
    totalPallets: number;
  }>;
};

export type SourceInitialPricingLine = {
  sourceLineId: number | null;
  productName: string;
  sourceFeeId: number | null;
  sourceType: "standard_price" | "legacy_fee" | "invoice_line" | null;
  sourceStandardId: number | null;
  sourceStandardPriceId: number | null;
  sourceFeeCode: string | null;
  sourceFeeName: string | null;
  sourceUnitPrice: number;
  quantity: number | null;
  sourceTotalAmount: number | null;
  sourceScopeType: string | null;
  sourceCustomerName: string | null;
  sourceContainerType: string | null;
  matchLevel: string | null;
  lineNotes: string | null;
};

export type SourceInvoiceSummary = {
  invoiceId: number;
  invoiceNumber: string;
  invoiceType: string;
  invoiceDate: string | null;
  totalAmount: number;
  invoiceStatus: string;
  lineCount: number;
  receivableCount: number;
  receivableAmount: number;
  allocatedAmount: number;
  balanceAmount: number;
  receivableStatus: "open" | "partial" | "closed" | null;
};

export type SourceInitialBill = {
  sourceOrderId: number;
  containerNumber: string;
  customerName: string | null;
  orderDate: string | null;
  etaDate: string | null;
  pickupDate: string | null;
  unloadDate: string | null;
  returnDeadline: string | null;
  operationMode: string | null;
  containerType: string | null;
  productTypes: string | null;
  detailCount: number;
  totalEstimatedPallets: number;
  sourcePresetAmount: number;
  sourceBalanceAmount: number;
  sourceReceivableAmount: number;
  sourceInvoiceTotalAmount: number;
  invoiceCount: number;
  invoiceNumbers: string | null;
  sourceInvoices: SourceInvoiceSummary[];
  matchedFeeCount: number;
  pricingLines: SourceInitialPricingLine[];
  totalCount: number;
};

export type SourceOperationMode = {
  operationMode: string;
  count: number;
  invoiceCount: number;
};

const SOURCE_FACT_CACHE_TTL_MS = 5 * 60 * 1000;
type SourceMonthAllocation = { month: string; containerCount: number; position: number };
const sourceGlobal = globalThis as typeof globalThis & {
  gngSourcePool?: Pool;
  gngSourceExpenseFactCache?: Map<number, { expiresAt: number; value: SourceContainerExpenseFacts }>;
  gngSourceMonthAllocationCache?: Map<string, { expiresAt: number; value: Map<number, SourceMonthAllocation> }>;
};
const sourceExpenseFactCache: Map<number, { expiresAt: number; value: SourceContainerExpenseFacts }> =
  sourceGlobal.gngSourceExpenseFactCache ?? (sourceGlobal.gngSourceExpenseFactCache = new Map());
const sourceMonthAllocationCache: Map<string, { expiresAt: number; value: Map<number, SourceMonthAllocation> }> =
  sourceGlobal.gngSourceMonthAllocationCache ?? (sourceGlobal.gngSourceMonthAllocationCache = new Map());

function getPool() {
  if (!sourceGlobal.gngSourcePool) {
    const connectionString = process.env.SOURCE_DATABASE_URL;
    if (!connectionString) {
      throw new Error("SOURCE_DATABASE_URL is not configured");
    }

    sourceGlobal.gngSourcePool = new Pool({
      connectionString,
      max: 4,
      ssl: { rejectUnauthorized: true }
    });
  }

  return sourceGlobal.gngSourcePool;
}

async function withReadonlySource<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect();

  try {
    await client.query("set statement_timeout = '20s'");
    await client.query("begin read only");
    await client.query("set transaction read only");
    const result = await fn(client);
    await client.query("rollback");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Ignore rollback failures after connection errors.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function searchSourceContainers(params: {
  search?: string;
  customer?: string;
  productType?: string;
  limit?: number;
}) {
  const search = `%${params.search?.trim() || ""}%`;
  const customer = `%${params.customer?.trim() || ""}%`;
  const productType = params.productType?.trim();
  const limit = Math.min(Math.max(params.limit || 80, 1), 300);

  return withReadonlySource(async (client) => {
    const result = await client.query(
      `
        with invoice_receivables as (
          select
            i.invoice_id,
            i.order_id,
            i.invoice_number,
            i.invoice_type,
            i.invoice_date,
            coalesce(sum(r.receivable_amount), 0) as receivable_amount,
            coalesce(sum(r.balance), 0) as balance_amount,
            count(r.receivable_id)::int as receivable_count
          from public.invoices i
          left join public.receivables r on r.invoice_id = i.invoice_id
          group by i.invoice_id
        )
        select
          o.order_id::int as "sourceOrderId",
          o.order_number as "containerNumber",
          c.name as "customerName",
          nullif(string_agg(distinct ir.invoice_type, ', ' order by ir.invoice_type), '') as "productType",
          coalesce(sum(ir.receivable_amount), 0)::float8 as "presetReceivableAmount",
          coalesce(sum(ir.balance_amount), 0)::float8 as "sourceBalanceAmount",
          coalesce(sum(ir.receivable_count), 0)::int as "receivableCount",
          count(distinct ir.invoice_id)::int as "invoiceCount",
          nullif(string_agg(distinct ir.invoice_number, ', ' order by ir.invoice_number), '') as "invoiceNumbers",
          max(ir.invoice_date)::text as "latestInvoiceDate"
        from public.orders o
        left join public.customers c on c.id = o.customer_id
        left join invoice_receivables ir on ir.order_id = o.order_id
        where
          ($1 = '%%' or o.order_number ilike $1 or coalesce(ir.invoice_number, '') ilike $1)
          and ($2 = '%%' or coalesce(c.name, '') ilike $2)
          and ($3::text is null or ir.invoice_type = $3)
        group by o.order_id, o.order_number, c.name
        order by max(ir.invoice_date) desc nulls last, o.order_id desc
        limit $4
      `,
      [search, customer, productType || null, limit]
    );

    return result.rows as SourceContainer[];
  });
}

export async function getSourceContainerByOrderId(sourceOrderId: number) {
  const rows = await searchSourceContainers({
    search: "",
    limit: 300
  });

  return rows.find((row) => row.sourceOrderId === sourceOrderId) || null;
}

export async function getSourceContainerExact(sourceOrderId: number) {
  return withReadonlySource(async (client) => {
    const result = await client.query(
      `
        with invoice_receivables as (
          select
            i.invoice_id,
            i.order_id,
            i.invoice_number,
            i.invoice_type,
            i.invoice_date,
            coalesce(sum(r.receivable_amount), 0) as receivable_amount,
            coalesce(sum(r.balance), 0) as balance_amount,
            count(r.receivable_id)::int as receivable_count
          from public.invoices i
          left join public.receivables r on r.invoice_id = i.invoice_id
          where i.order_id = $1
          group by i.invoice_id
        )
        select
          o.order_id::int as "sourceOrderId",
          o.order_number as "containerNumber",
          c.name as "customerName",
          nullif(string_agg(distinct ir.invoice_type, ', ' order by ir.invoice_type), '') as "productType",
          coalesce(sum(ir.receivable_amount), 0)::float8 as "presetReceivableAmount",
          coalesce(sum(ir.balance_amount), 0)::float8 as "sourceBalanceAmount",
          coalesce(sum(ir.receivable_count), 0)::int as "receivableCount",
          count(distinct ir.invoice_id)::int as "invoiceCount",
          nullif(string_agg(distinct ir.invoice_number, ', ' order by ir.invoice_number), '') as "invoiceNumbers",
          max(ir.invoice_date)::text as "latestInvoiceDate"
        from public.orders o
        left join public.customers c on c.id = o.customer_id
        left join invoice_receivables ir on ir.order_id = o.order_id
        where o.order_id = $1
        group by o.order_id, o.order_number, c.name
      `,
      [sourceOrderId]
    );

    return (result.rows[0] || null) as SourceContainer | null;
  });
}

function normalizeInitialBill(row: Record<string, unknown>): SourceInitialBill {
  const pricingLines = Array.isArray(row.pricingLines)
    ? row.pricingLines
    : typeof row.pricingLines === "string"
    ? JSON.parse(row.pricingLines)
    : [];
  const sourceInvoices = Array.isArray(row.sourceInvoices)
    ? row.sourceInvoices
    : typeof row.sourceInvoices === "string"
    ? JSON.parse(row.sourceInvoices)
    : [];

  return {
    sourceOrderId: Number(row.sourceOrderId),
    containerNumber: String(row.containerNumber),
    customerName: row.customerName ? String(row.customerName) : null,
    orderDate: row.orderDate ? String(row.orderDate) : null,
    etaDate: row.etaDate ? String(row.etaDate) : null,
    pickupDate: row.pickupDate ? String(row.pickupDate) : null,
    unloadDate: row.unloadDate ? String(row.unloadDate) : null,
    returnDeadline: row.returnDeadline ? String(row.returnDeadline) : null,
    operationMode: row.operationMode ? String(row.operationMode) : null,
    containerType: row.containerType ? String(row.containerType) : null,
    productTypes: row.productTypes ? String(row.productTypes) : null,
    detailCount: Number(row.detailCount || 0),
    totalEstimatedPallets: Number(row.totalEstimatedPallets || 0),
    sourcePresetAmount: Number(row.sourcePresetAmount || 0),
    sourceBalanceAmount: Number(row.sourceBalanceAmount || 0),
    sourceReceivableAmount: Number(row.sourceReceivableAmount || 0),
    sourceInvoiceTotalAmount: Number(row.sourceInvoiceTotalAmount || 0),
    invoiceCount: Number(row.invoiceCount || 0),
    invoiceNumbers: row.invoiceNumbers ? String(row.invoiceNumbers) : null,
    sourceInvoices: sourceInvoices.map((invoice: Record<string, unknown>) => ({
      invoiceId: Number(invoice.invoiceId),
      invoiceNumber: String(invoice.invoiceNumber || ""),
      invoiceType: String(invoice.invoiceType || ""),
      invoiceDate: invoice.invoiceDate ? String(invoice.invoiceDate) : null,
      totalAmount: Number(invoice.totalAmount || 0),
      invoiceStatus: String(invoice.invoiceStatus || "draft"),
      lineCount: Number(invoice.lineCount || 0),
      receivableCount: Number(invoice.receivableCount || 0),
      receivableAmount: Number(invoice.receivableAmount || 0),
      allocatedAmount: Number(invoice.allocatedAmount || 0),
      balanceAmount: Number(invoice.balanceAmount || 0),
      receivableStatus: invoice.receivableStatus
        ? String(invoice.receivableStatus) as SourceInvoiceSummary["receivableStatus"]
        : null
    })),
    matchedFeeCount: Number(row.matchedFeeCount || 0),
    pricingLines: pricingLines.map((line: Record<string, unknown>) => ({
      sourceLineId: line.sourceLineId == null ? null : Number(line.sourceLineId),
      productName: String(line.productName || ""),
      sourceFeeId: line.sourceFeeId == null ? null : Number(line.sourceFeeId),
      sourceType: line.sourceType ? String(line.sourceType) as SourceInitialPricingLine["sourceType"] : null,
      sourceStandardId: line.sourceStandardId == null ? null : Number(line.sourceStandardId),
      sourceStandardPriceId: line.sourceStandardPriceId == null ? null : Number(line.sourceStandardPriceId),
      sourceFeeCode: line.sourceFeeCode ? String(line.sourceFeeCode) : null,
      sourceFeeName: line.sourceFeeName ? String(line.sourceFeeName) : null,
      sourceUnitPrice: Number(line.sourceUnitPrice || 0),
      quantity: line.quantity == null ? null : Number(line.quantity),
      sourceTotalAmount: line.sourceTotalAmount == null ? null : Number(line.sourceTotalAmount),
      sourceScopeType: line.sourceScopeType ? String(line.sourceScopeType) : null,
      sourceCustomerName: line.sourceCustomerName ? String(line.sourceCustomerName) : null,
      sourceContainerType: line.sourceContainerType ? String(line.sourceContainerType) : null,
      matchLevel: line.matchLevel ? String(line.matchLevel) : null,
      lineNotes: line.lineNotes ? String(line.lineNotes) : null
    })),
    totalCount: Number(row.totalCount || 0)
  };
}

export async function searchSourceInitialBills(params: {
  search?: string;
  containerNumber?: string;
  customerName?: string;
  productType?: string;
  operationMode?: string;
  dateField?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
  sourceOrderId?: number;
}) {
  const search = `%${params.search?.trim() || ""}%`;
  const containerNumber = `%${params.containerNumber?.trim() || ""}%`;
  const customerName = `%${params.customerName?.trim() || ""}%`;
  const productType = `%${params.productType?.trim() || ""}%`;
  const operationMode = params.operationMode?.trim();
  const allowedDateFields = new Set(["orderDate", "etaDate", "pickupDate", "unloadDate", "returnDeadline"]);
  const dateField = allowedDateFields.has(params.dateField || "") ? params.dateField || null : null;
  const dateFrom = params.dateFrom?.trim() || null;
  const dateTo = params.dateTo?.trim() || null;
  const pageSize = Math.min(Math.max(params.pageSize || 100, 10), 300);
  const page = Math.max(params.page || 1, 1);
  const offset = (page - 1) * pageSize;
  const sourceOrderId = params.sourceOrderId || null;

  return withReadonlySource(async (client) => {
    const result = await client.query(
      `
        with matching_orders as (
          select
            o.order_id,
            o.customer_id,
            o.order_number,
            c.name as customer_name,
            o.order_date,
            o.eta_date,
            o.pickup_date,
            inbound.unload_date,
            o.return_deadline,
            o.operation_mode,
            o.delivery_location,
            o.container_type,
            upper(replace(replace(coalesce(o.container_type, ''), 'DH', 'HQ'), 'HC', 'HQ')) as normalized_container_type
          from public.orders o
          left join public.customers c on c.id = o.customer_id
          left join lateral (
            select min(ir.planned_unload_at)::date as unload_date
            from wms.inbound_receipt ir
            where ir.order_id = o.order_id
          ) inbound on true
          where
            lower(trim(coalesce(o.status, ''))) not in ('archived', 'cancelled', 'canceled')
            and exists (
              select 1
              from public.order_detail od_exists
              where od_exists.order_id = o.order_id
            )
            and
            ($1 = '%%'
              or o.order_number ilike $1
              or coalesce(c.name, '') ilike $1
              or exists (
                select 1
                from public.order_detail od_search
                left join public.locations l_search on l_search.location_id = od_search.delivery_location_id
                where od_search.order_id = o.order_id
                  and coalesce(l_search.name, o.delivery_location, '') ilike $1
              ))
            and ($2 = '%%' or o.order_number ilike $2)
            and ($3 = '%%' or coalesce(c.name, '') ilike $3)
            and (
              $4 = '%%'
              or exists (
                select 1
                from public.order_detail od_product
                left join public.locations l_product on l_product.location_id = od_product.delivery_location_id
                where od_product.order_id = o.order_id
                  and coalesce(l_product.name, o.delivery_location, '') ilike $4
              )
            )
            and ($5::text is null or o.operation_mode = $5)
            and (
              $8::text is null
              or $9::date is null
              or (
                case $8::text
                  when 'orderDate' then o.order_date::date
                  when 'etaDate' then o.eta_date::date
                  when 'pickupDate' then o.pickup_date::date
                  when 'unloadDate' then inbound.unload_date
                  when 'returnDeadline' then o.return_deadline::date
                end
              ) >= $9::date
            )
            and (
              $8::text is null
              or $10::date is null
              or (
                case $8::text
                  when 'orderDate' then o.order_date::date
                  when 'etaDate' then o.eta_date::date
                  when 'pickupDate' then o.pickup_date::date
                  when 'unloadDate' then inbound.unload_date
                  when 'returnDeadline' then o.return_deadline::date
                end
              ) <= $10::date
            )
            and ($11::bigint is null or o.order_id = $11)
        ),
        total_count as (
          select count(*)::int as total_count from matching_orders
        ),
        page_orders as (
          select *
          from matching_orders
          order by order_date desc nulls last, order_id desc
          limit $6
          offset $7
        )
        select
          f.order_id::int as "sourceOrderId",
          f.order_number as "containerNumber",
          f.customer_name as "customerName",
          f.order_date::text as "orderDate",
          f.eta_date::text as "etaDate",
          f.pickup_date::text as "pickupDate",
          f.unload_date::text as "unloadDate",
          f.return_deadline::text as "returnDeadline",
          f.operation_mode as "operationMode",
          f.container_type as "containerType",
          product.product_types as "productTypes",
          coalesce(metrics.detail_count, 0)::int as "detailCount",
          coalesce(metrics.total_estimated_pallets, 0)::float8 as "totalEstimatedPallets",
          case
            when lower(coalesce(f.operation_mode, '')) = 'unload' and unload_price.unload_pricing_lines is not null
              then coalesce(unload_price.unload_total_amount, 0)
            else coalesce(price.source_preset_amount, 0)
          end::float8 as "sourcePresetAmount",
          coalesce(invoice.source_balance_amount, 0)::float8 as "sourceBalanceAmount",
          coalesce(invoice.source_receivable_amount, 0)::float8 as "sourceReceivableAmount",
          coalesce(invoice.source_invoice_total_amount, 0)::float8 as "sourceInvoiceTotalAmount",
          coalesce(invoice.invoice_count, 0)::int as "invoiceCount",
          invoice.invoice_numbers as "invoiceNumbers",
          coalesce(invoice.source_invoices, '[]'::jsonb) as "sourceInvoices",
          case
            when lower(coalesce(f.operation_mode, '')) = 'unload' and unload_price.unload_pricing_lines is not null
              then unload_price.unload_line_count
            else coalesce(price.matched_fee_count, 0)
          end::int as "matchedFeeCount",
          case
            when lower(coalesce(f.operation_mode, '')) = 'unload' and unload_price.unload_pricing_lines is not null
              then unload_price.unload_pricing_lines
            else coalesce(price.pricing_lines, '[]'::jsonb)
          end as "pricingLines",
          (select total_count from total_count)::int as "totalCount"
        from page_orders f
        left join lateral (
          select
            count(*)::int as detail_count,
            coalesce(sum(estimated_pallets), 0)::float8 as total_estimated_pallets
          from public.order_detail od
          where od.order_id = f.order_id
        ) metrics on true
        left join lateral (
          select
            string_agg(product_name, ', ' order by product_name) as product_types
          from (
            select distinct nullif(trim(coalesce(l.name, f.delivery_location)), '') as product_name
            from public.order_detail od
            left join public.locations l on l.location_id = od.delivery_location_id
            where od.order_id = f.order_id
              and nullif(trim(coalesce(l.name, f.delivery_location)), '') is not null
          ) product_rows
        ) product on true
        left join lateral (
          select
            count(*)::int as invoice_count,
            nullif(string_agg(invoice_number, ', ' order by invoice_number), '') as invoice_numbers,
            coalesce(sum(total_amount) filter (where invoice_status <> 'void'), 0)::float8 as source_invoice_total_amount,
            coalesce(sum(receivable_amount) filter (where invoice_status <> 'void'), 0)::float8 as source_receivable_amount,
            coalesce(sum(balance_amount) filter (where invoice_status <> 'void'), 0)::float8 as source_balance_amount,
            jsonb_agg(
              jsonb_build_object(
                'invoiceId', invoice_id::int,
                'invoiceNumber', invoice_number,
                'invoiceType', invoice_type,
                'invoiceDate', invoice_date,
                'totalAmount', total_amount::float8,
                'invoiceStatus', invoice_status,
                'lineCount', line_count,
                'receivableCount', receivable_count,
                'receivableAmount', receivable_amount::float8,
                'allocatedAmount', allocated_amount::float8,
                'balanceAmount', balance_amount::float8,
                'receivableStatus', receivable_status
              )
              order by invoice_id
            ) as source_invoices
          from (
            select
              i.invoice_id,
              i.invoice_number,
              lower(coalesce(i.invoice_type, '')) as invoice_type,
              i.invoice_date::text as invoice_date,
              coalesce(i.total_amount, 0) as total_amount,
              lower(coalesce(i.status, 'draft')) as invoice_status,
              coalesce(lines.line_count, 0)::int as line_count,
              coalesce(receivable.receivable_count, 0)::int as receivable_count,
              coalesce(receivable.receivable_amount, 0) as receivable_amount,
              coalesce(receivable.allocated_amount, 0) as allocated_amount,
              coalesce(receivable.balance_amount, 0) as balance_amount,
              case
                when coalesce(receivable.receivable_count, 0) = 0 then null
                when receivable.closed_count = receivable.receivable_count then 'closed'
                when receivable.partial_count > 0
                  or receivable.closed_count > 0
                  or coalesce(receivable.allocated_amount, 0) > 0 then 'partial'
                else 'open'
              end as receivable_status
            from public.invoices i
            left join lateral (
              select count(*)::int as line_count
              from public.invoice_line_items li
              where li.invoice_id = i.invoice_id
            ) lines on true
            left join lateral (
              select
                count(*)::int as receivable_count,
                count(*) filter (
                  where lower(coalesce(r.status, 'open')) = 'closed'
                    or coalesce(r.balance, 0) <= 0
                )::int as closed_count,
                count(*) filter (
                  where lower(coalesce(r.status, 'open')) = 'partial'
                )::int as partial_count,
                coalesce(sum(r.receivable_amount), 0) as receivable_amount,
                coalesce(sum(r.allocated_amount), 0) as allocated_amount,
                coalesce(sum(r.balance), 0) as balance_amount
              from public.receivables r
              where r.invoice_id = i.invoice_id
            ) receivable on true
            where i.order_id = f.order_id
          ) invoice_rows
        ) invoice on true
        left join lateral (
          select
            count(*)::int as unload_line_count,
            coalesce(sum(coalesce(li.total_amount, 0)), 0)::float8 as unload_total_amount,
            jsonb_agg(
              jsonb_build_object(
                'sourceLineId', li.id::int,
                'productName', coalesce(nullif(trim(li.fee_name), ''), nullif(trim(li.fee_code), ''), '拆柜明细'),
                'sourceFeeId', null,
                'sourceType', 'invoice_line',
                'sourceStandardId', null,
                'sourceStandardPriceId', null,
                'sourceFeeCode', li.fee_code,
                'sourceFeeName', li.fee_name,
                'sourceUnitPrice', coalesce(li.unit_price, 0)::float8,
                'quantity', coalesce(li.quantity, 0)::float8,
                'sourceTotalAmount', coalesce(li.total_amount, 0)::float8,
                'sourceScopeType', null,
                'sourceCustomerName', null,
                'sourceContainerType', null,
                'matchLevel', 'source_invoice_line',
                'lineNotes', li.line_notes
              )
              order by i.invoice_id, li.id
            ) as unload_pricing_lines
          from public.invoices i
          join public.invoice_line_items li on li.invoice_id = i.invoice_id
          where i.order_id = f.order_id
            and lower(coalesce(i.invoice_type, '')) = 'unload'
        ) unload_price on true
        left join lateral (
          select
            jsonb_agg(
              jsonb_build_object(
                'sourceLineId', null,
                'productName', p.product_name,
                'sourceFeeId', null,
                'sourceType', 'standard_price',
                'sourceStandardId', matched_fee.standard_id,
                'sourceStandardPriceId', matched_fee.id,
                'sourceFeeCode', matched_fee.fee_code,
                'sourceFeeName', matched_fee.fee_name,
                'sourceUnitPrice', coalesce(matched_fee.unit_price, 0),
                'quantity', null,
                'sourceTotalAmount', null,
                'sourceScopeType', matched_fee.scope_type,
                'sourceCustomerName', matched_fee.customer_name,
                'sourceContainerType', matched_fee.container_type,
                'matchLevel', matched_fee.match_level,
                'lineNotes', null
              )
              order by p.product_name
            ) as pricing_lines,
            coalesce(sum(coalesce(matched_fee.unit_price, 0)), 0) as source_preset_amount,
            count(matched_fee.id)::int as matched_fee_count
          from (
            select distinct product_name
            from (
              select distinct nullif(trim(coalesce(l.name, f.delivery_location)), '') as product_name
              from public.order_detail od
              left join public.locations l on l.location_id = od.delivery_location_id
              where od.order_id = f.order_id
                and nullif(trim(coalesce(l.name, f.delivery_location)), '') is not null
            ) direct_product_rows
          ) p
          left join lateral (
            select
              fsp.id::int,
              fs.id::int as standard_id,
              fs.fee_code,
              fs.fee_name,
              fsp.unit_price::float8,
              case when fsp.customer_id is null then 'all' else 'customers' end as scope_type,
              fsp.container_type,
              fee_customer.name as customer_name,
              case when fsp.customer_id = f.customer_id then 'customer' else 'default' end as match_level
            from public.fee_standard fs
            join public.fee_standard_price fsp on fsp.fee_standard_id = fs.id
            left join public.customers fee_customer on fee_customer.id = fsp.customer_id
            where
              fs.is_active = true
              and lower(fs.fee_code) = 'all in'
              and lower(fs.fee_name) = lower(p.product_name)
              and (
                fsp.container_type is null
                or upper(replace(replace(fsp.container_type, 'DH', 'HQ'), 'HC', 'HQ')) = f.normalized_container_type
              )
              and (
                fsp.customer_id = f.customer_id
                or fsp.customer_id is null
              )
            order by
              case when fsp.customer_id = f.customer_id then 0 else 1 end,
              case when upper(replace(replace(coalesce(fsp.container_type, ''), 'DH', 'HQ'), 'HC', 'HQ')) = f.normalized_container_type then 0 else 1 end,
              fsp.id desc
            limit 1
          ) matched_fee on true
        ) price on true
        order by f.order_date desc nulls last, f.order_id desc
      `,
      [
        search,
        containerNumber,
        customerName,
        productType,
        operationMode || null,
        pageSize,
        offset,
        dateField,
        dateFrom,
        dateTo,
        sourceOrderId
      ]
    );

    return result.rows.map(normalizeInitialBill);
  });
}

export async function searchSourceContainerProfitRows(params: {
  search?: string;
  customerName?: string;
  dateField?: string;
  dateFrom?: string;
  dateTo?: string;
  operationMode?: string;
  page?: number;
  pageSize?: number;
}) {
  const search = `%${params.search?.trim() || ""}%`;
  const customerName = `%${params.customerName?.trim() || ""}%`;
  const allowedDateFields = new Set(["orderDate", "etaDate", "pickupDate", "unloadDate", "returnDeadline"]);
  const dateField = allowedDateFields.has(params.dateField || "") ? params.dateField || null : null;
  const dateFrom = params.dateFrom?.trim() || null;
  const dateTo = params.dateTo?.trim() || null;
  const operationMode = params.operationMode?.trim() || null;
  const pageSize = Math.min(Math.max(params.pageSize || 100, 10), 300);
  const page = Math.max(params.page || 1, 1);
  const offset = (page - 1) * pageSize;

  return withReadonlySource(async (client) => {
    const result = await client.query(
      `
        with matching_orders as (
          select
            o.order_id,
            o.order_number,
            c.name as customer_name,
            o.order_date,
            o.eta_date,
            o.pickup_date,
            inbound.unload_date,
            o.return_deadline,
            o.operation_mode,
            o.delivery_location,
            o.container_type
          from public.orders o
          left join public.customers c on c.id = o.customer_id
          left join lateral (
            select min(ir.planned_unload_at)::date as unload_date
            from wms.inbound_receipt ir
            where ir.order_id = o.order_id
          ) inbound on true
          where lower(trim(coalesce(o.status, ''))) not in ('archived', 'cancelled', 'canceled')
            and exists (
              select 1 from public.order_detail od_exists where od_exists.order_id = o.order_id
            )
            and (
              $1 = '%%'
              or o.order_number ilike $1
              or exists (
                select 1
                from public.order_detail od_search
                left join public.locations l_search on l_search.location_id = od_search.delivery_location_id
                where od_search.order_id = o.order_id
                  and coalesce(l_search.name, l_search.location_code, o.delivery_location, '') ilike $1
              )
            )
            and ($4::text is null or o.operation_mode = $4)
            and ($5 = '%%' or coalesce(c.name, '') ilike $5)
            and (
              $6::text is null
              or $7::date is null
              or (
                case $6::text
                  when 'orderDate' then o.order_date::date
                  when 'etaDate' then o.eta_date::date
                  when 'pickupDate' then o.pickup_date::date
                  when 'unloadDate' then inbound.unload_date
                  when 'returnDeadline' then o.return_deadline::date
                end
              ) >= $7::date
            )
            and (
              $6::text is null
              or $8::date is null
              or (
                case $6::text
                  when 'orderDate' then o.order_date::date
                  when 'etaDate' then o.eta_date::date
                  when 'pickupDate' then o.pickup_date::date
                  when 'unloadDate' then inbound.unload_date
                  when 'returnDeadline' then o.return_deadline::date
                end
              ) <= $8::date
            )
        ),
        page_orders as (
          select *
          from matching_orders
          order by order_date desc nulls last, order_id desc
          limit $2 offset $3
        )
        select
          f.order_id::int as "sourceOrderId",
          f.order_number as "containerNumber",
          f.customer_name as "customerName",
          f.order_date::text as "orderDate",
          f.eta_date::text as "etaDate",
          f.pickup_date::text as "pickupDate",
          f.unload_date::text as "unloadDate",
          f.return_deadline::text as "returnDeadline",
          f.operation_mode as "operationMode",
          f.container_type as "containerType",
          product.product_types as "productTypes",
          0::int as "detailCount",
          0::float8 as "totalEstimatedPallets",
          0::float8 as "sourcePresetAmount",
          coalesce(invoice.source_balance_amount, 0)::float8 as "sourceBalanceAmount",
          coalesce(invoice.source_receivable_amount, 0)::float8 as "sourceReceivableAmount",
          coalesce(invoice.source_invoice_total_amount, 0)::float8 as "sourceInvoiceTotalAmount",
          coalesce(invoice.invoice_count, 0)::int as "invoiceCount",
          invoice.invoice_numbers as "invoiceNumbers",
          coalesce(invoice.source_invoices, '[]'::jsonb) as "sourceInvoices",
          0::int as "matchedFeeCount",
          '[]'::jsonb as "pricingLines",
          (select count(*)::int from matching_orders) as "totalCount"
        from page_orders f
        left join lateral (
          select string_agg(product_name, ', ' order by product_name) as product_types
          from (
            select distinct nullif(trim(coalesce(l.name, l.location_code, f.delivery_location)), '') as product_name
            from public.order_detail od
            left join public.locations l on l.location_id = od.delivery_location_id
            where od.order_id = f.order_id
          ) product_rows
          where product_name is not null
        ) product on true
        left join lateral (
          select
            count(*)::int as invoice_count,
            nullif(string_agg(invoice_number, ', ' order by invoice_number), '') as invoice_numbers,
            coalesce(sum(total_amount) filter (where invoice_status <> 'void'), 0)::float8 as source_invoice_total_amount,
            coalesce(sum(receivable_amount) filter (where invoice_status <> 'void'), 0)::float8 as source_receivable_amount,
            coalesce(sum(balance_amount) filter (where invoice_status <> 'void'), 0)::float8 as source_balance_amount,
            jsonb_agg(
              jsonb_build_object(
                'invoiceId', invoice_id::int,
                'invoiceNumber', invoice_number,
                'invoiceType', invoice_type,
                'invoiceDate', invoice_date,
                'totalAmount', total_amount::float8,
                'invoiceStatus', invoice_status,
                'lineCount', line_count,
                'receivableCount', receivable_count,
                'receivableAmount', receivable_amount::float8,
                'allocatedAmount', allocated_amount::float8,
                'balanceAmount', balance_amount::float8,
                'receivableStatus', receivable_status
              ) order by invoice_id
            ) as source_invoices
          from (
            select
              i.invoice_id,
              i.invoice_number,
              lower(coalesce(i.invoice_type, '')) as invoice_type,
              i.invoice_date::text as invoice_date,
              coalesce(i.total_amount, 0) as total_amount,
              lower(coalesce(i.status, 'draft')) as invoice_status,
              coalesce(lines.line_count, 0)::int as line_count,
              coalesce(receivable.receivable_count, 0)::int as receivable_count,
              coalesce(receivable.receivable_amount, 0) as receivable_amount,
              coalesce(receivable.allocated_amount, 0) as allocated_amount,
              coalesce(receivable.balance_amount, 0) as balance_amount,
              case
                when coalesce(receivable.receivable_count, 0) = 0 then null
                when receivable.closed_count = receivable.receivable_count then 'closed'
                when receivable.partial_count > 0 or receivable.closed_count > 0 or coalesce(receivable.allocated_amount, 0) > 0 then 'partial'
                else 'open'
              end as receivable_status
            from public.invoices i
            left join lateral (
              select count(*)::int as line_count
              from public.invoice_line_items li
              where li.invoice_id = i.invoice_id
            ) lines on true
            left join lateral (
              select
                count(*)::int as receivable_count,
                count(*) filter (where lower(coalesce(r.status, 'open')) = 'closed' or coalesce(r.balance, 0) <= 0)::int as closed_count,
                count(*) filter (where lower(coalesce(r.status, 'open')) = 'partial')::int as partial_count,
                coalesce(sum(r.receivable_amount), 0) as receivable_amount,
                coalesce(sum(r.allocated_amount), 0) as allocated_amount,
                coalesce(sum(r.balance), 0) as balance_amount
              from public.receivables r
              where r.invoice_id = i.invoice_id
            ) receivable on true
            where i.order_id = f.order_id
          ) invoice_rows
        ) invoice on true
        order by f.order_date desc nulls last, f.order_id desc
      `,
      [search, pageSize, offset, operationMode, customerName, dateField, dateFrom, dateTo]
    );

    return result.rows.map(normalizeInitialBill);
  });
}

export async function getSourceOperationMonthAllocations(
  operationMode: "unload" | "direct_delivery",
  months: string[],
  bypassCache = false
) {
  const normalizedMonths = [...new Set(months.filter((month) => /^\d{4}-\d{2}$/.test(month)))];
  if (!normalizedMonths.length) return new Map<number, { month: string; containerCount: number; position: number }>();

  const now = Date.now();
  const combined = new Map<number, { month: string; containerCount: number; position: number }>();
  const missingMonths = normalizedMonths.filter((month) => {
    const cached = sourceMonthAllocationCache.get(`${operationMode}:${month}`);
    if (!bypassCache && cached && cached.expiresAt > now) {
      cached.value.forEach((value, orderId) => combined.set(orderId, value));
      return false;
    }
    return true;
  });
  if (!missingMonths.length) return combined;

  const fresh = await withReadonlySource(async (client) => {
    const result = await client.query(
      `
        with order_unload_dates as (
          select
            o.order_id,
            case
              when $1::text = 'unload' then min(ir.planned_unload_at)::date
              else o.pickup_date::date
            end as allocation_date
          from public.orders o
          left join wms.inbound_receipt ir on ir.order_id = o.order_id
          where (
              ($1::text = 'unload' and (
                o.operation_mode = 'unload'
                or ir.inbound_source = 'direct_rejection_unload'
              ))
              or ($1::text = 'direct_delivery' and o.operation_mode = 'direct_delivery')
            )
            and lower(trim(coalesce(o.status, ''))) not in ('archived', 'cancelled', 'canceled')
            and (
              ($1::text = 'unload' and ir.planned_unload_at is not null)
              or ($1::text = 'direct_delivery' and o.pickup_date is not null)
            )
            and exists (
              select 1 from public.order_detail od_exists where od_exists.order_id = o.order_id
            )
          group by o.order_id, o.pickup_date
        )
        select
          order_id::int,
          to_char(allocation_date, 'YYYY-MM') as month,
          count(*) over (partition by to_char(allocation_date, 'YYYY-MM'))::int as container_count,
          row_number() over (partition by to_char(allocation_date, 'YYYY-MM') order by order_id)::int as position
        from order_unload_dates
        where to_char(allocation_date, 'YYYY-MM') = any($2::text[])
      `,
      [operationMode, missingMonths]
    );
    return new Map<number, { month: string; containerCount: number; position: number }>(
      result.rows.map((row) => [
        Number(row.order_id),
        {
          month: String(row.month),
          containerCount: Number(row.container_count),
          position: Number(row.position)
        }
      ])
    );
  });

  for (const month of missingMonths) {
    const monthValues = new Map<number, { month: string; containerCount: number; position: number }>();
    fresh.forEach((value, orderId) => {
      if (value.month === month) monthValues.set(orderId, value);
    });
    sourceMonthAllocationCache.set(`${operationMode}:${month}`, {
      expiresAt: now + SOURCE_FACT_CACHE_TTL_MS,
      value: monthValues
    });
  }
  fresh.forEach((value, orderId) => combined.set(orderId, value));
  return combined;
}

export async function getSourceInitialBillExact(sourceOrderId: number) {
  const rows = await searchSourceInitialBills({
    sourceOrderId,
    page: 1,
    pageSize: 10
  });

  return rows[0] || null;
}

export async function listSourceOperationModes() {
  return withReadonlySource(async (client) => {
    const result = await client.query(
      `
        with order_counts as (
          select
            coalesce(operation_mode, '') as operation_mode,
            count(*)::int as count
          from public.orders
          where lower(trim(coalesce(status, ''))) not in ('archived', 'cancelled', 'canceled')
            and exists (
              select 1
              from public.order_detail od_exists
              where od_exists.order_id = orders.order_id
            )
          group by operation_mode
        ),
        invoice_counts as (
          select
            coalesce(i.invoice_type, '') as operation_mode,
            count(*)::int as invoice_count
          from public.invoices i
          join public.orders o on o.order_id = i.order_id
          where lower(trim(coalesce(o.status, ''))) not in ('archived', 'cancelled', 'canceled')
          group by i.invoice_type
        )
        select
          coalesce(oc.operation_mode, ic.operation_mode, '') as "operationMode",
          coalesce(oc.count, 0)::int as count,
          coalesce(ic.invoice_count, 0)::int as "invoiceCount"
        from order_counts oc
        full join invoice_counts ic on ic.operation_mode = oc.operation_mode
        where coalesce(oc.operation_mode, ic.operation_mode, '') in ('unload', 'direct_delivery', '')
        order by count desc, "operationMode" asc nulls last
      `
    );

    return result.rows as SourceOperationMode[];
  });
}

export async function searchSourceFees(params: {
  search?: string;
  scopeType?: string;
  customer?: string;
  limit?: number;
  page?: number;
  pageSize?: number;
}) {
  const search = `%${params.search?.trim() || ""}%`;
  const customer = `%${params.customer?.trim() || ""}%`;
  const scopeType = params.scopeType?.trim();
  const pageSize = Math.min(Math.max(params.pageSize || params.limit || 50, 10), 200);
  const page = Math.max(params.page || 1, 1);
  const offset = (page - 1) * pageSize;

  return withReadonlySource(async (client) => {
    const result = await client.query(
      `
        select
          fsp.id::int as "sourceFeeId",
          'standard_price'::text as "sourceType",
          fs.id::int as "sourceStandardId",
          fsp.id::int as "sourceStandardPriceId",
          fs.fee_code as "feeCode",
          fs.fee_name as "feeName",
          fsp.unit,
          fsp.unit_price::float8 as "unitPrice",
          coalesce(fsp.currency, 'USD') as currency,
          case when fsp.customer_id is null then 'all' else 'customers' end as "scopeType",
          fsp.container_type as "containerType",
          fsp.customer_id::int as "customerId",
          c.code as "customerCode",
          c.name as "customerName",
          fs.is_active as "sourceIsActive",
          fsp.effective_date::text as "effectiveDate",
          fsp.expiration_date::text as "expirationDate",
          fs.description,
          coalesce(fsp.notes, fs.notes) as notes,
          greatest(coalesce(fsp.updated_at, fsp.created_at), coalesce(fs.updated_at, fs.created_at))::text as "updatedAt",
          count(*) over()::int as "totalCount"
        from public.fee_standard_price fsp
        join public.fee_standard fs on fs.id = fsp.fee_standard_id
        left join public.customers c on c.id = fsp.customer_id
        where
          ($1 = '%%'
            or fs.fee_code ilike $1
            or fs.fee_name ilike $1
            or coalesce(c.name, '') ilike $1
            or coalesce(c.code, '') ilike $1
            or coalesce(fsp.container_type, '') ilike $1
            or coalesce(fsp.notes, '') ilike $1
            or coalesce(fs.description, '') ilike $1)
          and (
            $2::text is null
            or ($2 = 'all' and fsp.customer_id is null)
            or ($2 = 'customers' and fsp.customer_id is not null)
          )
          and ($3 = '%%' or coalesce(c.name, '') ilike $3 or coalesce(c.code, '') ilike $3)
        order by fs.fee_code asc, fs.fee_name asc, c.name asc nulls first, fsp.container_type asc nulls first, fsp.id asc
        limit $4
        offset $5
      `,
      [search, scopeType || null, customer, pageSize, offset]
    );

    return result.rows as SourceFee[];
  });
}

export async function searchLegacySourceFees(params: {
  search?: string;
  scopeType?: string;
  customer?: string;
  limit?: number;
  page?: number;
  pageSize?: number;
}) {
  const search = `%${params.search?.trim() || ""}%`;
  const customer = `%${params.customer?.trim() || ""}%`;
  const scopeType = params.scopeType?.trim();
  const pageSize = Math.min(Math.max(params.pageSize || params.limit || 50, 10), 200);
  const page = Math.max(params.page || 1, 1);
  const offset = (page - 1) * pageSize;

  return withReadonlySource(async (client) => {
    const result = await client.query(
      `
        select
          f.id::int as "sourceFeeId",
          'legacy_fee'::text as "sourceType",
          null::int as "sourceStandardId",
          null::int as "sourceStandardPriceId",
          f.fee_code as "feeCode",
          f.fee_name as "feeName",
          f.unit,
          f.unit_price::float8 as "unitPrice",
          coalesce(f.currency, 'USD') as currency,
          f.scope_type as "scopeType",
          f.container_type as "containerType",
          f.customer_id::int as "customerId",
          c.code as "customerCode",
          c.name as "customerName",
          null::boolean as "sourceIsActive",
          null::text as "effectiveDate",
          null::text as "expirationDate",
          f.description,
          null::text as notes,
          f.updated_at::text as "updatedAt",
          count(*) over()::int as "totalCount"
        from public.fee f
        left join public.customers c on c.id = f.customer_id
        where
          ($1 = '%%'
            or f.fee_code ilike $1
            or f.fee_name ilike $1
            or coalesce(c.name, '') ilike $1
            or coalesce(f.container_type, '') ilike $1)
          and ($2::text is null or f.scope_type = $2)
          and ($3 = '%%' or coalesce(c.name, '') ilike $3)
        order by f.container_type asc nulls last, f.fee_code asc, f.fee_name asc, c.name asc nulls last, f.id asc
        limit $4
        offset $5
      `,
      [search, scopeType || null, customer, pageSize, offset]
    );

    return result.rows as SourceFee[];
  });
}

export async function getSourceContainerProfile(query: string) {
  const value = query.trim();
  if (!value) {
    return null;
  }

  const search = `%${value}%`;

  return withReadonlySource(async (client) => {
    const result = await client.query(
      `
        select
          o.order_id::int as "sourceOrderId",
          o.order_number as "containerNumber",
          c.name as "customerName",
          o.order_date::text as "orderDate",
          o.status,
          o.container_type as "containerType",
          o.eta_date::text as "etaDate",
          o.lfd_date::text as "lfdDate",
          o.pickup_date::text as "pickupDate",
          o.return_deadline::text as "returnDeadline",
          o.mbl_number as "mblNumber",
          o.warehouse_account as "warehouseAccount",
          o.port_location as "portLocation",
          o.delivery_location as "deliveryLocation",
          ca.name as "carrierName",
          o.operation_mode as "operationMode",
          inv.product_types as "productTypes",
          inv.invoice_numbers as "invoiceNumbers",
          coalesce(inv.invoice_count, 0)::int as "invoiceCount",
          coalesce(inv.invoice_total_amount, 0)::float8 as "invoiceTotalAmount",
          coalesce(ar.receivable_amount, 0)::float8 as "receivableAmount",
          coalesce(ar.allocated_amount, 0)::float8 as "allocatedAmount",
          coalesce(ar.balance_amount, 0)::float8 as "balanceAmount",
          coalesce(ar.receivable_count, 0)::int as "receivableCount",
          coalesce(od.order_detail_count, 0)::int as "orderDetailCount",
          coalesce(od.total_quantity, 0)::float8 as "totalQuantity",
          coalesce(od.total_estimated_pallets, 0)::float8 as "totalEstimatedPallets",
          coalesce(ap.appointment_count, 0)::int as "appointmentCount",
          ap.first_appointment_at::text as "firstAppointmentAt",
          ap.last_appointment_at::text as "lastAppointmentAt",
          inbound.status as "inboundStatus",
          inbound.planned_unload_at::text as "plannedUnloadAt",
          coalesce(inbound.unload_bill_amount, 0)::float8 as "unloadBillAmount",
          coalesce(pm.pickup_out, false) as "pickupOut",
          coalesce(pm.return_empty, false) as "returnEmpty",
          coalesce(delivery.delivery_trips, '[]'::jsonb) as "deliveryTrips"
        from public.orders o
        left join public.customers c on c.id = o.customer_id
        left join public.carriers ca on ca.carrier_id = o.carrier_id
        left join tms.pickup_management pm on pm.order_id = o.order_id
        left join lateral (
          select
            count(*)::int as invoice_count,
            coalesce(sum(i.total_amount), 0) as invoice_total_amount,
            nullif(string_agg(distinct i.invoice_type, ', ' order by i.invoice_type), '') as product_types,
            nullif(string_agg(i.invoice_number, ', ' order by i.invoice_date, i.invoice_number), '') as invoice_numbers
          from public.invoices i
          where i.order_id = o.order_id
        ) inv on true
        left join lateral (
          select
            count(r.receivable_id)::int as receivable_count,
            coalesce(sum(r.receivable_amount), 0) as receivable_amount,
            coalesce(sum(r.allocated_amount), 0) as allocated_amount,
            coalesce(sum(r.balance), 0) as balance_amount
          from public.invoices i
          join public.receivables r on r.invoice_id = i.invoice_id
          where i.order_id = o.order_id
        ) ar on true
        left join lateral (
          select
            count(*)::int as order_detail_count,
            coalesce(sum(quantity), 0) as total_quantity,
            coalesce(sum(estimated_pallets), 0) as total_estimated_pallets
          from public.order_detail
          where order_id = o.order_id
        ) od on true
        left join lateral (
          select
            count(*)::int as appointment_count,
            min(coalesce(confirmed_start, requested_start)) as first_appointment_at,
            max(coalesce(confirmed_start, requested_start)) as last_appointment_at
          from oms.delivery_appointments da
          where da.order_id = o.order_id
             or exists (
               select 1
               from oms.appointment_detail_lines adl
               join public.order_detail od_appointment on od_appointment.id = adl.order_detail_id
               where adl.appointment_id = da.appointment_id
                 and od_appointment.order_id = o.order_id
             )
        ) ap on true
        left join lateral (
          select jsonb_agg(
            jsonb_build_object(
              'appointmentId', da.appointment_id,
              'warehousePoint', coalesce(loc.location_code, detail_loc.location_code, o.delivery_location),
              'deliveryMethod', da.delivery_method,
              'appointmentStatus', da.status,
              'totalPallets', da.total_pallets
            ) order by da.appointment_id
          ) as delivery_trips
          from oms.delivery_appointments da
          left join public.locations loc on loc.location_id = da.location_id
          left join lateral (
            select detail_location.location_code
            from oms.appointment_detail_lines adl
            join public.order_detail od_line on od_line.id = adl.order_detail_id
            left join public.locations detail_location on detail_location.location_id = od_line.delivery_location_id
            where adl.appointment_id = da.appointment_id
            order by adl.id
            limit 1
          ) detail_loc on true
          where (
              da.order_id = o.order_id
              or exists (
                select 1
                from oms.appointment_detail_lines adl_order
                join public.order_detail od_order on od_order.id = adl_order.order_detail_id
                where adl_order.appointment_id = da.appointment_id
                  and od_order.order_id = o.order_id
              )
            )
            and coalesce(da.enabled, true) = true
            and coalesce(da.rejected, false) = false
        ) delivery on true
        left join lateral (
          select
            ir.status,
            ir.planned_unload_at,
            ub.amount as unload_bill_amount
          from wms.inbound_receipt ir
          left join wms.unload_bill ub on ub.inbound_receipt_id = ir.inbound_receipt_id
          where ir.order_id = o.order_id
          limit 1
        ) inbound on true
        where o.order_number ilike $1
        order by
          case when lower(o.order_number) = lower($2) then 0 else 1 end,
          o.order_id desc
        limit 1
      `,
      [search, value]
    );

    return (result.rows[0] || null) as SourceContainerProfile | null;
  });
}

export async function getSourceContainerExpenseFacts(sourceOrderIds: number[], bypassCache = false) {
  const ids = Array.from(new Set(sourceOrderIds.filter((id) => Number.isFinite(id))));
  if (!ids.length) return new Map<number, SourceContainerExpenseFacts>();

  const now = Date.now();
  const combined = new Map<number, SourceContainerExpenseFacts>();
  const missingIds = ids.filter((id) => {
    const cached = sourceExpenseFactCache.get(id);
    if (!bypassCache && cached && cached.expiresAt > now) {
      combined.set(id, cached.value);
      return false;
    }
    return true;
  });
  if (!missingIds.length) return combined;

  const fresh = await withReadonlySource(async (client) => {
    const result = await client.query(
      `
        select
          o.order_id::int as "sourceOrderId",
          exists (
            select 1
            from wms.inbound_receipt rejection_inbound
            where rejection_inbound.order_id = o.order_id
              and rejection_inbound.inbound_source = 'direct_rejection_unload'
          ) as "directRejectionUnload",
          coalesce(pm.pickup_out, false) as "pickupOut",
          coalesce(pm.return_empty, false) as "returnEmpty",
          coalesce(allocation.warehouse_allocations, '[]'::jsonb) as "warehouseAllocations",
          coalesce(method_allocation.method_allocations, '[]'::jsonb) as "methodAllocations",
          coalesce(rejection.rejection_trips, '[]'::jsonb) as "rejectionTrips",
          coalesce(delivery.delivery_trips, '[]'::jsonb) as "deliveryTrips"
        from public.orders o
        left join tms.pickup_management pm on pm.order_id = o.order_id
        left join lateral (
          select jsonb_agg(
            jsonb_build_object(
              'orderDetailId', detail.order_detail_id,
              'warehousePoint', detail.warehouse_point,
              'proportion', detail.proportion,
              'estimatedPallets', detail.estimated_pallets
            ) order by detail.order_detail_id
          ) as warehouse_allocations
          from (
            select
              od.id as order_detail_id,
              coalesce(loc.location_code, loc.name, o.delivery_location) as warehouse_point,
              coalesce(od.estimated_pallets, 0) as estimated_pallets,
              case
                when od.volume_percentage is not null
                  then greatest(od.volume_percentage::numeric, 0) / 100
                when sum(coalesce(od.volume, 0)) over () > 0
                  then greatest(coalesce(od.volume, 0), 0) / sum(coalesce(od.volume, 0)) over ()
                when sum(coalesce(od.estimated_pallets, 0)) over () > 0
                  then greatest(coalesce(od.estimated_pallets, 0), 0) / sum(coalesce(od.estimated_pallets, 0)) over ()
                when count(*) over () = 1 then 1
                else 0
              end as proportion
            from public.order_detail od
            left join public.locations loc on loc.location_id = od.delivery_location_id
            where od.order_id = o.order_id
          ) detail
        ) allocation on true
        left join lateral (
          select jsonb_agg(
            jsonb_build_object(
              'orderDetailId', method_line.order_detail_id,
              'warehousePoint', method_line.warehouse_point,
              'deliveryMethod', method_line.delivery_method,
              'appointmentCount', method_line.appointment_count,
              'appointmentPallets', method_line.appointment_pallets
            ) order by method_line.order_detail_id, method_line.delivery_method
          ) as method_allocations
          from (
            select
              adl.order_detail_id,
              coalesce(loc.location_code, loc.name, o.delivery_location) as warehouse_point,
              da.delivery_method,
              count(distinct da.appointment_id)::int as appointment_count,
              coalesce(sum(greatest(coalesce(adl.estimated_pallets, 0), 0)), 0)::int as appointment_pallets
            from oms.delivery_appointments da
            join oms.appointment_detail_lines adl on adl.appointment_id = da.appointment_id
            join public.order_detail od_method on od_method.id = adl.order_detail_id
            left join public.locations loc on loc.location_id = od_method.delivery_location_id
            where od_method.order_id = o.order_id
              and coalesce(da.enabled, true) = true
              and coalesce(da.rejected, false) = false
              and da.delivery_method in ('卡派', '自提')
            group by adl.order_detail_id,
                     coalesce(loc.location_code, loc.name, o.delivery_location),
                     da.delivery_method
          ) method_line
        ) method_allocation on true
        left join lateral (
          select jsonb_agg(
            jsonb_build_object(
              'warehousePoint', rejected.warehouse_point,
              'deliveryMethod', rejected.delivery_method,
              'rejectionCount', rejected.rejection_count,
              'rejectedPallets', rejected.rejected_pallets
            ) order by rejected.warehouse_point
          ) as rejection_trips
          from (
            select
              coalesce(rr.warehouse_point, loc.location_code, loc.name, o.delivery_location) as warehouse_point,
              coalesce(rr.delivery_method, da_rejection.delivery_method) as delivery_method,
              count(distinct rr.appointment_id)::int as rejection_count,
              coalesce(sum(rr.rejected_pallets), 0)::int as rejected_pallets
            from oms.delivery_rejection_records rr
            left join oms.delivery_appointments da_rejection on da_rejection.appointment_id = rr.appointment_id
            left join public.order_detail od on od.id = rr.order_detail_id
            left join public.locations loc on loc.location_id = od.delivery_location_id
            where (
                rr.order_id = o.order_id
                or od.order_id = o.order_id
                or exists (
                  select 1
                  from oms.appointment_detail_lines adl_rejection
                  join public.order_detail od_rejection on od_rejection.id = adl_rejection.order_detail_id
                  where adl_rejection.appointment_id = rr.appointment_id
                    and od_rejection.order_id = o.order_id
                )
              )
              and rr.active = true
            group by coalesce(rr.warehouse_point, loc.location_code, loc.name, o.delivery_location),
                     coalesce(rr.delivery_method, da_rejection.delivery_method)
          ) rejected
        ) rejection on true
        left join lateral (
          select jsonb_agg(
            jsonb_build_object(
              'appointmentId', da.appointment_id,
              'warehousePoint', coalesce(loc.location_code, detail_loc.location_code, o.delivery_location),
              'deliveryMethod', da.delivery_method,
              'appointmentStatus', da.status,
              'totalPallets', da.total_pallets
            ) order by da.appointment_id
          ) as delivery_trips
          from oms.delivery_appointments da
          left join public.locations loc on loc.location_id = da.location_id
          left join lateral (
            select detail_location.location_code
            from oms.appointment_detail_lines adl
            join public.order_detail od_line on od_line.id = adl.order_detail_id
            left join public.locations detail_location on detail_location.location_id = od_line.delivery_location_id
            where adl.appointment_id = da.appointment_id
            order by adl.id
            limit 1
          ) detail_loc on true
          where (
              da.order_id = o.order_id
              or exists (
                select 1
                from oms.appointment_detail_lines adl_order
                join public.order_detail od_order on od_order.id = adl_order.order_detail_id
                where adl_order.appointment_id = da.appointment_id
                  and od_order.order_id = o.order_id
              )
            )
            and coalesce(da.enabled, true) = true
            and coalesce(da.rejected, false) = false
        ) delivery on true
        where o.order_id = any($1::bigint[])
      `,
      [missingIds]
    );

    return new Map<number, SourceContainerExpenseFacts>(result.rows.map((row) => {
      const deliveryTrips = Array.isArray(row.deliveryTrips)
        ? row.deliveryTrips
        : typeof row.deliveryTrips === "string"
        ? JSON.parse(row.deliveryTrips)
        : [];
      const warehouseAllocations = Array.isArray(row.warehouseAllocations)
        ? row.warehouseAllocations
        : typeof row.warehouseAllocations === "string"
        ? JSON.parse(row.warehouseAllocations)
        : [];
      const methodAllocations = Array.isArray(row.methodAllocations)
        ? row.methodAllocations
        : typeof row.methodAllocations === "string"
        ? JSON.parse(row.methodAllocations)
        : [];
      const rejectionTrips = Array.isArray(row.rejectionTrips)
        ? row.rejectionTrips
        : typeof row.rejectionTrips === "string"
        ? JSON.parse(row.rejectionTrips)
        : [];
      const facts: SourceContainerExpenseFacts = {
        sourceOrderId: Number(row.sourceOrderId),
        directRejectionUnload: Boolean(row.directRejectionUnload),
        pickupOut: Boolean(row.pickupOut),
        returnEmpty: Boolean(row.returnEmpty),
        warehouseAllocations: warehouseAllocations.map((allocation: Record<string, unknown>) => ({
          orderDetailId: Number(allocation.orderDetailId),
          warehousePoint: allocation.warehousePoint ? String(allocation.warehousePoint) : null,
          proportion: Number(allocation.proportion || 0),
          estimatedPallets: Number(allocation.estimatedPallets || 0)
        })),
        methodAllocations: methodAllocations.map((allocation: Record<string, unknown>) => ({
          orderDetailId: Number(allocation.orderDetailId),
          warehousePoint: allocation.warehousePoint ? String(allocation.warehousePoint) : null,
          deliveryMethod: allocation.deliveryMethod ? String(allocation.deliveryMethod) : null,
          appointmentCount: Number(allocation.appointmentCount || 0),
          appointmentPallets: Number(allocation.appointmentPallets || 0)
        })),
        rejectionTrips: rejectionTrips.map((trip: Record<string, unknown>) => ({
          warehousePoint: trip.warehousePoint ? String(trip.warehousePoint) : null,
          deliveryMethod: trip.deliveryMethod ? String(trip.deliveryMethod) : null,
          rejectionCount: Number(trip.rejectionCount || 0),
          rejectedPallets: Number(trip.rejectedPallets || 0)
        })),
        deliveryTrips: deliveryTrips.map((trip: Record<string, unknown>) => ({
          appointmentId: Number(trip.appointmentId),
          warehousePoint: trip.warehousePoint ? String(trip.warehousePoint) : null,
          deliveryMethod: trip.deliveryMethod ? String(trip.deliveryMethod) : null,
          appointmentStatus: trip.appointmentStatus ? String(trip.appointmentStatus) : null,
          totalPallets: Number(trip.totalPallets || 0)
        }))
      };
      return [facts.sourceOrderId, facts];
    }));
  });

  fresh.forEach((value, sourceOrderId) => {
    sourceExpenseFactCache.set(sourceOrderId, {
      expiresAt: now + SOURCE_FACT_CACHE_TTL_MS,
      value
    });
    combined.set(sourceOrderId, value);
  });
  return combined;
}

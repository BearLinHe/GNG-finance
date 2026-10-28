import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import type { SavAccountingInput, SavGoodsInput, SavIncomeCategory, SavIncomeLine, SavTripInput } from "./sav-accounting-types";
import { SavRuntimeError, savRuntimeError } from "./sav-runtime-error";

export type SavSourceFilters = {
  dateFrom?: string; dateTo?: string; search?: string; customer?: string;
  scope?: "all" | "excel"; operationMode?: string; page?: number; pageSize?: number;
  // Server-only CSV export option; ordinary URL queries always remain paged.
  allRows?: boolean;
};
export type SavSourceSnapshot = {
  input: SavAccountingInput;
  snapshotAt: string;
  source: "CoreFlow SAV";
  scope: "all" | "excel";
  notes: string[];
  selection: { containerCount: number; goodsCount: number; tripCount: number };
  pagination: { page: number; pageSize: number; totalCount: number; totalPages: number };
  operationModes: Array<{ operationMode: string; count: number }>;
};

const globalSav = globalThis as typeof globalThis & { gngSavSourcePool?: Pool };
const MAX_GOODS = 30000;
const cancelled = /^(cancelled|canceled|void|voided|取消|已取消|作废)$/i;
const n = (value: unknown): number | null => value == null ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const text = (value: unknown): string | null => value == null || String(value).trim() === "" ? null : String(value).trim();
const day = (value: unknown): string | null => value instanceof Date ? value.toISOString().slice(0, 10) : text(value)?.slice(0, 10) || null;

function envValue(source: string, key: string): string | undefined {
  const match = source.match(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)$`, "m"));
  if (!match) return undefined;
  const raw = match[1].trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) return raw.slice(1, -1);
  return raw.replace(/\s+#.*$/, "").trim();
}

function savInstance(raw: string | undefined): string | undefined {
  const pair = raw?.split(",").map(value => value.trim()).find(value => value.slice(0, value.indexOf("=")).trim() === "SAV仓库");
  return pair?.slice(pair.indexOf("=") + 1).trim();
}

async function connectionString() {
  if (process.env.SAV_DATABASE_URL) return process.env.SAV_DATABASE_URL;
  const directInstance = savInstance(process.env.DB_INSTANCES);
  if (directInstance) return directInstance;
  // This development fallback only reads CoreFlow's configuration. Production
  // deployments should supply SAV_DATABASE_URL using a read-only database user.
  const configured = process.env.CORE_FLOW_ENV_PATH;
  const candidates = configured ? [configured] : [path.resolve(process.cwd(), "../G-G_CoreFlow_ERP/.env.local")];
  for (const candidate of candidates) {
    try {
      const source = await readFile(candidate, "utf8");
      const url = savInstance(envValue(source, "DB_INSTANCES")) || envValue(source, "DATABASE_URL_SAV");
      if (url) return url;
    } catch { /* Missing local configuration is reported without disclosing its contents. */ }
  }
  throw new SavRuntimeError("SAV_SOURCE_NOT_CONFIGURED", "source");
}

async function withSavReadonly<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!globalSav.gngSavSourcePool) {
    const url = await connectionString();
    globalSav.gngSavSourcePool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 15000, ssl: { rejectUnauthorized: true } });
  }
  let client: PoolClient | undefined;
  try {
    client = await globalSav.gngSavSourcePool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '25s'");
    const result = await fn(client);
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof SavSourceInputError) throw error;
    throw savRuntimeError("source", error);
  } finally { client?.release(); }
}

export class SavSourceInputError extends Error {}

function validatedFilters(filters: SavSourceFilters) {
  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  for (const date of [filters.dateFrom, filters.dateTo]) if (date && !isDate(date)) throw new SavSourceInputError("日期格式必须为有效的 YYYY-MM-DD。");
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) throw new SavSourceInputError("开始日期不能晚于结束日期。");
  if ((filters.search?.length || 0) > 150 || (filters.customer?.length || 0) > 150) throw new SavSourceInputError("搜索内容过长。");
  if (filters.scope !== undefined && !["all", "excel"].includes(filters.scope)) throw new SavSourceInputError("核算范围无效。");
  if ((filters.operationMode?.length || 0) > 50) throw new SavSourceInputError("业务类型无效。");
  if (filters.page !== undefined && (!Number.isInteger(filters.page) || filters.page < 1 || filters.page > 100000000)) throw new SavSourceInputError("页码无效。");
  if (filters.pageSize !== undefined && (!Number.isInteger(filters.pageSize) || filters.pageSize < 1 || filters.pageSize > 300)) throw new SavSourceInputError("每页最多300柜。");
  if (filters.allRows !== undefined && typeof filters.allRows !== "boolean") throw new SavSourceInputError("导出范围无效。");
  return { ...filters, scope: filters.scope || "all", page: filters.page || 1, pageSize: filters.pageSize || 100 };
}

// Keep the Excel scope: private/non-Amazon cargo, including Walmart and pickup.
// Amazon cargo can still be loaded below as external members of the same trip,
// so its pallets remain in the allocation denominator.
const privateDetail = `(coalesce(dl.location_type,'') <> 'amazon' AND (
  od.delivery_nature = '私仓'
  OR (od.delivery_nature IN ('扣货','已放行') AND dl.location_type IN ('warehouse','composite','walmart'))
))`;

const locationAddress = (alias: string) => `nullif(concat_ws(', ',${alias}.address_line1,${alias}.address_line2,${alias}.city,${alias}.state,${alias}.postal_code),'')`;

type DeliveryRow = {
  line_id: string; order_id: string; detail_id: string; loaded_pallets: number; rejected_pallets: number | null;
  appointment_id: string; delivery_id: string | null; group_id: string | null; delivery_method: string | null;
  delivery_date: Date | string | null; delivery_status: string | null; appointment_status: string | null;
  enabled: boolean | null; reference_number: string | null; location_id: string | null; warehouse_point: string | null;
  address: string | null; miles: string | null; is_private: boolean; original_point: string | null; original_address: string | null;
};

const deliverySelect = `SELECT adl.id::text line_id,od.order_id::text,od.id::text detail_id,
  adl.estimated_pallets loaded_pallets, adl.rejected_pallets,
  da.appointment_id::text,dm.delivery_id::text,dm.trip_group_id group_id,
  da.delivery_method,coalesce(da.confirmed_start,da.requested_start) delivery_date,
  dm.status delivery_status,da.status appointment_status,da.enabled,da.reference_number,
  al.location_id::text,coalesce(al.location_code,al.name) warehouse_point,
  ${locationAddress("al")} address,al.distance::text miles,${privateDetail} is_private,
  coalesce(dl.location_code,dl.name) original_point,${locationAddress("dl")} original_address
  FROM oms.appointment_detail_lines adl
  JOIN public.order_detail od ON od.id=adl.order_detail_id
  JOIN oms.delivery_appointments da ON da.appointment_id=adl.appointment_id
  LEFT JOIN tms.delivery_management dm ON dm.appointment_id=da.appointment_id
  LEFT JOIN public.locations dl ON dl.location_id=od.delivery_location_id
  LEFT JOIN public.locations al ON al.location_id=da.location_id`;

export function classifySavIncome(feeCode: string | null, feeName: string | null, scope: "all" | "excel" = "excel"): SavIncomeCategory {
  const code = String(feeCode || "").trim().toLowerCase().replace(/[ _-]+/g, " ");
  const name = String(feeName || "").trim();
  if (code === "delivery" || name === "派送费") return "delivery";
  if (code === "pallets out" || name === "出库费") return "labor";
  if (scope === "all" && (code === "待补价" || /^待补价/.test(name))) return "unclassified";
  if (scope === "all") return "other";
  if (["terminal pick up", "chassis", "all in", "extended location fee", "overweight", "storage", "others", "over case", "intercept", "danger", "chassis split", "split", "labeling"].includes(code)
    || /^(亚马逊组合柜|手工定价)/.test(String(feeCode || ""))
    || /(提拆|车架|仓储|超仓|超箱|超重|拦截|危险品|全包|尾板|其他费用|分货费|贴标费)/.test(name)) return "excluded";
  return "unclassified";
}

function active(row: DeliveryRow) {
  return row.enabled !== false && !cancelled.test(row.delivery_status || "") && !cancelled.test(row.appointment_status || "");
}

export type SavInvoiceSourceRow = {
  id: string | null; invoice_id: string; container_id: string; invoice_number: string;
  invoice_status: string | null; invoice_type: string; currency: string | null;
  header_amount: string | null; manual_total_amount: boolean | null;
  fee_code: string | null; fee_name: string | null; line_amount: string | null;
  line_notes: string | null; line_status: string | null;
};

export function savInvoiceIncomeLines(invoices: SavInvoiceSourceRow[], scope: "all" | "excel"): SavIncomeLine[] {
  const lines: SavIncomeLine[] = [];
  const headers = new Map<string, SavInvoiceSourceRow[]>();
  for (const line of invoices) {
    const rows = headers.get(line.invoice_id) || [];
    rows.push(line); headers.set(line.invoice_id, rows);
    if (!line.id) continue;
    const currency = (line.currency || "USD").toUpperCase();
    const category = classifySavIncome(line.fee_code, line.fee_name, scope);
    lines.push({ id: line.id, containerId: line.container_id,
      category: currency !== "USD" && category !== "excluded" ? "unclassified" : category,
      amount: currency === "USD" ? n(line.line_amount) : null,
      label: `${line.fee_code || ""} ${line.fee_name || ""}`.trim() || "账单项目",
      sourceReference: `CoreFlow ${line.invoice_number}（${line.invoice_type}；${line.invoice_status || "未填"}）；费用明细 #${line.id}；${currency}${line.line_notes ? `；${line.line_notes}` : ""}` });
  }
  if (scope === "excel") return lines;
  for (const [invoiceId, rows] of headers) {
    const header = rows[0];
    const currency = (header.currency || "USD").toUpperCase();
    const detail = rows.filter(row => row.id !== null);
    const total = n(header.header_amount);
    if (!detail.length) {
      lines.push({ id: `invoice:${invoiceId}:total`, containerId: header.container_id,
        category: currency === "USD" && total !== null ? "other" : "unclassified",
        amount: currency === "USD" ? total : null, label: "账单总额（无有效明细）",
        sourceReference: `CoreFlow ${header.invoice_number}（${header.invoice_type}；${header.invoice_status || "未填"}）；账单 #${invoiceId}；${currency}` });
    } else if (total === null || detail.some(row => n(row.line_amount) === null)) {
      // An incomplete detail is already visible as a null line. Keep an absent
      // header total visible too rather than treating an unknown amount as zero.
      if (total === null) lines.push({ id: `invoice:${invoiceId}:missing-total`, containerId: header.container_id,
        category: "unclassified", amount: null, label: "账单总额缺失", sourceReference: `CoreFlow ${header.invoice_number}；账单 #${invoiceId}` });
    } else {
      const difference = Math.round((total - detail.reduce((sum, row) => sum + n(row.line_amount)!, 0)) * 100) / 100;
      if (difference !== 0) lines.push({ id: `invoice:${invoiceId}:adjustment`, containerId: header.container_id,
        category: currency === "USD" ? "other" : "unclassified", amount: currency === "USD" ? difference : null,
        label: header.manual_total_amount ? "账单手工总额调整" : "账单总额与有效明细差额",
        sourceReference: `CoreFlow ${header.invoice_number}；账单 #${invoiceId}；以账单总额${total} ${currency}核对，不重复叠加` });
    }
  }
  return lines;
}

export async function getSavSourceAccounting(rawFilters: SavSourceFilters = {}): Promise<SavSourceSnapshot> {
  const filters = validatedFilters(rawFilters);
  return withSavReadonly(async client => {
    const clock = (await client.query<{ snapshot_at: Date; today: string }>("SELECT CURRENT_TIMESTAMP snapshot_at, to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York','YYYY-MM-DD') today")).rows[0];
    const scopeWhere = filters.scope === "excel"
      ? `AND o.operation_mode='unload' AND coalesce(o.status,'') NOT IN ('cancelled','canceled','已取消')
         AND EXISTS(SELECT 1 FROM public.order_detail od LEFT JOIN public.locations dl ON dl.location_id=od.delivery_location_id WHERE od.order_id=o.order_id AND ${privateDetail})`
      : "";
    const orderWhere = `o.warehouse_id=1
      AND ($1::date IS NULL OR o.pickup_date >= $1::date)
      AND ($2::date IS NULL OR o.pickup_date < $2::date + interval '1 day')
      AND ($3='' OR o.order_number ILIKE '%'||$3||'%' OR c.name ILIKE '%'||$3||'%')
      AND ($4='' OR c.name ILIKE '%'||$4||'%') ${scopeWhere}`;
    const values = [filters.dateFrom || null, filters.dateTo || null, filters.search?.trim() || "", filters.customer?.trim() || ""];
    const operationModes = (await client.query<{ operationMode: string; count: number }>(`SELECT coalesce(nullif(o.operation_mode,''),'__none__') AS "operationMode",count(*)::int AS count
      FROM public.orders o LEFT JOIN public.customers c ON c.id=o.customer_id WHERE ${orderWhere}
      GROUP BY coalesce(nullif(o.operation_mode,''),'__none__') ORDER BY count DESC,"operationMode"`, values)).rows;
    const requestedMode = filters.operationMode && filters.operationMode !== "all" ? filters.operationMode : null;
    const totalCount = operationModes.reduce((sum, mode) => sum + (!requestedMode || mode.operationMode === requestedMode ? mode.count : 0), 0);
    const totalPages = filters.allRows ? 1 : Math.max(1, Math.ceil(totalCount / filters.pageSize));
    const page = filters.allRows ? 1 : Math.min(filters.page, totalPages);
    const pagination = { page, pageSize: filters.allRows ? Math.max(totalCount, 1) : filters.pageSize, totalCount, totalPages };
    const orders = (await client.query<{
      id: string; container_number: string; customer_name: string | null; pickup_date: Date | null; status: string | null; operation_mode: string | null; order_date: Date;
    }>(`SELECT o.order_id::text id,o.order_number container_number,c.name customer_name,o.pickup_date,o.status,o.operation_mode,o.order_date
      FROM public.orders o LEFT JOIN public.customers c ON c.id=o.customer_id
      WHERE ${orderWhere} AND ($5::text IS NULL OR coalesce(nullif(o.operation_mode,''),'__none__')=$5)
      ORDER BY o.order_date DESC NULLS LAST,o.order_id DESC LIMIT $6 OFFSET $7`,
      [...values, requestedMode, filters.allRows ? null : filters.pageSize, (page - 1) * filters.pageSize])).rows;
    const ids = orders.map(order => order.id);
    const selectedIds = new Set(ids);
    const containers: SavAccountingInput["containers"] = orders.map(order => ({ id: order.id, containerNumber: order.container_number, customerName: order.customer_name, pickupDate: day(order.pickup_date), status: order.status, operationMode: order.operation_mode, orderDate: day(order.order_date) }));
    if (!ids.length) return { input: { containers, goods: [], trips: [], incomeLines: [] }, snapshotAt: clock.snapshot_at.toISOString(), source: "CoreFlow SAV", scope: filters.scope, notes: ["筛选范围内没有 SAV 订单。"], selection: { containerCount: 0, goodsCount: 0, tripCount: 0 }, pagination, operationModes };

    const privateWhere = filters.scope === "excel" ? `AND ${privateDetail}` : "";
    const seeds = (await client.query<DeliveryRow>(`${deliverySelect} WHERE od.order_id=ANY($1::bigint[]) ${privateWhere} ORDER BY adl.id LIMIT $2`, [ids, MAX_GOODS + 1])).rows;
    const groups = [...new Set(seeds.filter(active).map(row => row.group_id).filter((value): value is string => Boolean(value)))];
    const appointments = [...new Set(seeds.filter(active).map(row => row.appointment_id))];
    const members = appointments.length ? (await client.query<DeliveryRow>(`${deliverySelect} WHERE da.appointment_id=ANY($1::bigint[]) OR dm.trip_group_id=ANY($2::text[]) ORDER BY adl.id LIMIT $3`, [appointments, groups, MAX_GOODS + 1])).rows : [];
    const all = [...new Map([...seeds, ...members].filter(active).map(row => [row.line_id, row])).values()];
    if (seeds.length > MAX_GOODS || members.length > MAX_GOODS || all.length > MAX_GOODS) throw new SavSourceInputError("货物明细过多，请缩小提柜日期范围。");

    const inputGoods: SavGoodsInput[] = [];
    const tripRows = new Map<string, DeliveryRow[]>();
    for (const row of all) {
      const tripId = row.group_id ? `group:${row.group_id}` : `appointment:${row.appointment_id}`;
      const date = day(row.delivery_date);
      const status = !date || date > clock.today ? "pending" : "transport";
      const point = row.original_point || row.warehouse_point;
      // External cargo is retained only as denominator evidence, never added to
      // selected containers' displayed private-cargo expenses.
      const containerId = filters.scope === "excel" && selectedIds.has(row.order_id) && !row.is_private ? `external:${row.order_id}` : row.order_id;
      inputGoods.push({ id: row.line_id, containerId, orderDetailId: row.detail_id, tripId, method: row.delivery_method || "未确认", loadedPallets: n(row.loaded_pallets), rejectedPallets: n(row.rejected_pallets) ?? 0, status, allocationOrder: Number(row.line_id), warehousePoint: point, address: row.original_address || row.address, deliveryDate: date, sourceReference: `CoreFlow 预约明细 #${row.line_id}；预约 #${row.appointment_id} ${row.reference_number || ""}；送仓 #${row.delivery_id || "未生成"}；状态 ${row.delivery_status || row.appointment_status || "未填"}` });
      const list = tripRows.get(tripId) || []; list.push(row); tripRows.set(tripId, list);
    }
    const trips: SavTripInput[] = [...tripRows].map(([id, rows]) => {
      const stops = [...new Map(rows.map(row => [row.appointment_id, row])).values()];
      const distances = stops.map(row => n(row.miles));
      const addresses = stops.map(row => row.address?.toLowerCase().replace(/[^a-z0-9]/g, "") || (row.location_id ? `location:${row.location_id}` : null));
      return { id, miles: distances.some(value => value == null || value < 0) ? null : Math.max(...distances as number[]), stopCount: addresses.some(value => !value) ? null : new Set(addresses).size, sourceReference: `CoreFlow 送仓趟次 ${id}；里程取目的地资料 distance（单程英里）；按实际卸货地址去重；未设置同车趟次的预约单独计价` };
    });

    const details = (await client.query<{ id: string; order_id: string; estimated_pallets: number | null; actual_pallets: string | null; point: string | null; address: string | null; notes: string | null }>(`SELECT od.id::text,od.order_id::text,od.estimated_pallets,
      (SELECT CASE WHEN count(*)>0 AND count(il.pallet_count)=count(*) THEN sum(il.pallet_count)::text ELSE NULL END
        FROM wms.inventory_lots il WHERE il.order_detail_id=od.id AND coalesce(il.status,'') NOT IN ('cancelled','canceled','已取消','void')) actual_pallets,
      coalesce(dl.location_code,dl.name) point,${locationAddress("dl")} address,od.notes
      FROM public.order_detail od LEFT JOIN public.locations dl ON dl.location_id=od.delivery_location_id
      WHERE od.order_id=ANY($1::bigint[]) ${privateWhere}`, [ids])).rows;
    const goodsByDetail = new Map<string, SavGoodsInput[]>();
    for (const goods of inputGoods) {
      if (!goods.orderDetailId) continue;
      const group = goodsByDetail.get(goods.orderDetailId) || [];
      group.push(goods); goodsByDetail.set(goods.orderDetailId, group);
    }
    for (const detail of details) {
      const actual = n(detail.actual_pallets) ?? n(detail.estimated_pallets);
      const related = goodsByDetail.get(detail.id) || [];
      const committedNet = related.reduce((sum, goods) => sum + Math.max((goods.loadedPallets || 0) - (goods.rejectedPallets || 0), 0), 0);
      const remaining = actual == null ? null : Math.max(actual - committedNet, 0);
      if (remaining === 0) continue;
      const actualStockKnown = n(detail.actual_pallets) !== null;
      inputGoods.push({ id: `stock:${detail.id}`, containerId: detail.order_id, orderDetailId: detail.id, tripId: null, method: "未预约", loadedPallets: remaining, rejectedPallets: 0, status: actualStockKnown ? "in_stock" : "pending", warehousePoint: detail.point, address: detail.address, sourceReference: `CoreFlow 订单明细 #${detail.id}；${actualStockKnown ? "实际库存板数减有效预约净板数，推算未预约余量" : "未填实际库存；预计板数减有效预约净板数，货物状态待确认"}` });
    }

    const invoices = (await client.query<SavInvoiceSourceRow>(`SELECT l.id::text,i.invoice_id::text,i.order_id::text container_id,i.invoice_number,i.status invoice_status,i.invoice_type,i.currency,
      i.total_amount::text header_amount,i.manual_total_amount,l.fee_code,l.fee_name,l.total_amount::text line_amount,l.line_notes,l.status line_status
      FROM public.invoices i LEFT JOIN public.invoice_line_items l ON l.invoice_id=i.invoice_id
        AND lower(trim(coalesce(l.status,''))) NOT IN ('void','voided','cancelled','canceled','作废','已取消')
      WHERE i.order_id=ANY($1::bigint[]) AND lower(trim(coalesce(i.status,''))) NOT IN ('void','voided','cancelled','canceled','作废','已取消')
      ORDER BY i.invoice_id,l.id`, [ids])).rows;
    const incomeLines = savInvoiceIncomeLines(invoices, filters.scope);
    const pendingTrips = trips.filter(trip => trip.miles == null).length;
    return {
      input: { containers, goods: inputGoods, trips, incomeLines }, snapshotAt: clock.snapshot_at.toISOString(), source: "CoreFlow SAV", scope: filters.scope,
      notes: [
        filters.scope === "excel"
          ? "范围：Excel私仓口径，SAV拆柜订单中私仓及非亚马逊扣货／已放行货物；同趟范围外货物仍参与分摊。"
          : "范围：CoreFlow SAV 仓库（warehouse_id=1）全部订单，包括拆柜、直送、亚马逊、未分类、无货物明细及未填提柜日期订单；归档、取消订单也列出并保留原状态。",
        filters.scope === "excel"
          ? "收入沿用 Excel 核对口径：仅派送费 Delivery 和出库费 Pallets Out；分货、贴标、提拆、组合柜、仓储等费用排除。未知费用保留为待分类。"
          : "收入归集本柜全部有效USD账单，包含拆柜、直送、仓储及负数账单；账单总额与有效明细有差异时以单独调整行对齐。其他币种待核对，不直接折算为美元。",
        "查询不受Excel历史日期限制；金额汇总仅为当前页，全部匹配订单可翻页查看。同趟跨页、跨柜的货物仍共同参与成本分摊。",
        "包含未作废的草稿账单。收入属于系统账单记录，不代表已收款；账单号及状态可在收入明细追溯。",
        "有效且已到预约日期的送仓记录用于计价，planned 状态同样保留；未来或未定日期的预约为待核对，不代表已实际付款。",
        "无同车趟次的预约按单趟计算；未预约余量按实际／预计板数减有效预约净板数推算。缺少实际库存的余量列为待核对；Excel 人工确认的在库及退运状态未直接回写系统。",
        "LTL 当前未找到可用的系统承运账单金额，保留待确认；自提按原装运板数每板 $10 测算。",
        ...(pendingTrips ? [`${pendingTrips} 个关联趟次有目的地里程缺失，相关运输成本保持待确认。`] : [])
      ],
      selection: { containerCount: containers.length, goodsCount: inputGoods.filter(goods => selectedIds.has(goods.containerId)).length, tripCount: trips.length },
      pagination, operationModes
    };
  });
}

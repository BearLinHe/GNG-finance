"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable
} from "@tanstack/react-table";
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleDollarSign,
  Calculator,
  ClipboardList,
  Database,
  Layers3,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Truck,
  X,
  XCircle
} from "lucide-react";
import { money } from "@/lib/money";
import OperatingStandards, { type StandardCategory } from "./operating-standards";
import OakTransportAccounting from "./oak-transport-accounting";

type TabKey = "initial" | "container" | "fees";
type AccountingModule = "external" | "oak-transport";
type FeeOrigin = "source" | "legacy" | "system";
type InitialBillKind = "unload" | "direct_delivery";
type InitialDateField = "orderDate" | "etaDate" | "pickupDate" | "unloadDate" | "returnDeadline";

type SourceOperationMode = {
  operationMode: string;
  count: number;
  invoiceCount: number;
};

type InitialPricingLine = {
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
  appliedFeeId: number | null;
  appliedSourceFeeId: number | null;
  appliedFeeCode: string | null;
  appliedFeeName: string | null;
  appliedUnitPrice: number;
  appliedCustomerName: string | null;
  appliedContainerType: string | null;
  pricingSource: "system" | "source" | "disabled" | "unmatched";
};

type SourceInvoiceSummary = {
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

type InitialBillRow = {
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
  pricingLines: InitialPricingLine[];
  totalCount: number;
};

type ContainerProfile = {
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
};

type ContainerAmountItem = {
  id: number;
  source_order_id: number;
  container_number: string;
  amount_type: "receivable" | "expense";
  expense_category: ExpenseCategory | null;
  item_name: string;
  amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type ExpenseCategory = "transport" | "warehouse" | "domestic" | "other";

type ContainerProfitSummary = {
  income: {
    label: string;
    amount: number;
    source: "initial_bill" | "system_bill" | "not_found";
    billId: number | null;
  };
  expenses: Array<{
    key: ExpenseCategory;
    label: string;
    amount: number;
    lineCount: number;
    source: string;
  }>;
  totalExpense: number;
  netProfit: number;
  expenseLines: Array<{
    key: string;
    category: "transport" | "warehouse" | "domestic";
    standardName: string;
    condition: string;
    warehousePoint: string | null;
    quantity: number;
    unitAmount: number;
    amount: number;
    matched: boolean;
  }>;
};

type ContainerProfitRow = InitialBillRow & {
  directRejectionUnload: boolean;
  incomeAmount: number;
  expenses: ContainerProfitSummary["expenses"];
  expenseLines: ContainerProfitSummary["expenseLines"];
  expenseAmount: number;
  netProfit: number;
  unmatchedExpenseCount: number;
};

type ContainerProfitPageSummary = {
  income: number;
  expense: number;
  profit: number;
  profitableCount: number;
  lossCount: number;
  breakEvenCount: number;
};

const emptyContainerProfitPageSummary: ContainerProfitPageSummary = {
  income: 0,
  expense: 0,
  profit: 0,
  profitableCount: 0,
  lossCount: 0,
  breakEvenCount: 0
};

type InitialBillsResponse = {
  initialBills: InitialBillRow[];
  totalCount: number;
  operationModes: SourceOperationMode[];
};

type ContainerProfitsResponse = {
  rows: ContainerProfitRow[];
  totalCount: number;
  pageSummary: ContainerProfitPageSummary;
};

const initialBillsCache = new Map<string, InitialBillsResponse>();
const containerProfitsCache = new Map<string, ContainerProfitsResponse>();

function rememberResponse<T>(cache: Map<string, T>, key: string, value: T) {
  cache.set(key, value);
  if (cache.size > 30) cache.delete(cache.keys().next().value as string);
}

type AmountForm = {
  id: number | null;
  amountType: "receivable" | "expense";
  expenseCategory: ExpenseCategory;
  itemName: string;
  amount: string;
  notes: string;
};

type SourceFee = {
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
  customerCode: string | null;
  customerName: string | null;
  sourceIsActive: boolean | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  description: string | null;
  notes: string | null;
  updatedAt: string | null;
  totalCount: number;
  localFeeId: number | null;
  localUnitPrice: number | null;
  localIsActive: boolean | null;
};

type SystemFee = {
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

type FeeRow = SourceFee | SystemFee;

type FeeForm = {
  id: number | null;
  sourceFeeId: number | null;
  sourceOrigin: string;
  sourceStandardId: number | null;
  sourceStandardPriceId: number | null;
  feeCode: string;
  feeName: string;
  unit: string;
  unitPrice: string;
  currency: string;
  scopeType: string;
  customerName: string;
  containerType: string;
  effectiveDate: string;
  expirationDate: string;
  description: string;
  isActive: boolean;
};

const emptyFeeForm: FeeForm = {
  id: null,
  sourceFeeId: null,
  sourceOrigin: "manual",
  sourceStandardId: null,
  sourceStandardPriceId: null,
  feeCode: "",
  feeName: "",
  unit: "",
  unitPrice: "0",
  currency: "USD",
  scopeType: "all",
  customerName: "",
  containerType: "",
  effectiveDate: "",
  expirationDate: "",
  description: "",
  isActive: true
};

const emptyAmountForm = (): AmountForm => ({
  id: null,
  amountType: "expense",
  expenseCategory: "transport",
  itemName: "",
  amount: "0",
  notes: ""
});

const sourceInvoiceStatusLabels: Record<string, string> = {
  draft: "草稿",
  issued: "已开票",
  audited: "已审核",
  void: "作废"
};

const sourceInvoiceTypeLabels: Record<string, string> = {
  unload: "拆柜",
  direct_delivery: "直送",
  storage: "仓储",
  penalty: "负数账单"
};

const receivableStatusLabels: Record<string, string> = {
  open: "未结清",
  partial: "部分核销",
  closed: "已结清"
};

const scopeLabels: Record<string, string> = {
  all: "所有客户",
  customers: "指定客户"
};

const amountTypeLabels: Record<string, string> = {
  receivable: "应收",
  expense: "支出"
};

const expenseCategoryLabels: Record<ExpenseCategory, string> = {
  transport: "运输支出",
  warehouse: "仓库支出",
  domestic: "国内支出",
  other: "其他支出"
};

const operatingExpenseCategories: ExpenseCategory[] = ["transport", "warehouse", "domestic"];

const incomeSourceLabels: Record<ContainerProfitSummary["income"]["source"], string> = {
  initial_bill: "源系统有效账单汇总",
  system_bill: "来自系统账单",
  not_found: "未找到初始账单"
};

const operationModeLabels: Record<string, string> = {
  unload: "拆柜",
  direct_delivery: "直送"
};

const initialBillKinds: InitialBillKind[] = ["unload", "direct_delivery"];

const initialDateFieldLabels: Record<InitialDateField, string> = {
  orderDate: "订单日期",
  etaDate: "ETA 日期",
  pickupDate: "提柜日期",
  unloadDate: "拆柜日期",
  returnDeadline: "还空日期"
};

function formatDate(value: string | null) {
  if (!value) return "-";
  const datePart = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (datePart) {
    return `${datePart[2]}/${datePart[3]}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", timeZone: "UTC" });
}

function activeSourceInvoices(invoices: SourceInvoiceSummary[]) {
  return invoices.filter((invoice) => invoice.invoiceStatus !== "void");
}

function sourceWorkflowSummary(invoices: SourceInvoiceSummary[]) {
  const active = activeSourceInvoices(invoices);
  if (!active.length) return { label: "无有效账单", detail: "-", status: "empty" };

  const counts = new Map<string, number>();
  active.forEach((invoice) => counts.set(invoice.invoiceStatus, (counts.get(invoice.invoiceStatus) || 0) + 1));
  const detail = Array.from(counts.entries())
    .map(([status, count]) => `${sourceInvoiceStatusLabels[status] || status} ${count}`)
    .join(" / ");
  const firstStatus = active[0].invoiceStatus;
  return counts.size === 1
    ? {
        label: `${sourceInvoiceStatusLabels[firstStatus] || firstStatus}${active.length > 1 ? ` ×${active.length}` : ""}`,
        detail,
        status: firstStatus
      }
    : { label: "混合状态", detail, status: "mixed" };
}

function sourceSettlementSummary(invoices: SourceInvoiceSummary[]) {
  const active = activeSourceInvoices(invoices);
  const statuses = active
    .map((invoice) => invoice.receivableStatus)
    .filter((status): status is NonNullable<SourceInvoiceSummary["receivableStatus"]> => Boolean(status));
  if (!statuses.length) return { label: "未进入应收", status: "none" };
  if (statuses.length === active.length && statuses.every((status) => status === "closed")) {
    return { label: "已结清", status: "closed" };
  }
  if (statuses.some((status) => status === "partial" || status === "closed")) {
    return { label: "部分核销", status: "partial" };
  }
  return { label: "未结清", status: "open" };
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

function isSourceFee(fee: FeeRow): fee is SourceFee {
  return "sourceFeeId" in fee;
}

function feeKey(fee: FeeRow) {
  return isSourceFee(fee) ? `${fee.sourceType}-${fee.sourceFeeId}` : `system-${fee.id}`;
}

function feeToForm(fee: FeeRow): FeeForm {
  if (isSourceFee(fee)) {
    return {
      id: fee.localFeeId || null,
      sourceFeeId: fee.sourceType === "legacy_fee" ? fee.sourceFeeId : null,
      sourceOrigin: fee.sourceType,
      sourceStandardId: fee.sourceStandardId,
      sourceStandardPriceId: fee.sourceStandardPriceId,
      feeCode: fee.feeCode,
      feeName: fee.feeName,
      unit: fee.unit || "",
      unitPrice: String(fee.localUnitPrice ?? fee.unitPrice ?? 0),
      currency: fee.currency || "USD",
      scopeType: fee.scopeType || "all",
      customerName: fee.customerName || "",
      containerType: fee.containerType || "",
      effectiveDate: fee.effectiveDate?.slice(0, 10) || "",
      expirationDate: fee.expirationDate?.slice(0, 10) || "",
      description: fee.notes || fee.description || "",
      isActive: fee.localIsActive ?? true
    };
  }

  return {
    id: fee.id,
    sourceFeeId: fee.source_fee_id,
    sourceOrigin: fee.source_origin || "manual",
    sourceStandardId: fee.source_standard_id,
    sourceStandardPriceId: fee.source_standard_price_id,
    feeCode: fee.fee_code,
    feeName: fee.fee_name,
    unit: fee.unit || "",
    unitPrice: String(fee.unit_price ?? 0),
    currency: fee.currency || "USD",
    scopeType: fee.scope_type || "all",
    customerName: fee.customer_name || "",
    containerType: fee.container_type || "",
    effectiveDate: fee.effective_date?.slice(0, 10) || "",
    expirationDate: fee.expiration_date?.slice(0, 10) || "",
    description: fee.description || "",
    isActive: fee.is_active
  };
}

function feeDisplay(fee: FeeRow) {
  if (isSourceFee(fee)) {
    return {
      code: fee.feeCode,
      name: fee.feeName,
      unit: fee.unit,
      price: fee.localUnitPrice ?? fee.unitPrice,
      originalPrice: fee.unitPrice,
      currency: fee.currency,
      scope: fee.scopeType,
      customer: fee.customerName || fee.customerCode,
      containerType: fee.containerType,
      effectiveDate: fee.effectiveDate,
      expirationDate: fee.expirationDate,
      description: fee.notes || fee.description,
      sourceOrigin: fee.sourceType,
      isActive: fee.localIsActive ?? true,
      isManaged: Boolean(fee.localFeeId)
    };
  }

  return {
    code: fee.fee_code,
    name: fee.fee_name,
    unit: fee.unit,
    price: fee.unit_price,
    originalPrice: fee.unit_price,
    currency: fee.currency,
    scope: fee.scope_type,
    customer: fee.customer_name,
    containerType: fee.container_type,
    effectiveDate: fee.effective_date,
    expirationDate: fee.expiration_date,
    description: fee.description,
    sourceOrigin: fee.source_origin,
    isActive: fee.is_active,
    isManaged: true
  };
}

function feeStatusLabel(fee: FeeRow) {
  if (isSourceFee(fee)) {
    if (fee.localFeeId) return "已复制";
    return fee.sourceType === "standard_price" ? "源标准价" : "旧费用";
  }

  return fee.is_active ? "启用" : "停用";
}

type DataTableProps<T> = {
  data: T[];
  columns: ColumnDef<T>[];
  emptyText?: string;
  emptyColSpan?: number;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  tableClassName?: string;
};

function DataTable<T>({
  data,
  columns,
  emptyText = "暂无数据",
  emptyColSpan,
  onRowClick,
  rowClassName,
  tableClassName
}: DataTableProps<T>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel()
  });

  const headerGroups = table.getHeaderGroups();
  const rows = table.getRowModel().rows;

  return (
    <table className={tableClassName}>
      <thead>
        {headerGroups.map((headerGroup) => (
          <tr key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <th key={header.id}>
                {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            className={rowClassName?.(row.original)}
            onClick={onRowClick ? () => onRowClick(row.original) : undefined}
          >
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
            ))}
          </tr>
        ))}
        {!rows.length ? (
          <tr>
            <td colSpan={emptyColSpan || columns.length} className="muted">
              {emptyText}
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

export default function Home() {
  const [activeModule, setActiveModule] = useState<AccountingModule>("external");
  const [externalNavExpanded, setExternalNavExpanded] = useState(true);
  const [tab, setTab] = useState<TabKey>("initial");
  const [search, setSearch] = useState("");
  const [containerSearch, setContainerSearch] = useState("");
  const [containerCustomerFilter, setContainerCustomerFilter] = useState("");
  const [containerDateField, setContainerDateField] = useState<InitialDateField>("orderDate");
  const [containerDateFrom, setContainerDateFrom] = useState("");
  const [containerDateTo, setContainerDateTo] = useState("");
  const [initialKind, setInitialKind] = useState<InitialBillKind>("unload");
  const [containerKind, setContainerKind] = useState<InitialBillKind>("unload");
  const [standardCategory, setStandardCategory] = useState<StandardCategory>("transport");
  const [initialContainerFilter, setInitialContainerFilter] = useState("");
  const [initialCustomerFilter, setInitialCustomerFilter] = useState("");
  const [initialProductFilter, setInitialProductFilter] = useState("");
  const [initialDateField, setInitialDateField] = useState<InitialDateField>("orderDate");
  const [initialDateFrom, setInitialDateFrom] = useState("");
  const [initialDateTo, setInitialDateTo] = useState("");
  const [feeOrigin, setFeeOrigin] = useState<FeeOrigin>("source");
  const [feeScopeFilter, setFeeScopeFilter] = useState("");
  const [feePage, setFeePage] = useState(1);
  const [feePageSize, setFeePageSize] = useState(50);
  const [initialPage, setInitialPage] = useState(1);
  const [initialPageSize, setInitialPageSize] = useState(100);
  const [containerPage, setContainerPage] = useState(1);
  const [containerPageSize, setContainerPageSize] = useState(100);
  const [initialRows, setInitialRows] = useState<InitialBillRow[]>([]);
  const [initialTotalCount, setInitialTotalCount] = useState(0);
  const [containerProfitRows, setContainerProfitRows] = useState<ContainerProfitRow[]>([]);
  const [containerProfitTotalCount, setContainerProfitTotalCount] = useState(0);
  const [containerProfitPageSummary, setContainerProfitPageSummary] = useState<ContainerProfitPageSummary>(emptyContainerProfitPageSummary);
  const [selectedContainerProfit, setSelectedContainerProfit] = useState<ContainerProfitRow | null>(null);
  const [operationModes, setOperationModes] = useState<SourceOperationMode[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [expandedNav, setExpandedNav] = useState<"source" | "standards" | "profit" | null>("source");
  const [selectedInitialRow, setSelectedInitialRow] = useState<InitialBillRow | null>(null);
  const [expandedProductRows, setExpandedProductRows] = useState<Set<number>>(new Set());
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [feeTotalCount, setFeeTotalCount] = useState(0);
  const [containerProfile, setContainerProfile] = useState<ContainerProfile | null>(null);
  const [containerProfitSummary, setContainerProfitSummary] = useState<ContainerProfitSummary | null>(null);
  const [containerItems, setContainerItems] = useState<ContainerAmountItem[]>([]);
  const [feeForm, setFeeForm] = useState<FeeForm>(emptyFeeForm);
  const [amountForm, setAmountForm] = useState<AmountForm>(emptyAmountForm());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const initialLoadSeq = useRef(0);
  const containerLoadSeq = useRef(0);

  async function loadInitialBills(page = initialPage, pageSize = initialPageSize, force = false) {
    const requestId = initialLoadSeq.current + 1;
    initialLoadSeq.current = requestId;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });
      if (initialContainerFilter.trim()) params.set("containerNumber", initialContainerFilter.trim());
      if (initialCustomerFilter.trim()) params.set("customerName", initialCustomerFilter.trim());
      if (initialProductFilter.trim()) params.set("productType", initialProductFilter.trim());
      if (initialDateFrom || initialDateTo) {
        params.set("dateField", initialDateField);
        if (initialDateFrom) params.set("dateFrom", initialDateFrom);
        if (initialDateTo) params.set("dateTo", initialDateTo);
      }
      params.set("operationMode", initialKind);
      const cacheKey = params.toString();
      const cached = initialBillsCache.get(cacheKey);
      if (force) params.set("refresh", "1");
      const data = cached && !force
        ? cached
        : await readJson<InitialBillsResponse>(await fetch(`/api/initial-bills?${params}`));
      if (requestId !== initialLoadSeq.current) return;
      if (!cached || force) rememberResponse(initialBillsCache, cacheKey, data);
      setInitialRows(data.initialBills);
      setInitialTotalCount(data.totalCount);
      setOperationModes(data.operationModes);
      setInitialPage(page);
      setInitialPageSize(pageSize);
      setSelectedInitialRow((current) => {
        if (!current) return null;
        return data.initialBills.find((row) => row.sourceOrderId === current.sourceOrderId) || null;
      });
    } catch (err) {
      if (requestId !== initialLoadSeq.current) return;
      setError(err instanceof Error ? err.message : "读取初始账单失败");
    } finally {
      if (requestId === initialLoadSeq.current) {
        setLoading(false);
      }
    }
  }

  async function loadFees(origin = feeOrigin, page = feePage, pageSize = feePageSize) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        origin,
        search,
        page: String(page),
        pageSize: String(pageSize)
      });
      if (feeScopeFilter) params.set("scopeType", feeScopeFilter);
      const data = await readJson<{ fees: FeeRow[]; totalCount: number }>(await fetch(`/api/fees?${params}`));
      setFees(data.fees);
      setFeeTotalCount(data.totalCount);
      setFeePage(page);
      setFeePageSize(pageSize);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取费用失败");
    } finally {
      setLoading(false);
    }
  }

  async function loadContainerProfits(page = containerPage, pageSize = containerPageSize, force = false) {
    const requestId = containerLoadSeq.current + 1;
    containerLoadSeq.current = requestId;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        search: containerSearch.trim(),
        operationMode: containerKind,
        page: String(page),
        pageSize: String(pageSize)
      });
      if (containerCustomerFilter.trim()) params.set("customerName", containerCustomerFilter.trim());
      if (containerDateFrom || containerDateTo) {
        params.set("dateField", containerDateField);
        if (containerDateFrom) params.set("dateFrom", containerDateFrom);
        if (containerDateTo) params.set("dateTo", containerDateTo);
      }
      const cacheKey = params.toString();
      const cached = containerProfitsCache.get(cacheKey);
      if (force) params.set("refresh", "1");
      const data = cached && !force
        ? cached
        : await readJson<ContainerProfitsResponse>(await fetch(`/api/container-profits?${params}`));
      if (requestId !== containerLoadSeq.current) return;
      if (!cached || force) rememberResponse(containerProfitsCache, cacheKey, data);
      setContainerProfitRows(data.rows);
      setContainerProfitTotalCount(data.totalCount);
      setContainerProfitPageSummary(data.pageSummary);
      setContainerPage(page);
      setContainerPageSize(pageSize);
      setSelectedContainerProfit((current) => {
        if (!current) return null;
        return data.rows.find((row) => row.sourceOrderId === current.sourceOrderId) || null;
      });
    } catch (err) {
      if (requestId !== containerLoadSeq.current) return;
      setError(err instanceof Error ? err.message : "读取单柜盈亏失败");
    } finally {
      if (requestId === containerLoadSeq.current) setLoading(false);
    }
  }

  async function loadContainerProfile(query = containerSearch) {
    const value = query.trim();
    if (!value) {
      setError("请输入柜号");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ containerNumber: value });
      const data = await readJson<{
        profile: ContainerProfile | null;
        items: ContainerAmountItem[];
        profitSummary?: ContainerProfitSummary;
      }>(
        await fetch(`/api/container-profile?${params}`)
      );
      setContainerProfile(data.profile);
      setContainerItems(data.items);
      setContainerProfitSummary(data.profitSummary || null);
      if (!data.profile) {
        setContainerProfitSummary(null);
        setError("源数据库没有找到这个柜号");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取柜号信息失败");
    } finally {
      setLoading(false);
    }
  }

  async function loadCurrentTab(force = false) {
    if (activeModule !== "external") return;
    if (tab === "initial") return loadInitialBills(initialPage, initialPageSize, force);
    if (tab === "container") return loadContainerProfits(containerPage, containerPageSize, force);
    return loadFees();
  }

  async function saveFee() {
    setLoading(true);
    setError("");
    try {
      const payload = {
        sourceFeeId: feeForm.sourceFeeId,
        sourceOrigin: feeForm.sourceOrigin,
        sourceStandardId: feeForm.sourceStandardId,
        sourceStandardPriceId: feeForm.sourceStandardPriceId,
        feeCode: feeForm.feeCode,
        feeName: feeForm.feeName,
        unit: feeForm.unit,
        unitPrice: feeForm.unitPrice,
        currency: feeForm.currency,
        scopeType: feeForm.scopeType,
        customerName: feeForm.customerName,
        containerType: feeForm.containerType,
        effectiveDate: feeForm.effectiveDate,
        expirationDate: feeForm.expirationDate,
        description: feeForm.description,
        isActive: feeForm.isActive
      };
      const url = feeForm.id ? `/api/fees/${feeForm.id}` : "/api/fees";
      const method = feeForm.id ? "PATCH" : "POST";
      await readJson<{ fee: SystemFee }>(
        await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
      );
      setFeeOrigin("system");
      await loadFees("system", 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存费用失败");
    } finally {
      setLoading(false);
    }
  }

  async function saveAmountItem() {
    if (!containerProfile) {
      setError("请先查询柜号");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const payload = {
        sourceOrderId: containerProfile.sourceOrderId,
        containerNumber: containerProfile.containerNumber,
        amountType: amountForm.amountType,
        expenseCategory: amountForm.amountType === "expense" ? amountForm.expenseCategory : null,
        itemName: amountForm.itemName,
        amount: amountForm.amount,
        notes: amountForm.notes
      };
      const url = amountForm.id ? `/api/container-amount-items/${amountForm.id}` : "/api/container-amount-items";
      const method = amountForm.id ? "PATCH" : "POST";
      await readJson<{ item: ContainerAmountItem }>(
        await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
      );
      setAmountForm(emptyAmountForm());
      await loadContainerProfile(containerProfile.containerNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存盈收明细失败");
    } finally {
      setLoading(false);
    }
  }

  async function deleteAmountItem(id: number) {
    if (!containerProfile) return;

    setLoading(true);
    setError("");
    try {
      await readJson<{ id: number }>(
        await fetch(`/api/container-amount-items/${id}`, {
          method: "DELETE"
        })
      );
      await loadContainerProfile(containerProfile.containerNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除盈收明细失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (activeModule !== "external" || tab !== "container") return;
    const timeout = window.setTimeout(() => {
      void loadContainerProfits(containerPage, containerPageSize);
    }, 300);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeModule,
    tab,
    containerSearch,
    containerCustomerFilter,
    containerDateField,
    containerDateFrom,
    containerDateTo,
    containerKind,
    containerPage,
    containerPageSize
  ]);

  useEffect(() => {
    if (activeModule !== "external" || tab !== "initial") {
      return;
    }
    const timeout = window.setTimeout(() => {
      void loadInitialBills(initialPage, initialPageSize);
    }, 250);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeModule,
    tab,
    initialPage,
    initialPageSize,
    initialKind,
    initialContainerFilter,
    initialCustomerFilter,
    initialProductFilter,
    initialDateField,
    initialDateFrom,
    initialDateTo
  ]);

  useEffect(() => {
    if (!selectedInitialRow) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedInitialRow(null);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedInitialRow]);

  useEffect(() => {
    if (!selectedContainerProfit) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedContainerProfit(null);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedContainerProfit]);

  const initialTotals = useMemo(() => {
    return initialRows.reduce(
      (acc, row) => {
        const activeInvoices = activeSourceInvoices(row.sourceInvoices);
        acc.invoiceCount += activeInvoices.length;
        acc.voidCount += row.sourceInvoices.length - activeInvoices.length;
        if (sourceSettlementSummary(row.sourceInvoices).status === "closed") acc.settledContainers += 1;
        return acc;
      },
      { invoiceCount: 0, voidCount: 0, settledContainers: 0 }
    );
  }, [initialRows]);

  const operationModeCounts = useMemo(() => {
    return new Map(operationModes.map((item) => [item.operationMode, item.count]));
  }, [operationModes]);

  const operationModeInvoiceCounts = useMemo(() => {
    return new Map(operationModes.map((item) => [item.operationMode, item.invoiceCount]));
  }, [operationModes]);

  const containerExpenseRows = useMemo(() => {
    return (containerProfitSummary?.expenses.filter((item) => operatingExpenseCategories.includes(item.key)) || operatingExpenseCategories.map((key) => ({
      key,
      label: expenseCategoryLabels[key],
      amount: 0,
      lineCount: 0,
      source: "manual_framework"
    })));
  }, [containerProfitSummary]);

  const pageTitle =
    activeModule === "oak-transport"
      ? "OAK 运输部核算"
      : tab === "initial"
      ? "源库账单"
      : tab === "container"
      ? `${operationModeLabels[containerKind]}单柜盈亏`
      : tab === "fees"
      ? `${expenseCategoryLabels[standardCategory]}标准`
      : "支出标准";
  const pageSubtitle =
    activeModule === "oak-transport"
      ? ""
      : tab === "initial"
      ? "按柜号汇总源系统全部有效账单，包含拆柜、直送、仓储及负数账单"
      : tab === "container"
      ? `${operationModeLabels[containerKind]}柜收入汇总全部有效账单，支出按适用条件自动匹配标准`
      : tab === "fees"
      ? `维护${expenseCategoryLabels[standardCategory]}的固定标准与月度费用`
      : "维护运输、仓库和国内支出的计费标准与适用条件";

  const initialTotalPages = Math.max(1, Math.ceil(initialTotalCount / initialPageSize));
  const initialPageStart = initialTotalCount === 0 ? 0 : (initialPage - 1) * initialPageSize + 1;
  const initialPageEnd = Math.min(initialPage * initialPageSize, initialTotalCount);
  const containerTotalPages = Math.max(1, Math.ceil(containerProfitTotalCount / containerPageSize));
  const containerPageStart = containerProfitTotalCount === 0 ? 0 : (containerPage - 1) * containerPageSize + 1;
  const containerPageEnd = Math.min(containerPage * containerPageSize, containerProfitTotalCount);
  const feeTotalPages = Math.max(1, Math.ceil(feeTotalCount / feePageSize));
  const feePageStart = feeTotalCount === 0 ? 0 : (feePage - 1) * feePageSize + 1;
  const feePageEnd = Math.min(feePage * feePageSize, feeTotalCount);

  const initialColumns = useMemo<ColumnDef<InitialBillRow>[]>(() => [
    {
      header: "海柜",
      cell: ({ row }) => (
        <div className="container-cell">
          <strong>{row.original.containerNumber}</strong>
          <span>{row.original.customerName || "未关联客户"}</span>
        </div>
      )
    },
    {
      header: "订单 / ETA",
      cell: ({ row }) => (
        <div className="date-pair">
          <span><small>订单</small>{formatDate(row.original.orderDate)}</span>
          <span><small>ETA</small>{formatDate(row.original.etaDate)}</span>
        </div>
      )
    },
    {
      header: "提柜 / 还柜",
      cell: ({ row }) => (
        <div className="date-pair">
          <span><small>提柜</small>{formatDate(row.original.pickupDate)}</span>
          <span><small>还柜</small>{formatDate(row.original.returnDeadline)}</span>
        </div>
      )
    },
    { header: "柜型", cell: ({ row }) => row.original.containerType || "-" },
    {
      header: "产品",
      cell: ({ row }) => {
        const products = (row.original.productTypes || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        const isExpanded = expandedProductRows.has(row.original.sourceOrderId);
        const visibleProducts = isExpanded ? products : products.slice(0, 2);

        if (!products.length) return <span className="muted">-</span>;

        return (
          <div className={`product-cell ${isExpanded ? "expanded" : ""}`}>
            <div className="product-chips">
              {visibleProducts.map((product) => (
                <span className="product-chip" key={product}>{product}</span>
              ))}
              {!isExpanded && products.length > visibleProducts.length ? (
                <span className="product-more">+{products.length - visibleProducts.length}</span>
              ) : null}
              {products.length > 2 ? (
                <button
                  className="product-toggle"
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpandedProductRows((current) => {
                      const next = new Set(current);
                      if (next.has(row.original.sourceOrderId)) {
                        next.delete(row.original.sourceOrderId);
                      } else {
                        next.add(row.original.sourceOrderId);
                      }
                      return next;
                    });
                  }}
                >
                  {isExpanded ? "收起" : "展开"}
                </button>
              ) : null}
            </div>
          </div>
        );
      }
    },
    {
      header: "源账单总额",
      cell: ({ row }) => {
        const activeCount = activeSourceInvoices(row.original.sourceInvoices).length;
        return (
          <div className="amount-cell">
            <strong>{money(row.original.sourceInvoiceTotalAmount)}</strong>
            <span className="source-invoice-count">{activeCount} 张有效账单</span>
          </div>
        );
      }
    },
    {
      header: "源系统状态",
      cell: ({ row }) => {
        const workflow = sourceWorkflowSummary(row.original.sourceInvoices);
        const settlement = sourceSettlementSummary(row.original.sourceInvoices);
        return (
          <div className="source-status-cell" title={workflow.detail}>
            <span className={`invoice-status-badge ${workflow.status}`}>{workflow.label}</span>
            <span className={`settlement-label ${settlement.status}`}>{settlement.label}</span>
          </div>
        );
      }
    }
  ], [expandedProductRows]);

  const containerProfitColumns = useMemo<ColumnDef<ContainerProfitRow>[]>(() => [
    {
      header: "海柜",
      cell: ({ row }) => (
        <div className="container-cell">
          <strong>{row.original.containerNumber}</strong>
          <span>{row.original.customerName || "未关联客户"}</span>
        </div>
      )
    },
    {
      header: "业务信息",
      cell: ({ row }) => (
        <div className="profit-order-meta">
          <span className={row.original.directRejectionUnload ? "profit-mode-tag rejection-unload" : "profit-mode-tag"}>
            {row.original.directRejectionUnload
              ? "直送拒收改拆"
              : operationModeLabels[row.original.operationMode || ""] || row.original.operationMode || "-"}
          </span>
          <small>{formatDate(row.original.orderDate)} · {row.original.containerType || "-"}</small>
        </div>
      )
    },
    {
      header: "账单收入",
      cell: ({ row }) => (
        <div className="amount-cell income-amount">
          <strong>{money(row.original.incomeAmount)}</strong>
          <span>{activeSourceInvoices(row.original.sourceInvoices).length} 张有效账单</span>
        </div>
      )
    },
    {
      header: "匹配支出",
      cell: ({ row }) => (
        <div className="amount-cell expense-amount">
          <strong>{money(row.original.expenseAmount)}</strong>
          <span>{row.original.expenseLines.filter((line) => line.matched).length} 条支出标准</span>
        </div>
      )
    },
    {
      header: "净盈亏",
      cell: ({ row }) => (
        <div className={`profit-value ${row.original.netProfit >= 0 ? "positive" : "negative"}`}>
          <strong>{money(row.original.netProfit)}</strong>
          <span>收入 - 支出</span>
        </div>
      )
    },
    {
      header: "账单状态",
      cell: ({ row }) => {
        const workflow = sourceWorkflowSummary(row.original.sourceInvoices);
        const settlement = sourceSettlementSummary(row.original.sourceInvoices);
        return (
          <div className="source-status-cell" title={workflow.detail}>
            <span className={`invoice-status-badge ${workflow.status}`}>{workflow.label}</span>
            <span className={`settlement-label ${settlement.status}`}>{settlement.label}</span>
          </div>
        );
      }
    },
  ], []);

  const amountColumns = useMemo<ColumnDef<ContainerAmountItem>[]>(() => [
    { header: "类型", cell: ({ row }) => amountTypeLabels[row.original.amount_type] },
    {
      header: "支出分类",
      cell: ({ row }) => row.original.amount_type === "expense"
        ? expenseCategoryLabels[row.original.expense_category || "other"]
        : "-"
    },
    { header: "金额名目", cell: ({ row }) => row.original.item_name },
    { header: "金额", cell: ({ row }) => <span className="cell-number">{money(row.original.amount)}</span> },
    { header: "备注", cell: ({ row }) => row.original.notes || "-" },
    {
      header: "操作",
      cell: ({ row }) => (
        <div className="row-actions">
          <button
            className="button ghost"
            onClick={() => setAmountForm({
              id: row.original.id,
              amountType: row.original.amount_type,
              expenseCategory: row.original.expense_category || "other",
              itemName: row.original.item_name,
              amount: String(row.original.amount),
              notes: row.original.notes || ""
            })}
          >
            <Pencil size={16} />
            编辑
          </button>
          <button className="button danger" onClick={() => deleteAmountItem(row.original.id)}>
            <Trash2 size={16} />
            删除
          </button>
        </div>
      )
    }
  ], [deleteAmountItem]);

  const expenseLineColumns = useMemo<ColumnDef<ContainerProfitSummary["expenseLines"][number]>[]>(() => [
    {
      header: "支出分类",
      cell: ({ row }) => expenseCategoryLabels[row.original.category]
    },
    { header: "匹配标准", accessorKey: "standardName" },
    { header: "满足条件", accessorKey: "condition" },
    { header: "仓点", cell: ({ row }) => row.original.warehousePoint || "-" },
    { header: "单价", cell: ({ row }) => <span className="cell-number">{money(row.original.unitAmount)}</span> },
    { header: "数量", cell: ({ row }) => <span className="cell-number">{row.original.quantity}</span> },
    { header: "支出金额", cell: ({ row }) => <strong className="cell-number">{money(row.original.amount)}</strong> },
    {
      header: "匹配状态",
      cell: ({ row }) => <span className={`badge ${row.original.matched ? "approved" : "unmatched"}`}>{row.original.matched ? "已匹配" : "缺少标准"}</span>
    }
  ], []);

  const feeColumns = useMemo<ColumnDef<FeeRow>[]>(() => [
    { header: "费用编码", cell: ({ row }) => feeDisplay(row.original).code },
    { header: "费用名称", cell: ({ row }) => feeDisplay(row.original).name },
    {
      header: "单价",
      cell: ({ row }) => {
        const item = feeDisplay(row.original);
        return (
          <span className="cell-number">
            {money(item.price)}
            {isSourceFee(row.original) && item.isManaged ? <span className="muted"> 已复制</span> : null}
          </span>
        );
      }
    },
    { header: "单位", cell: ({ row }) => feeDisplay(row.original).unit || "-" },
    { header: "归属范围", cell: ({ row }) => <span className="badge">{scopeLabels[feeDisplay(row.original).scope] || feeDisplay(row.original).scope}</span> },
    { header: "客户名称", cell: ({ row }) => feeDisplay(row.original).customer || "-" },
    { header: "柜型", cell: ({ row }) => feeDisplay(row.original).containerType || "-" },
    {
      header: "有效期",
      cell: ({ row }) => {
        const item = feeDisplay(row.original);
        return item.effectiveDate || item.expirationDate
          ? `${item.effectiveDate?.slice(0, 10) || "-"} - ${item.expirationDate?.slice(0, 10) || "-"}`
          : "-";
      }
    },
    { header: "说明", cell: ({ row }) => feeDisplay(row.original).description || "-" },
    { header: "状态", cell: ({ row }) => feeStatusLabel(row.original) },
    {
      header: "操作",
      cell: ({ row }) => (
        <button className="button ghost" onClick={() => setFeeForm(feeToForm(row.original))}>
          <Pencil size={16} />
          {isSourceFee(row.original) && !feeDisplay(row.original).isManaged ? "复制编辑" : "编辑"}
        </button>
      )
    }
  ], []);

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">G</div>
          <div className="brand-copy">
            <strong>GNG价格核算</strong>
            <span>Cost Accounting</span>
          </div>
          <button
            className="sidebar-toggle"
            type="button"
            onClick={() => setSidebarCollapsed((value) => !value)}
            title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            {sidebarCollapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}
          </button>
        </div>
        <nav className="side-nav" aria-label="核算模块">
          <div className="nav-section">
            <div className="nav-section-label">核算工作台</div>
            <button
              type="button"
              className={`nav-item nav-module ${activeModule === "external" ? "active" : ""}`}
              onClick={() => {
                setExternalNavExpanded((expanded) => activeModule !== "external" || sidebarCollapsed || !expanded);
                setActiveModule("external");
                if (sidebarCollapsed) setSidebarCollapsed(false);
              }}
              title="对外单柜核算"
              aria-label="对外单柜核算"
              aria-expanded={externalNavExpanded && !sidebarCollapsed}
              aria-controls="external-accounting-nav"
            >
              <span className="nav-icon"><Calculator size={18} /></span>
              <span className="nav-label">对外单柜核算</span>
              <span className="nav-parent-caret">{externalNavExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
            </button>
            {externalNavExpanded ? <div className="nav-module-content" id="external-accounting-nav">
            <button
              className={`nav-item nav-parent ${tab === "initial" ? "active" : ""}`}
              onClick={() => {
                setTab("initial");
                setExpandedNav((current) => current === "source" ? null : "source");
              }}
              title="源库账单"
              aria-expanded={expandedNav === "source"}
              aria-controls="source-bill-nav"
            >
              <span className="nav-icon"><Database size={18} /></span>
              <span className="nav-label">源库账单</span>
              <span className="nav-parent-caret">{expandedNav === "source" ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
            </button>
            {expandedNav === "source" ? <div className="nav-submenu" id="source-bill-nav">
              {initialBillKinds.map((kind) => (
                <button
                  key={kind}
                  className={`nav-subitem ${tab === "initial" && initialKind === kind ? "active" : ""}`}
                  onClick={() => {
                    setTab("initial");
                    setExpandedNav("source");
                    setInitialKind(kind);
                    setInitialPage(1);
                  }}
                >
                  <span className="subitem-title">{operationModeLabels[kind]}</span>
                  <span className="kind-counts">
                    <strong>订单：{operationModeCounts.get(kind) || 0}</strong>
                    <small>账单：{operationModeInvoiceCounts.get(kind) || 0}</small>
                  </span>
                </button>
              ))}
            </div> : null}

            <button
              className={`nav-item nav-parent ${tab === "fees" ? "active" : ""}`}
              onClick={() => {
                setTab("fees");
                setExpandedNav((current) => current === "standards" ? null : "standards");
              }}
              title="支出标准"
              aria-expanded={expandedNav === "standards"}
              aria-controls="expense-standard-nav"
            >
              <span className="nav-icon"><Pencil size={18} /></span>
              <span className="nav-label">支出标准</span>
              <span className="nav-parent-caret">{expandedNav === "standards" ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
            </button>
            {expandedNav === "standards" ? <div className="nav-submenu standards-submenu" id="expense-standard-nav">
              {(["transport", "warehouse", "domestic"] as StandardCategory[]).map((category) => (
                <button
                  key={category}
                  className={`nav-subitem ${tab === "fees" && standardCategory === category ? "active" : ""}`}
                  onClick={() => {
                    setTab("fees");
                    setExpandedNav("standards");
                    setStandardCategory(category);
                  }}
                >
                  <span className="subitem-title">{expenseCategoryLabels[category]}</span>
                </button>
              ))}
            </div> : null}

            <button
              className={`nav-item nav-parent ${tab === "container" ? "active" : ""}`}
              onClick={() => {
                setTab("container");
                setExpandedNav((current) => current === "profit" ? null : "profit");
              }}
              title="单柜盈亏"
              aria-expanded={expandedNav === "profit"}
              aria-controls="container-profit-nav"
            >
              <span className="nav-icon"><CircleDollarSign size={18} /></span>
              <span className="nav-label">单柜盈亏</span>
              <span className="nav-parent-caret">{expandedNav === "profit" ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
            </button>
            {expandedNav === "profit" ? <div className="nav-submenu profit-submenu" id="container-profit-nav">
              {initialBillKinds.map((kind) => (
                <button
                  key={kind}
                  className={`nav-subitem ${tab === "container" && containerKind === kind ? "active" : ""}`}
                  onClick={() => {
                    setTab("container");
                    setExpandedNav("profit");
                    setContainerKind(kind);
                    setContainerPage(1);
                    setSelectedContainerProfit(null);
                  }}
                >
                  <span className="subitem-title">{operationModeLabels[kind]}</span>
                  <span className="kind-counts single">
                    <strong>柜号：{operationModeCounts.get(kind) || 0}</strong>
                  </span>
                </button>
              ))}
            </div> : null}
            </div> : null}
            <button
              type="button"
              className={`nav-item nav-module ${activeModule === "oak-transport" ? "active" : ""}`}
              onClick={() => {
                setActiveModule("oak-transport");
                setExternalNavExpanded(false);
                setSelectedInitialRow(null);
                setSelectedContainerProfit(null);
              }}
              title="OAK 运输部核算"
              aria-label="OAK 运输部核算"
              aria-current={activeModule === "oak-transport" ? "page" : undefined}
            >
              <span className="nav-icon"><Truck size={18} /></span>
              <span className="nav-label">OAK 运输部核算</span>
            </button>
          </div>
        </nav>
      </aside>

      <div className="content-shell">
        <header className="topbar">
          <div className="topbar-title">
            {activeModule === "external" ? <><span className="topbar-module">对外单柜核算</span><ChevronRight size={14} aria-hidden="true" /></> : null}
            <span>{pageTitle}</span>
          </div>
          <div className="top-actions">
            {activeModule === "external" && tab !== "fees" ? <button className="button ghost" onClick={() => void loadCurrentTab(true)} disabled={loading}>
              <RefreshCw size={16} />
              刷新
            </button> : null}
          </div>
        </header>

        <main className="main table-workspace-main">
        <div className="page-head">
          <div>
            <h1 className="page-title">{pageTitle}</h1>
            {pageSubtitle ? <p className="page-subtitle">{pageSubtitle}</p> : null}
          </div>
        </div>

        {activeModule === "oak-transport" ? <OakTransportAccounting /> : <>
        {tab === "fees" ? <OperatingStandards category={standardCategory} /> : null}

        {tab === "fees" ? null : tab === "initial" ? (
          <div className="toolbar initial-toolbar">
            <div className="field">
              <label>柜号</label>
              <input
                value={initialContainerFilter}
                onChange={(event) => {
                  setInitialContainerFilter(event.target.value);
                  setInitialPage(1);
                }}
                placeholder="例如 EGSU3254242"
              />
            </div>
            <div className="field">
              <label>客户</label>
              <input
                value={initialCustomerFilter}
                onChange={(event) => {
                  setInitialCustomerFilter(event.target.value);
                  setInitialPage(1);
                }}
                placeholder="客户名称"
              />
            </div>
            <div className="field">
              <label>日期类型</label>
              <select
                value={initialDateField}
                onChange={(event) => {
                  setInitialDateField(event.target.value as InitialDateField);
                  setInitialPage(1);
                }}
              >
                {Object.entries(initialDateFieldLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>开始日期</label>
              <input
                type="date"
                value={initialDateFrom}
                onChange={(event) => {
                  setInitialDateFrom(event.target.value);
                  setInitialPage(1);
                }}
              />
            </div>
            <div className="field">
              <label>结束日期</label>
              <input
                type="date"
                value={initialDateTo}
                onChange={(event) => {
                  setInitialDateTo(event.target.value);
                  setInitialPage(1);
                }}
              />
            </div>
            <div className="field action-field">
              <label>&nbsp;</label>
              <button
                className="button ghost"
                onClick={() => {
                  setInitialContainerFilter("");
                  setInitialCustomerFilter("");
                  setInitialProductFilter("");
                  setInitialDateField("orderDate");
                  setInitialDateFrom("");
                  setInitialDateTo("");
                  setInitialPage(1);
                }}
                disabled={loading}
              >
                <XCircle size={16} />
                清空
              </button>
            </div>
          </div>
        ) : (
          <div className="toolbar initial-toolbar container-profit-toolbar">
            <div className="field">
              <label>柜号 / 产品</label>
              <div className="search-input-wrap">
                <Search size={16} />
                <input
                  value={containerSearch}
                  onChange={(event) => {
                    setContainerSearch(event.target.value);
                    setContainerPage(1);
                  }}
                  placeholder="柜号或仓点"
                />
              </div>
            </div>
            <div className="field">
              <label>客户</label>
              <input
                value={containerCustomerFilter}
                onChange={(event) => {
                  setContainerCustomerFilter(event.target.value);
                  setContainerPage(1);
                }}
                placeholder="客户名称"
              />
            </div>
            <div className="field">
              <label>日期类型</label>
              <select
                value={containerDateField}
                onChange={(event) => {
                  setContainerDateField(event.target.value as InitialDateField);
                  setContainerPage(1);
                }}
              >
                {Object.entries(initialDateFieldLabels).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>开始日期</label>
              <input
                type="date"
                value={containerDateFrom}
                onChange={(event) => {
                  setContainerDateFrom(event.target.value);
                  setContainerPage(1);
                }}
              />
            </div>
            <div className="field">
              <label>结束日期</label>
              <input
                type="date"
                value={containerDateTo}
                onChange={(event) => {
                  setContainerDateTo(event.target.value);
                  setContainerPage(1);
                }}
              />
            </div>
            <div className="field action-field">
              <label>&nbsp;</label>
              <button
                className="button ghost"
                onClick={() => {
                  setContainerSearch("");
                  setContainerCustomerFilter("");
                  setContainerDateField("orderDate");
                  setContainerDateFrom("");
                  setContainerDateTo("");
                  setContainerPage(1);
                }}
                disabled={loading || (!containerSearch && !containerCustomerFilter && !containerDateFrom && !containerDateTo)}
              >
                <XCircle size={16} />
                清空
              </button>
            </div>
          </div>
        )}

        {tab !== "fees" && error ? <div className="error">{error}</div> : null}

        {tab === "initial" ? (
          <div className="initial-overview">
            <div className="overview-item">
              <ClipboardList size={18} />
              <span>源库订单<strong>{initialTotalCount.toLocaleString()}</strong></span>
            </div>
            <div className="overview-item">
              <Layers3 size={18} />
              <span>源系统账单<strong>{(operationModeInvoiceCounts.get(initialKind) || 0).toLocaleString()}</strong></span>
            </div>
            <div className="overview-status">
              <span><i className="success" />有效账单 {initialTotals.invoiceCount}</span>
              <span><i className="success" />已结清 {initialTotals.settledContainers} 柜</span>
              {initialTotals.voidCount ? <span><i className="warning" />作废 {initialTotals.voidCount}</span> : null}
            </div>
          </div>
        ) : null}

        {tab === "container" ? (
          <div className="profit-overview">
            <div className="profit-overview-item">
              <span>柜号总数</span>
              <strong>{containerProfitTotalCount.toLocaleString()}</strong>
              <small>符合当前搜索</small>
            </div>
            <div className="profit-overview-item income">
              <span>本页账单收入</span>
              <strong>{money(containerProfitPageSummary.income)}</strong>
              <small>全部有效源系统账单</small>
            </div>
            <div className="profit-overview-item expense">
              <span>本页匹配支出</span>
              <strong>{money(containerProfitPageSummary.expense)}</strong>
              <small>按支出标准自动计算</small>
            </div>
            <div className={`profit-overview-item result ${containerProfitPageSummary.profit >= 0 ? "positive" : "negative"}`}>
              <span>本页净盈亏</span>
              <strong>{money(containerProfitPageSummary.profit)}</strong>
              <small>盈利 {containerProfitPageSummary.profitableCount} · 亏损 {containerProfitPageSummary.lossCount} · 持平 {containerProfitPageSummary.breakEvenCount}</small>
            </div>
          </div>
        ) : null}

        {tab !== "fees" ? <div className={`grid ${tab === "initial" ? "initial-grid" : tab === "container" ? "container-profit-grid" : ""}`}>
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">
                {tab === "initial" ? `${operationModeLabels[initialKind]}订单` : tab === "container" ? "单柜盈亏明细" : "费用列表"}
              </h2>
              {tab === "initial" ? (
                <span className="panel-context">第 {initialPage} / {initialTotalPages} 页</span>
              ) : tab === "container" ? (
                <span className="panel-context">第 {containerPage} / {containerTotalPages} 页</span>
              ) : loading ? <span className="muted">处理中</span> : null}
            </div>
            <div className="table-wrap">
              {tab === "initial" ? (
                <DataTable
                  data={initialRows}
                  columns={initialColumns}
                  emptyText="暂无初始账单"
                  onRowClick={setSelectedInitialRow}
                  rowClassName={(row) => (selectedInitialRow?.sourceOrderId === row.sourceOrderId ? "selected" : "")}
                  tableClassName="initial-table"
                />
              ) : null}

              {tab === "container" ? (
                <DataTable
                  data={containerProfitRows}
                  columns={containerProfitColumns}
                  emptyText={loading ? "正在计算单柜盈亏..." : "没有符合条件的柜号"}
                  onRowClick={setSelectedContainerProfit}
                  rowClassName={(row) => selectedContainerProfit?.sourceOrderId === row.sourceOrderId ? "selected" : ""}
                  tableClassName="container-profit-table"
                />
              ) : null}
            </div>
            {tab === "initial" ? (
              <div className="pagination">
                <div className="pagination-info">
                  显示 {initialPageStart}-{initialPageEnd} / {initialTotalCount}
                </div>
                <select
                  className="page-size"
                  value={initialPageSize}
                  onChange={(event) => {
                    const nextSize = Number(event.target.value);
                    setInitialPageSize(nextSize);
                    setInitialPage(1);
                  }}
                >
                  <option value={25}>25 / 页</option>
                  <option value={50}>50 / 页</option>
                  <option value={100}>100 / 页</option>
                  <option value={200}>200 / 页</option>
                  <option value={300}>300 / 页</option>
                </select>
                <button
                  className="button ghost"
                  disabled={loading || initialPage <= 1}
                  onClick={() => {
                    const nextPage = Math.max(1, initialPage - 1);
                    setInitialPage(nextPage);
                  }}
                >
                  上一页
                </button>
                <span className="page-current">
                  {initialPage} / {initialTotalPages}
                </span>
                <button
                  className="button ghost"
                  disabled={loading || initialPage >= initialTotalPages}
                  onClick={() => {
                    const nextPage = Math.min(initialTotalPages, initialPage + 1);
                    setInitialPage(nextPage);
                  }}
                >
                  下一页
                </button>
              </div>
            ) : tab === "container" ? (
              <div className="pagination">
                <div className="pagination-info">
                  显示 {containerPageStart}-{containerPageEnd} / {containerProfitTotalCount}
                </div>
                <select
                  className="page-size"
                  value={containerPageSize}
                  onChange={(event) => {
                    setContainerPageSize(Number(event.target.value));
                    setContainerPage(1);
                  }}
                >
                  <option value={25}>25 / 页</option>
                  <option value={50}>50 / 页</option>
                  <option value={100}>100 / 页</option>
                  <option value={200}>200 / 页</option>
                  <option value={300}>300 / 页</option>
                </select>
                <button className="button ghost" disabled={loading || containerPage <= 1} onClick={() => setContainerPage((page) => Math.max(1, page - 1))}>
                  上一页
                </button>
                <span className="page-current">{containerPage} / {containerTotalPages}</span>
                <button className="button ghost" disabled={loading || containerPage >= containerTotalPages} onClick={() => setContainerPage((page) => Math.min(containerTotalPages, page + 1))}>
                  下一页
                </button>
              </div>
            ) : null}
          </section>

          {tab === "initial" ? (
            selectedInitialRow ? (
            <div className="detail-drawer-backdrop" onMouseDown={() => setSelectedInitialRow(null)}>
            <aside
              className="initial-inspector"
              role="dialog"
              aria-modal="true"
              aria-label={`${selectedInitialRow.containerNumber} 账单详情`}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="inspector-titlebar">
                <div>
                  <h2>账单详情</h2>
                  <span>{selectedInitialRow.sourceInvoices.length} 张源系统账单</span>
                </div>
                <button
                  className="drawer-close"
                  aria-label="关闭账单详情"
                  title="关闭"
                  onClick={() => setSelectedInitialRow(null)}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="inspector-body">
                  <>
                    <div className="inspector-hero">
                      <div className="inspector-identity">
                        <div className="inspector-tags">
                          <span className="mode-tag">{operationModeLabels[selectedInitialRow.operationMode || ""] || "初始账单"}</span>
                          <span className="source-system-tag">源系统只读</span>
                        </div>
                        <h3>{selectedInitialRow.containerNumber}</h3>
                        <p>{selectedInitialRow.customerName || "未关联客户"}</p>
                      </div>
                      <div className="inspector-amount">
                        <span>源账单总额</span>
                        <strong>{money(selectedInitialRow.sourceInvoiceTotalAmount)}</strong>
                      </div>
                    </div>

                    <div className="inspector-dates">
                      <div>
                        <span>订单日期</span>
                        <strong>{formatDate(selectedInitialRow.orderDate)}</strong>
                      </div>
                      <div>
                        <span>ETA</span>
                        <strong>{formatDate(selectedInitialRow.etaDate)}</strong>
                      </div>
                      <div>
                        <span>提柜日期</span>
                        <strong>{formatDate(selectedInitialRow.pickupDate)}</strong>
                      </div>
                      <div>
                        <span>还柜日期</span>
                        <strong>{formatDate(selectedInitialRow.returnDeadline)}</strong>
                      </div>
                    </div>

                    <div className="inspector-meta">
                      <span>柜型<strong>{selectedInitialRow.containerType || "-"}</strong></span>
                      <span>有效账单<strong>{activeSourceInvoices(selectedInitialRow.sourceInvoices).length}</strong></span>
                      <span>核销状态<strong>{sourceSettlementSummary(selectedInitialRow.sourceInvoices).label}</strong></span>
                    </div>

                    <div className="inspector-section-head">
                      <div>
                        <h4>源系统账单构成</h4>
                        <p>同一柜号下的拆柜、直送、仓储及负数账单</p>
                      </div>
                    </div>
                    <div className="source-invoice-list">
                      {selectedInitialRow.sourceInvoices.map((invoice) => (
                        <div className={`source-invoice-row ${invoice.invoiceStatus}`} key={invoice.invoiceId}>
                          <div className="source-invoice-main">
                            <div className="source-invoice-heading">
                              <span className={`invoice-type-tag ${invoice.invoiceType}`}>
                                {sourceInvoiceTypeLabels[invoice.invoiceType] || invoice.invoiceType || "其他"}
                              </span>
                              <strong>{invoice.invoiceNumber}</strong>
                            </div>
                            <div className="source-invoice-meta">
                              <span>{invoice.lineCount} 条明细</span>
                              <span>{formatDate(invoice.invoiceDate)}</span>
                            </div>
                            <div className="source-invoice-statuses">
                              <span className={`invoice-status-badge ${invoice.invoiceStatus}`}>
                                {sourceInvoiceStatusLabels[invoice.invoiceStatus] || invoice.invoiceStatus}
                              </span>
                              <span className={`settlement-label ${invoice.receivableStatus || "none"}`}>
                                {invoice.receivableStatus ? receivableStatusLabels[invoice.receivableStatus] : "未进入应收"}
                              </span>
                            </div>
                          </div>
                          <div className="source-invoice-amount">
                            <strong>{money(invoice.totalAmount)}</strong>
                            {invoice.receivableCount ? <span>余额 {money(invoice.balanceAmount)}</span> : null}
                          </div>
                        </div>
                      ))}
                      {!selectedInitialRow.sourceInvoices.length ? (
                        <div className="inspector-empty">源系统尚未生成账单</div>
                      ) : null}
                    </div>

                    <div className="source-summary">
                      <div><span>账单总额</span><strong>{money(selectedInitialRow.sourceInvoiceTotalAmount)}</strong></div>
                      <div><span>应收余额</span><strong>{money(selectedInitialRow.sourceBalanceAmount)}</strong></div>
                      <div><span>源账单</span><strong>{selectedInitialRow.invoiceCount} 张</strong></div>
                    </div>

                    <div className="inspector-footer">
                      <span className="readonly-note">账单金额与状态来自源系统，本页面只读</span>
                    </div>
                  </>
              </div>
            </aside>
            </div>
            ) : null
          ) : tab === "container" ? (
            selectedContainerProfit ? (
              <div className="detail-drawer-backdrop" onMouseDown={() => setSelectedContainerProfit(null)}>
                <aside
                  className="initial-inspector profit-inspector"
                  role="dialog"
                  aria-modal="true"
                  aria-label={`${selectedContainerProfit.containerNumber} 盈亏详情`}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="inspector-titlebar">
                    <div>
                      <h2>单柜盈亏详情</h2>
                      <span>收入取全部有效账单，支出按标准自动匹配</span>
                    </div>
                    <button className="drawer-close" aria-label="关闭盈亏详情" title="关闭" onClick={() => setSelectedContainerProfit(null)}>
                      <X size={18} />
                    </button>
                  </div>
                  <div className="inspector-body">
                    <div className="profit-detail-hero">
                      <div>
                        <span className={`mode-tag ${selectedContainerProfit.directRejectionUnload ? "rejection-unload" : ""}`}>
                          {selectedContainerProfit.directRejectionUnload
                            ? "直送拒收改拆"
                            : operationModeLabels[selectedContainerProfit.operationMode || ""] || "海柜"}
                        </span>
                        <h3>{selectedContainerProfit.containerNumber}</h3>
                        <p>{selectedContainerProfit.customerName || "未关联客户"}</p>
                      </div>
                      <div className={`profit-detail-result ${selectedContainerProfit.netProfit >= 0 ? "positive" : "negative"}`}>
                        <span>净盈亏</span>
                        <strong>{money(selectedContainerProfit.netProfit)}</strong>
                      </div>
                    </div>

                    <div className="profit-equation">
                      <div className="income"><span>账单收入</span><strong>{money(selectedContainerProfit.incomeAmount)}</strong></div>
                      <i>−</i>
                      <div className="expense"><span>匹配支出</span><strong>{money(selectedContainerProfit.expenseAmount)}</strong></div>
                      <i>=</i>
                      <div className={selectedContainerProfit.netProfit >= 0 ? "positive" : "negative"}><span>净盈亏</span><strong>{money(selectedContainerProfit.netProfit)}</strong></div>
                    </div>

                    <div className="inspector-dates">
                      <div><span>订单日期</span><strong>{formatDate(selectedContainerProfit.orderDate)}</strong></div>
                      <div><span>ETA</span><strong>{formatDate(selectedContainerProfit.etaDate)}</strong></div>
                      <div><span>提柜日期</span><strong>{formatDate(selectedContainerProfit.pickupDate)}</strong></div>
                      <div><span>还柜日期</span><strong>{formatDate(selectedContainerProfit.returnDeadline)}</strong></div>
                    </div>

                    <div className="inspector-section-head">
                      <div><h4>收入明细</h4><p>同一柜号下全部非作废源系统账单</p></div>
                      <strong>{activeSourceInvoices(selectedContainerProfit.sourceInvoices).length} 张</strong>
                    </div>
                    <div className="source-invoice-list compact">
                      {activeSourceInvoices(selectedContainerProfit.sourceInvoices).map((invoice) => (
                        <div className={`source-invoice-row ${invoice.invoiceStatus}`} key={invoice.invoiceId}>
                          <div className="source-invoice-main">
                            <div className="source-invoice-heading">
                              <span className={`invoice-type-tag ${invoice.invoiceType}`}>{sourceInvoiceTypeLabels[invoice.invoiceType] || invoice.invoiceType || "其他"}</span>
                              <strong>{invoice.invoiceNumber}</strong>
                            </div>
                            <div className="source-invoice-statuses">
                              <span className={`invoice-status-badge ${invoice.invoiceStatus}`}>{sourceInvoiceStatusLabels[invoice.invoiceStatus] || invoice.invoiceStatus}</span>
                              <span className={`settlement-label ${invoice.receivableStatus || "none"}`}>{invoice.receivableStatus ? receivableStatusLabels[invoice.receivableStatus] : "未进入应收"}</span>
                            </div>
                          </div>
                          <div className="source-invoice-amount"><strong>{money(invoice.totalAmount)}</strong></div>
                        </div>
                      ))}
                      {!activeSourceInvoices(selectedContainerProfit.sourceInvoices).length ? <div className="inspector-empty">源系统尚无有效账单</div> : null}
                    </div>

                    <div className="inspector-section-head">
                      <div><h4>支出明细</h4><p>该柜号满足条件后自动产生的标准支出</p></div>
                      <strong>{selectedContainerProfit.expenseLines.filter((line) => line.matched).length} 条</strong>
                    </div>
                    <div className="matched-expense-list">
                      {selectedContainerProfit.expenseLines.map((line) => (
                        <div className={`matched-expense-row ${line.matched ? "" : "unmatched"}`} key={line.key}>
                          <div>
                            <strong>{line.standardName}</strong>
                            <span>{line.condition}{line.warehousePoint ? ` · ${line.warehousePoint}` : ""}</span>
                          </div>
                          <div><small>{money(line.unitAmount)} × {line.quantity}</small><strong>{money(line.amount)}</strong></div>
                        </div>
                      ))}
                      {!selectedContainerProfit.expenseLines.length ? <div className="inspector-empty">当前柜号尚未满足任何支出标准</div> : null}
                    </div>
                    <div className="inspector-footer"><span className="readonly-note">源数据库只读；支出由本系统标准自动计算</span></div>
                  </div>
                </aside>
              </div>
            ) : null
          ) : tab === "fees" ? (
            <aside className="panel">
              <div className="panel-head">
                <h2 className="panel-title">{feeForm.id ? "编辑费用" : "新建费用"}</h2>
                {feeForm.sourceStandardPriceId ? (
                  <span className="badge">源标准价 #{feeForm.sourceStandardPriceId}</span>
                ) : feeForm.sourceFeeId ? (
                  <span className="badge">源旧费用 #{feeForm.sourceFeeId}</span>
                ) : null}
              </div>
              <div className="detail-body">
                <div className="form-grid">
                  <div className="field">
                    <label>费用编码</label>
                    <input value={feeForm.feeCode} onChange={(event) => setFeeForm({ ...feeForm, feeCode: event.target.value })} />
                  </div>
                  <div className="field">
                    <label>费用名称</label>
                    <input value={feeForm.feeName} onChange={(event) => setFeeForm({ ...feeForm, feeName: event.target.value })} />
                  </div>
                  <div className="field">
                    <label>单价</label>
                    <input
                      type="number"
                      step="0.01"
                      value={feeForm.unitPrice}
                      onChange={(event) => setFeeForm({ ...feeForm, unitPrice: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>单位</label>
                    <input value={feeForm.unit} onChange={(event) => setFeeForm({ ...feeForm, unit: event.target.value })} />
                  </div>
                  <div className="field">
                    <label>归属范围</label>
                    <select value={feeForm.scopeType} onChange={(event) => setFeeForm({ ...feeForm, scopeType: event.target.value })}>
                      <option value="all">所有客户</option>
                      <option value="customers">指定客户</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>客户名称</label>
                    <input value={feeForm.customerName} onChange={(event) => setFeeForm({ ...feeForm, customerName: event.target.value })} />
                  </div>
                  <div className="field">
                    <label>柜型</label>
                    <input value={feeForm.containerType} onChange={(event) => setFeeForm({ ...feeForm, containerType: event.target.value })} />
                  </div>
                  <div className="field">
                    <label>生效日期</label>
                    <input
                      type="date"
                      value={feeForm.effectiveDate}
                      onChange={(event) => setFeeForm({ ...feeForm, effectiveDate: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>失效日期</label>
                    <input
                      type="date"
                      value={feeForm.expirationDate}
                      onChange={(event) => setFeeForm({ ...feeForm, expirationDate: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>状态</label>
                    <select
                      value={feeForm.isActive ? "true" : "false"}
                      onChange={(event) => setFeeForm({ ...feeForm, isActive: event.target.value === "true" })}
                    >
                      <option value="true">启用</option>
                      <option value="false">停用</option>
                    </select>
                  </div>
                  <div className="field wide">
                    <label>说明</label>
                    <textarea value={feeForm.description} onChange={(event) => setFeeForm({ ...feeForm, description: event.target.value })} />
                  </div>
                </div>
                <div className="actions">
                  <button className="button primary" onClick={saveFee} disabled={loading}>
                    <Save size={16} />
                    保存费用
                  </button>
                  <button className="button" onClick={() => setFeeForm(emptyFeeForm)}>
                    <Plus size={16} />
                    新建
                  </button>
                </div>
              </div>
            </aside>
          ) : null}
        </div> : null}
        </>}
        </main>
      </div>
    </div>
  );
}

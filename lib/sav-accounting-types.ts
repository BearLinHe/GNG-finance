export type SavGoodsStatus = "transport" | "in_stock" | "returned" | "pending";
export type SavIncomeCategory = "delivery" | "labor" | "other" | "excluded" | "unclassified";

export type SavPricingRule = {
  perMile: number;
  roundingUnit: number;
  minimumTrip: number;
  additionalStop: number;
  pickupPerPallet: number;
};

export type SavContainerInput = {
  id: string;
  containerNumber: string;
  customerName: string | null;
  pickupDate: string | null;
  orderDate?: string | null;
  operationMode?: string | null;
  accountingScope?: "all" | "excel";
  status?: string | null;
  sourceIncomeComplete?: boolean;
  sourceExpenseComplete?: boolean;
};

export type SavGoodsInput = {
  id: string;
  containerId: string;
  orderDetailId?: string | null;
  tripId: string | null;
  method: string;
  loadedPallets: number | null;
  rejectedPallets: number | null;
  status: SavGoodsStatus;
  warehousePoint?: string | null;
  address?: string | null;
  deliveryDate?: string | null;
  sourceReference?: string | null;
  allocationOrder?: number;
};

export type SavTripInput = {
  id: string;
  miles: number | null;
  stopCount: number | null;
  explicitAmount?: number | null;
  sourceReference?: string | null;
};

export type SavIncomeLine = {
  id: string;
  containerId: string;
  category: SavIncomeCategory;
  amount: number | null;
  label: string;
  sourceReference?: string | null;
};

export type SavAccountingInput = {
  containers: SavContainerInput[];
  // Must include ALL goods on each relevant trip, including containers outside
  // the selected reporting period. Only `containers` controls output scope.
  goods: SavGoodsInput[];
  trips: SavTripInput[];
  incomeLines: SavIncomeLine[];
  pricing?: Partial<SavPricingRule>;
};

export type SavCostLine = SavGoodsInput & {
  netPallets: number | null;
  amount: number | null;
  pricingBasis: string;
  warnings: string[];
};

export type SavTripResult = SavTripInput & {
  amount: number | null;
  loadedPallets: number;
  goodsCount: number;
  pricingBasis: string;
  warnings: string[];
};

export type SavContainerResult = SavContainerInput & {
  income: number | null;
  knownIncome: number;
  deliveryIncome: number;
  laborIncome: number;
  otherIncome: number;
  expense: number | null;
  knownExpense: number;
  profit: number | null;
  transportBalance: number | null;
  incomeStatus: "complete" | "missing" | "pending";
  expenseStatus: "complete" | "missing" | "pending";
  statusLabel: string;
  provisional: boolean;
  pendingCostCount: number;
  inStockPallets: number;
  returnedPallets: number;
  goods: SavCostLine[];
  incomeLines: SavIncomeLine[];
  warnings: string[];
};

export type SavAccountingSummary = {
  containerCount: number;
  income: number | null;
  knownIncome: number;
  expense: number | null;
  knownExpense: number;
  profit: number | null;
  comparableProfit: number;
  transportBalance: number | null;
  calculatedBalanceCount: number;
  completeCount: number;
  provisionalCount: number;
  missingIncomeCount: number;
  pendingCostCount: number;
  pendingContainerCount: number;
  profitableCount: number;
  lossCount: number;
  breakEvenCount: number;
  inStockPallets: number;
  returnedPallets: number;
};

export type SavAccountingResult = {
  rows: SavContainerResult[];
  summary: SavAccountingSummary;
  trips: SavTripResult[];
  pricing: SavPricingRule;
};

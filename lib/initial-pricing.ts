import type { SourceInitialBill, SourceInitialPricingLine } from "./source-db";
import {
  type FeePrice,
  getSystemFeesBySourceIds,
  getSystemFeesBySourceStandardPriceIds,
  listCandidateSystemFeesByNames
} from "./system-db";

export type PricedInitialPricingLine = SourceInitialPricingLine & {
  appliedFeeId: number | null;
  appliedSourceFeeId: number | null;
  appliedFeeCode: string | null;
  appliedFeeName: string | null;
  appliedUnitPrice: number;
  appliedCustomerName: string | null;
  appliedContainerType: string | null;
  pricingSource: "system" | "source" | "disabled" | "unmatched";
};

export type PricedInitialBill = Omit<SourceInitialBill, "pricingLines"> & {
  pricingLines: PricedInitialPricingLine[];
  presetReceivableAmount: number;
  pricingSource: "system" | "source" | "mixed" | "unmatched";
  matchedFeeNames: string | null;
  unmatchedProductCount: number;
};

function normalizedText(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function normalizedContainerType(value: string | null | undefined) {
  return (value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/DH/g, "HQ")
    .replace(/HC/g, "HQ");
}

function feeAppliesToRow(fee: FeePrice, row: SourceInitialBill) {
  const scopeType = normalizedText(fee.scope_type || "all");
  const feeCustomer = normalizedText(fee.customer_name);
  const rowCustomer = normalizedText(row.customerName);
  const feeContainer = normalizedContainerType(fee.container_type);
  const rowContainer = normalizedContainerType(row.containerType);

  if (scopeType === "customers" && feeCustomer !== rowCustomer) {
    return false;
  }

  if (feeContainer && feeContainer !== rowContainer) {
    return false;
  }

  return true;
}

function scoreFee(fee: FeePrice, row: SourceInitialBill) {
  let score = 0;
  if (normalizedText(fee.fee_code) === "all in") score += 8;
  if (normalizedText(fee.scope_type) === "customers") score += 4;
  if (normalizedText(fee.customer_name) === normalizedText(row.customerName)) score += 4;
  if (normalizedContainerType(fee.container_type) === normalizedContainerType(row.containerType)) score += 2;
  if (!fee.container_type) score += 1;
  return score;
}

function bestSystemNameMatch(
  candidates: FeePrice[],
  line: SourceInitialPricingLine,
  row: SourceInitialBill
) {
  const productName = normalizedText(line.productName);
  return candidates
    .filter((fee) => normalizedText(fee.fee_name) === productName && feeAppliesToRow(fee, row))
    .sort((a, b) => scoreFee(b, row) - scoreFee(a, row) || b.id - a.id)[0] || null;
}

function isSourceInvoiceLine(line: SourceInitialPricingLine) {
  return line.matchLevel === "source_invoice_line" || line.sourceTotalAmount != null;
}

function applyFeePrice(
  line: SourceInitialPricingLine,
  row: SourceInitialBill,
  localBySourceId: Map<number, FeePrice>,
  localBySourceStandardPriceId: Map<number, FeePrice>,
  systemCandidates: FeePrice[]
): PricedInitialPricingLine {
  const localSourceFee = line.sourceStandardPriceId
    ? localBySourceStandardPriceId.get(line.sourceStandardPriceId) || null
    : line.sourceFeeId
    ? localBySourceId.get(line.sourceFeeId) || null
    : null;

  if (localSourceFee) {
    if (!localSourceFee.is_active) {
      return {
        ...line,
        appliedFeeId: localSourceFee.id,
        appliedSourceFeeId: localSourceFee.source_fee_id,
        appliedFeeCode: localSourceFee.fee_code,
        appliedFeeName: localSourceFee.fee_name,
        appliedUnitPrice: 0,
        appliedCustomerName: localSourceFee.customer_name,
        appliedContainerType: localSourceFee.container_type,
        pricingSource: "disabled"
      };
    }

    return {
      ...line,
      appliedFeeId: localSourceFee.id,
      appliedSourceFeeId: localSourceFee.source_fee_id,
      appliedFeeCode: localSourceFee.fee_code,
      appliedFeeName: localSourceFee.fee_name,
      appliedUnitPrice: localSourceFee.unit_price,
      appliedCustomerName: localSourceFee.customer_name,
      appliedContainerType: localSourceFee.container_type,
      pricingSource: "system"
    };
  }

  if (isSourceInvoiceLine(line)) {
    return {
      ...line,
      appliedFeeId: null,
      appliedSourceFeeId: line.sourceFeeId,
      appliedFeeCode: line.sourceFeeCode,
      appliedFeeName: line.sourceFeeName || line.productName,
      appliedUnitPrice: line.sourceUnitPrice,
      appliedCustomerName: line.sourceCustomerName,
      appliedContainerType: line.sourceContainerType,
      pricingSource: "source"
    };
  }

  if (line.sourceStandardPriceId) {
    return {
      ...line,
      appliedFeeId: null,
      appliedSourceFeeId: null,
      appliedFeeCode: line.sourceFeeCode,
      appliedFeeName: line.sourceFeeName || line.productName,
      appliedUnitPrice: line.sourceUnitPrice,
      appliedCustomerName: line.sourceCustomerName,
      appliedContainerType: line.sourceContainerType,
      pricingSource: "source"
    };
  }

  const systemNameMatch = bestSystemNameMatch(systemCandidates, line, row);
  if (systemNameMatch) {
    return {
      ...line,
      appliedFeeId: systemNameMatch.id,
      appliedSourceFeeId: systemNameMatch.source_fee_id,
      appliedFeeCode: systemNameMatch.fee_code,
      appliedFeeName: systemNameMatch.fee_name,
      appliedUnitPrice: systemNameMatch.unit_price,
      appliedCustomerName: systemNameMatch.customer_name,
      appliedContainerType: systemNameMatch.container_type,
      pricingSource: "system"
    };
  }

  if (line.sourceFeeId) {
    return {
      ...line,
      appliedFeeId: null,
      appliedSourceFeeId: line.sourceFeeId,
      appliedFeeCode: line.sourceFeeCode,
      appliedFeeName: line.sourceFeeName,
      appliedUnitPrice: line.sourceUnitPrice,
      appliedCustomerName: line.sourceCustomerName,
      appliedContainerType: line.sourceContainerType,
      pricingSource: "source"
    };
  }

  return {
    ...line,
    appliedFeeId: null,
    appliedSourceFeeId: null,
    appliedFeeCode: null,
    appliedFeeName: null,
    appliedUnitPrice: 0,
    appliedCustomerName: null,
    appliedContainerType: null,
    pricingSource: "unmatched"
  };
}

function billPricingSource(lines: PricedInitialPricingLine[]) {
  const activeSources = new Set(
    lines
      .map((line) => line.pricingSource)
      .filter((source) => source === "system" || source === "source")
  );

  if (!activeSources.size) return "unmatched";
  if (activeSources.size > 1) return "mixed";
  return Array.from(activeSources)[0] as "system" | "source";
}

function pricingLineAmount(line: PricedInitialPricingLine) {
  if (line.sourceTotalAmount != null) {
    return Number(line.sourceTotalAmount || 0);
  }

  const quantity = line.quantity == null ? 1 : Number(line.quantity || 0);
  return Number(line.appliedUnitPrice || 0) * quantity;
}

export async function priceInitialBills(rows: SourceInitialBill[]): Promise<PricedInitialBill[]> {
  const sourceFeeIds = rows
    .flatMap((row) => row.pricingLines.map((line) => line.sourceFeeId))
    .filter((id): id is number => Boolean(id));
  const sourceStandardPriceIds = rows
    .flatMap((row) => row.pricingLines.map((line) => line.sourceStandardPriceId))
    .filter((id): id is number => Boolean(id));
  const productNames = rows.flatMap((row) => row.pricingLines.map((line) => line.productName));

  const [localBySourceId, localBySourceStandardPriceId, systemCandidates] = await Promise.all([
    getSystemFeesBySourceIds(sourceFeeIds),
    getSystemFeesBySourceStandardPriceIds(sourceStandardPriceIds),
    listCandidateSystemFeesByNames(productNames)
  ]);

  return rows.map((row) => {
    const pricingLines = row.pricingLines.map((line) =>
      applyFeePrice(line, row, localBySourceId, localBySourceStandardPriceId, systemCandidates)
    );
    const presetReceivableAmount = pricingLines.reduce(
      (sum, line) => sum + pricingLineAmount(line),
      0
    );
    const matchedFeeNames = Array.from(
      new Set(
        pricingLines
          .filter((line) => line.pricingSource === "system" || line.pricingSource === "source")
          .map((line) => line.appliedFeeName || line.productName)
          .filter(Boolean)
      )
    ).join(", ");

    return {
      ...row,
      pricingLines,
      presetReceivableAmount: Number(presetReceivableAmount.toFixed(2)),
      pricingSource: billPricingSource(pricingLines),
      matchedFeeNames: matchedFeeNames || null,
      matchedFeeCount: pricingLines.filter((line) => line.pricingSource === "system" || line.pricingSource === "source").length,
      unmatchedProductCount: pricingLines.filter((line) => line.pricingSource === "unmatched" || line.pricingSource === "disabled").length
    };
  });
}

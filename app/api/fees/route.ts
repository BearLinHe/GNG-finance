import { NextResponse } from "next/server";
import { searchLegacySourceFees, searchSourceFees } from "@/lib/source-db";
import {
  getSystemFeesBySourceIds,
  getSystemFeesBySourceStandardPriceIds,
  listSystemFees,
  saveSystemFee
} from "@/lib/system-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const origin = url.searchParams.get("origin") || "source";
    const search = url.searchParams.get("search") || "";
    const scopeType = url.searchParams.get("scopeType") || "";
    const page = Number(url.searchParams.get("page") || 1);
    const pageSize = Number(url.searchParams.get("pageSize") || 50);

    if (origin === "system") {
      const result = await listSystemFees({
        search,
        scopeType,
        active: url.searchParams.get("active") || "",
        page,
        pageSize
      });
      return NextResponse.json({
        fees: result.fees,
        totalCount: result.totalCount,
        page,
        pageSize,
        origin
      });
    }

    const sourceFees = origin === "legacy"
      ? await searchLegacySourceFees({
        search,
        scopeType,
        customer: url.searchParams.get("customer") || "",
        page,
        pageSize
      })
      : await searchSourceFees({
      search,
      scopeType,
      customer: url.searchParams.get("customer") || "",
      page,
      pageSize
    });
    const localFees = origin === "legacy"
      ? await getSystemFeesBySourceIds(sourceFees.map((fee) => fee.sourceFeeId))
      : await getSystemFeesBySourceStandardPriceIds(
        sourceFees
          .map((fee) => fee.sourceStandardPriceId)
          .filter((id): id is number => Boolean(id))
      );

    return NextResponse.json({
      origin,
      totalCount: sourceFees[0]?.totalCount || 0,
      page,
      pageSize,
      fees: sourceFees.map((fee) => {
        const local = origin === "legacy"
          ? localFees.get(fee.sourceFeeId)
          : localFees.get(fee.sourceStandardPriceId || 0);
        return {
          ...fee,
          localFeeId: local?.id || null,
          localUnitPrice: local?.unit_price ?? null,
          localIsActive: local?.is_active ?? null
        };
      })
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取费用失败" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const fee = await saveSystemFee({
      sourceFeeId: body.sourceFeeId || null,
      sourceOrigin: body.sourceOrigin || null,
      sourceStandardId: body.sourceStandardId || null,
      sourceStandardPriceId: body.sourceStandardPriceId || null,
      feeCode: body.feeCode || "",
      feeName: body.feeName || "",
      unit: body.unit || null,
      unitPrice: Number(body.unitPrice),
      currency: body.currency || "USD",
      scopeType: body.scopeType || "all",
      customerName: body.customerName || null,
      containerType: body.containerType || null,
      effectiveDate: body.effectiveDate || null,
      expirationDate: body.expirationDate || null,
      description: body.description || null,
      isActive: body.isActive !== false
    });

    return NextResponse.json({ fee });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存费用失败" },
      { status: 500 }
    );
  }
}

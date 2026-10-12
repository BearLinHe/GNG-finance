import { NextResponse } from "next/server";
import { saveSystemFee } from "@/lib/system-db";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: { id: string } }) {
  try {
    const body = await request.json();
    const fee = await saveSystemFee({
      id: Number(context.params.id),
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
      { error: error instanceof Error ? error.message : "修改费用失败" },
      { status: 500 }
    );
  }
}

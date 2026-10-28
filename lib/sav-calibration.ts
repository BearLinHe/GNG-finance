import type { SavAccountingInput } from "./sav-accounting-types";
import type { SavSettings, SavTripOverride } from "./sav-settings";

// Imported evidence may fill missing inputs, never replace current source
// values or existing human reviews. A trip's complete cargo membership must
// match; a first-match lookup could otherwise price a changed merged trip.
export function savCalibrationPatch(input: SavAccountingInput, settings: SavSettings) {
  const evidence = settings.baseline?.tripEvidence ?? [];
  const key = (ids: string[]) => [...ids].sort().join("|");
  const lookup = new Map<string, typeof evidence>();
  for (const row of evidence) {
    const signature = key(row.goodsIds);
    lookup.set(signature, [...(lookup.get(signature) ?? []), row]);
  }
  const patch: Record<string, SavTripOverride> = {}; let skippedCount = 0;
  for (const trip of input.trips) {
    const members = input.goods.filter(goods => goods.tripId === trip.id);
    const candidates = lookup.get(key(members.map(goods => goods.id)));
    if (!candidates || candidates.length !== 1) { skippedCount++; continue; }
    const found = candidates[0]; const prior = settings.tripOverrides[trip.id];
    const changed: Partial<SavTripOverride> = {};
    if (trip.miles === null && prior?.miles == null && found.miles !== null && found.miles >= 0) changed.miles = found.miles;
    if (trip.stopCount === null && prior?.stopCount == null && found.stopCount !== null && found.stopCount >= 1) changed.stopCount = found.stopCount;
    if (members.length && members.every(goods => goods.method.toUpperCase() === "LTL") && trip.explicitAmount == null && prior?.explicitAmount == null && found.explicitAmount != null) changed.explicitAmount = found.explicitAmount;
    const priorFields = prior?.calibratedFields ?? (prior?.goodsIds ? (["miles", "stopCount", "explicitAmount"] as const).filter(key => prior[key] !== undefined) : []);
    const calibratedFields = [...new Set([...priorFields, ...Object.keys(changed)])] as SavTripOverride["calibratedFields"];
    if (Object.keys(changed).length) patch[trip.id] = { ...prior, ...changed, goodsIds: members.map(goods => goods.id), calibratedFields, note: `${prior?.note ? `${prior.note}；` : ""}Excel已确认计价依据：${found.sourceReference}`.slice(0, 1000) };
    else if (prior && prior.note.includes(found.sourceReference) && (!prior.goodsIds || !prior.calibratedFields)) patch[trip.id] = { ...prior, goodsIds: members.map(goods => goods.id), calibratedFields: (["miles", "stopCount", "explicitAmount"] as const).filter(key => prior[key] !== undefined) };
  }
  return { tripOverrides: patch, appliedCount: Object.keys(patch).length, skippedCount, notes: ["仅填入缺失里程、卸点数及LTL金额，保留当前系统数据和人工核对值。", "整趟货物ID必须与Excel完全一致；同车范围变化或没有可靠对应关系的趟次保留待核对。"] };
}

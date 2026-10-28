export type PayeeType = "driver" | "owner";
type PayeeTask = { driverName: string; sheetName: string; payeeType?: PayeeType | null };

function ownerName(value: string) {
  // A leading O is a marker only before whitespace or a Chinese name, not in Oliver/Oscar.
  return value.match(/^(?:O\s+|O(?=\p{Script=Han})|[○◯〇⭕◦]\s*)(\S[\s\S]*)$/iu)?.[1].trim() || null;
}
export function payeeIdentity(name: string, sourceName = name, explicitType?: PayeeType | null) {
  const normalized = name.normalize("NFKC").trim();
  const source = sourceName.normalize("NFKC").trim();
  const marked = ownerName(normalized) || ownerName(source);
  const vehicle = /^\d+$/.test(normalized);
  const type: PayeeType | null = explicitType || (marked ? "owner" : vehicle ? null : "driver");
  const recipient = ownerName(normalized) || normalized;
  return { type, label: vehicle ? "车辆编号" : type === "owner" ? "车主" : "司机", marked: Boolean(marked),
    payeeName: /^\d+$/.test(recipient) ? "" : recipient };
}
export function taskPayeeType(task: PayeeTask): PayeeType | null {
  return payeeIdentity(task.driverName, task.sheetName, task.payeeType).type;
}
export function summarizePayeeTypes(tasks: PayeeTask[]) {
  const types = tasks.map(taskPayeeType);
  const known = new Set(types.filter((type): type is PayeeType => type !== null));
  const unknownCount = types.filter(type => type === null).length;
  return { type: known.size === 1 && !unknownCount ? [...known][0] : null,
    conflict: known.size > 1 || (known.size > 0 && unknownCount > 0), unknownCount };
}

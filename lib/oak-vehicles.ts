import { payeeIdentity } from "./oak-payee";

export type OakVehicle = { id: string; vehicleNumber: string | null; driverName: string; aliases: string[]; version: number };
const entries: Array<[string | null, string, string[]?]> = [
  ["16", "李屈"], ["905", "李伟权"], ["909", "翁浩德"], ["3033", "周亚峰"], ["877", "张晓澄"],
  ["3183", "薛彦明", ["薛艳明"]], ["3161", "王崎"], ["2113", "刘嘉耀"], ["77", "David高", ["David Gao"]],
  ["2109", "姚义红"], ["118", "赵胜峰"], ["3651", "张华明"], ["777", "李忆豪"], ["907", "郭晓光"],
  ["007", "刘洪"], ["901", "吴家健"], ["1688", "许建强"], ["83", "王肃"], ["0527", "邓嘉毅", ["Jay D"]],
  ["8", "冯学飞"], ["168", "陈炳中", ["Don"]], ["505", "施宇杰"], ["19", "肖雪冬Marco", ["Marco", "肖雪冬"]],
  [null, "钟兴海", ["XINGHAI ZHONG"]], [null, "杨凯民Kevin", ["杨凯民", "Kevin"]],
  ["0608", "刘志豪 luke", ["刘志豪", "Luke"]]
];
export const oakVehicleSeeds: OakVehicle[] = entries.map(([vehicleNumber, driverName, aliases = []], index) => ({
  id: `oak-${String(index + 1).padStart(2, "0")}`, vehicleNumber, driverName, aliases, version: 1
}));

export function vehicleSubjectKey(value: string) {
  return payeeIdentity(value).payeeName.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase() || value.trim();
}
export function vehicleKeys(vehicle: OakVehicle) {
  return [...new Set([vehicle.driverName, vehicle.vehicleNumber, ...vehicle.aliases].filter((value): value is string => Boolean(value)).map(vehicleSubjectKey))];
}
export function vehicleForSubject(vehicles: OakVehicle[], subject: string) {
  const key = vehicleSubjectKey(subject);
  const matches = vehicles.filter(vehicle => vehicleKeys(vehicle).includes(key));
  return matches.length === 1 ? matches[0] : null;
}
export function assertUniqueVehicleLinks(vehicles: OakVehicle[]) {
  const keys = new Map<string, string>();
  for (const vehicle of vehicles) for (const key of vehicleKeys(vehicle)) {
    const previous = keys.get(key);
    if (previous && previous !== vehicle.id) throw new Error("车号或源表名称已关联其他车辆，请先解除原关联");
    keys.set(key, vehicle.id);
  }
}

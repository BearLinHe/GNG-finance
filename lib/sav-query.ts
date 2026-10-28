import { SavInputError } from "./sav-settings";
export type SavQueryScope = "all" | "excel";
export function parseSavQuery(params: URLSearchParams) {
  const date = (key: string) => {
    const value = params.get(key)?.trim();
    if (!value) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new SavInputError("日期无效");
    return value;
  };
  const dateFrom = date("dateFrom"), dateTo = date("dateTo");
  if (dateFrom && dateTo && dateFrom > dateTo) throw new SavInputError("开始日期不能晚于结束日期");
  const integer = (key: string, fallback: number, maximum: number) => {
    const raw = params.get(key);
    if (raw === null || raw === "") return fallback;
    if (!/^\d+$/.test(raw)) throw new SavInputError("分页参数无效");
    const number = Number(raw);
    if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw new SavInputError("分页参数超出有效范围");
    return number;
  };
  const scope = params.get("scope") || "all";
  if (scope !== "all" && scope !== "excel") throw new SavInputError("核算范围无效");
  const rawMode = params.get("operationMode") || "all";
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(rawMode)) throw new SavInputError("订单类型无效");
  const status = params.get("status") || "all";
  if (!["all", "pending", "missing_income", "missing_cost", "loss", "profit", "stock"].includes(status)) throw new SavInputError("核算状态无效");
  const search = (params.get("search") || "").trim(), customer = (params.get("customer") || "").trim();
  if (search.length > 120 || customer.length > 120) throw new SavInputError("查询条件过长");
  return { dateFrom, dateTo, search, customer, scope: scope as SavQueryScope, operationMode: rawMode === "all" ? undefined : rawMode,
    page: integer("page", 1, 100000000), pageSize: integer("pageSize", 100, 300), status };
}

export function driverPagination(params: URLSearchParams) {
  function integer(name: string, fallback: number, min: number, max: number) {
    const value = params.get(name);
    if (value == null || value === "") return fallback;
    if (!/^[1-9]\d*$/.test(value)) throw new Error(name === "page" ? "页码无效" : "每页条数无效");
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(name === "page" ? "页码无效" : "每页条数需在 10 至 300 之间");
    return parsed;
  }
  return { page: integer("page", 1, 1, Number.MAX_SAFE_INTEGER), pageSize: integer("pageSize", 100, 10, 300) };
}

export function paginateDriverPeriods<T>(periods: T[], requestedPage: number, pageSize: number) {
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || !Number.isSafeInteger(pageSize) || pageSize < 10 || pageSize > 300) throw new Error("分页参数无效");
  const totalCount = periods.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;
  return { periods: periods.slice(start, start + pageSize), page, pageSize, totalCount };
}

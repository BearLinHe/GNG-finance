export type SavRuntimeStage = "source" | "settings" | "accounting";

const messages = {
  SAV_SOURCE_NOT_CONFIGURED: "SAV 数据源尚未配置。请为当前部署设置 SAV_DATABASE_URL 后重新部署。",
  SAV_SOURCE_CONNECTION_FAILED: "无法连接 SAV 数据源，请检查当前部署的数据库连接和网络配置。",
  SAV_SOURCE_AUTH_FAILED: "SAV 数据源连接认证失败，请检查当前部署保存的数据库凭据。",
  SAV_SOURCE_PERMISSION_DENIED: "SAV 数据源权限不足，无法读取仓库核算数据。",
  SAV_SOURCE_SCHEMA_MISMATCH: "SAV 数据源表结构与当前版本不一致，请检查所连接的仓库数据库和数据库迁移。",
  SAV_SOURCE_TIMEOUT: "SAV 数据读取超时，请缩小查询范围后重试。",
  FINANCE_NOT_CONFIGURED: "Finance 核算数据库尚未配置，请为当前部署设置 SYSTEM_DATABASE_URL。",
  FINANCE_CONNECTION_FAILED: "无法读取 Finance 核算设置，请检查 Finance 数据库连接和网络配置。",
  FINANCE_PERMISSION_DENIED: "Finance 数据库权限不足，无法初始化或读取 SAV 核算设置。",
  FINANCE_SCHEMA_MISMATCH: "Finance 核算设置表结构与当前版本不一致，请检查数据库迁移。",
  FINANCE_TIMEOUT: "Finance 核算设置读取超时，请稍后重试。",
  SAV_ACCOUNTING_FAILED: "SAV 核算处理失败，请稍后重试。"
} as const;

export type SavRuntimeCode = keyof typeof messages;

export class SavRuntimeError extends Error {
  readonly name = "SavRuntimeError";
  readonly dbCode?: string;

  constructor(
    readonly code: SavRuntimeCode,
    readonly stage: SavRuntimeStage,
    readonly status = 503,
    dbCode?: string
  ) {
    super(messages[code]);
    this.dbCode = dbCode && /^[A-Z0-9]{5}$/.test(dbCode) ? dbCode : undefined;
  }
}

function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const value = error.code;
  return typeof value === "string" && /^[A-Z0-9]{5}$/.test(value) ? value : undefined;
}

// Never copy a driver message, URL, query or cause into the public error or log
// metadata: connection errors may contain usernames, passwords and hostnames.
export function savRuntimeError(stage: "source" | "settings", error: unknown): SavRuntimeError {
  if (error instanceof SavRuntimeError) return error;
  const code = databaseCode(error);
  if (stage === "settings") {
    if (error instanceof Error && error.message === "SYSTEM_DATABASE_URL is not configured") return new SavRuntimeError("FINANCE_NOT_CONFIGURED", stage);
    if (code === "42501") return new SavRuntimeError("FINANCE_PERMISSION_DENIED", stage, 503, code);
    if (code === "42P01" || code === "42703") return new SavRuntimeError("FINANCE_SCHEMA_MISMATCH", stage, 500, code);
    if (code === "57014") return new SavRuntimeError("FINANCE_TIMEOUT", stage, 503, code);
    return new SavRuntimeError("FINANCE_CONNECTION_FAILED", stage, 503, code);
  }
  if (code === "28P01" || code === "28000") return new SavRuntimeError("SAV_SOURCE_AUTH_FAILED", stage, 503, code);
  if (code === "42501") return new SavRuntimeError("SAV_SOURCE_PERMISSION_DENIED", stage, 503, code);
  if (code === "42P01" || code === "42703") return new SavRuntimeError("SAV_SOURCE_SCHEMA_MISMATCH", stage, 500, code);
  if (code === "57014") return new SavRuntimeError("SAV_SOURCE_TIMEOUT", stage, 503, code);
  return new SavRuntimeError("SAV_SOURCE_CONNECTION_FAILED", stage, 503, code);
}

export function savRuntimeDiagnostic(error: unknown) {
  return error instanceof SavRuntimeError
    ? { code: error.code, stage: error.stage, ...(error.dbCode ? { dbCode: error.dbCode } : {}) }
    : { code: "SAV_ACCOUNTING_FAILED", stage: "accounting" };
}

export function savRuntimeClientError(error: unknown) {
  return error instanceof SavRuntimeError
    ? { error: error.message, code: error.code }
    : { error: messages.SAV_ACCOUNTING_FAILED, code: "SAV_ACCOUNTING_FAILED" };
}

/**
 * 应用错误类型与错误码 —— 遵循质量原则第 3/5 原则
 *
 * AppError 是领域层的业务错误载体，Controller 层负责将其映射为 HTTP 状态码。
 * 统一错误响应格式（统一接口文档 §2）：ErrorEnvelope = { error: { code, message, details? } }。
 */

/** 应用错误（领域层业务错误） */
export interface AppError {
  /** 错误码（机器可读，大写下划线） */
  readonly code: string;
  /** 错误信息（人类可读） */
  readonly message: string;
  /** 可选详情（如字段校验明细） */
  readonly details?: unknown;
}

/** 错误码常量（与统一接口文档 §2 / §7 对齐） */
export const ErrorCode = {
  /** 字段校验失败（请求体 → 422） */
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  /** 分页参数越界（查询参数 → 400，响应红队 R-003） */
  QUERY_VALIDATION_ERROR: 'QUERY_VALIDATION_ERROR',
  /** 实例从未上报（历史查询 → 404） */
  INSTANCE_NOT_FOUND: 'INSTANCE_NOT_FOUND',
  /** 路由未匹配（→ 404） */
  NOT_FOUND: 'NOT_FOUND',
  /** 内部错误（系统异常兜底 → 500） */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

/**
 * 将 AppError.code 映射为 HTTP 状态码
 *
 * 仅 Controller 层 / 中间件层应知道 HTTP 的存在（质量红线：Service 不返回 HTTP 状态码）。
 */
export function errorToHttpStatus(code: string): number {
  switch (code) {
    case ErrorCode.VALIDATION_ERROR:
      return 422;
    case ErrorCode.QUERY_VALIDATION_ERROR:
      return 400;
    case ErrorCode.INSTANCE_NOT_FOUND:
    case ErrorCode.NOT_FOUND:
      return 404;
    case ErrorCode.INTERNAL_ERROR:
    default:
      return 500;
  }
}

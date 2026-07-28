/**
 * 全局错误处理中间件 —— 兜底所有未处理异常（质量原则第 5 原则）
 *
 * Express 错误处理中间件签名必须 4 参数（err, req, res, next），注册在路由链最后。
 * 捕获所有未处理异常 → 统一 500 INTERNAL_ERROR ErrorEnvelope；记录错误堆栈。
 *
 * 同时兜底业务层显式 next(err) 传入的 AppError（如校验中间件未覆盖的边界）。
 */
import type { ErrorRequestHandler } from 'express';
import { ErrorCode } from '../shared/types/errors';
import { errorToHttpStatus } from '../shared/types/errors';
import type { AppError } from '../shared/types/errors';
import { sendError } from '../shared/http/response';
import { logger } from '../shared/logger';

function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value
  );
}

/**
 * 提取 HTTP 中间件（express.json / body-parser）抛出的错误状态码。
 *
 * Express 内置 JSON 解析器与 body-parser 在请求体畸形（err.status=400）或超限（err.status=413）时，
 * 会把 status/statusCode 挂在抛出的 Error 上。本函数将其透传，避免被统一兜底为 500（红队 BI-005）。
 *
 * @returns 合法的 4xx/5xx 状态码，否则 null
 */
function extractHttpStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) {
    return null;
  }
  const candidate =
    (err as { status?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode;
  const code = Number(candidate);
  return Number.isInteger(code) && code >= 400 && code < 600 ? code : null;
}

/**
 * 全局错误处理中间件
 *
 * - AppError → 按 code 映射 HTTP 状态码
 * - Express 内置中间件错误（express.json/body-parser，含 err.status）→ 透传其状态码
 * - 其他异常 → 500 INTERNAL_ERROR（不向客户端泄露堆栈）
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (isAppError(err)) {
    logger.warn({ code: err.code, path: req.path }, '业务错误');
    sendError(res, err, errorToHttpStatus(err.code));
    return;
  }

  // BI-005 fix：透传 express.json/body-parser 的 err.status（畸形 JSON→400、超限 body→413）
  const httpStatus = extractHttpStatus(err);
  if (httpStatus !== null) {
    logger.warn({ status: httpStatus, path: req.path }, 'HTTP 中间件错误');
    sendError(
      res,
      { code: ErrorCode.VALIDATION_ERROR, message: '请求格式或大小不合法' },
      httpStatus,
    );
    return;
  }

  // 系统异常：记录完整堆栈，返回脱敏的 500
  logger.error({ err, path: req.path }, '未处理系统异常');
  sendError(res, {
    code: ErrorCode.INTERNAL_ERROR,
    message: '服务器内部错误',
  });
};

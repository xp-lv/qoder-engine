/**
 * 统一 HTTP 响应助手 —— 遵循质量原则第 3 原则（接口即契约）+ 统一错误 envelope
 *
 * 统一错误响应格式（统一接口文档 §2）：
 *   ErrorEnvelope = { error: { code: string; message: string; details?: unknown } }
 *
 * 仅 Controller / 中间件层调用此模块（质量红线：Service 不返回 HTTP 状态码）。
 */
import type { Response } from 'express';
import { type AppError, errorToHttpStatus } from '../types/errors';

/** 统一错误响应信封 */
export interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
}

/**
 * 发送错误响应：将 AppError 映射为 HTTP 状态码 + ErrorEnvelope
 *
 * @param res Express 响应对象
 * @param error 应用错误
 * @param overrideStatus 可选覆盖 HTTP 状态码（默认由 errorToHttpStatus 推导）
 */
export function sendError(
  res: Response,
  error: AppError,
  overrideStatus?: number,
): void {
  const status = overrideStatus ?? errorToHttpStatus(error.code);
  const body: ErrorEnvelope = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    },
  };
  res.status(status).json(body);
}

/**
 * 发送成功响应（便捷封装，200）
 */
export function sendOk<T>(res: Response, body: T, status = 200): void {
  res.status(status).json(body);
}

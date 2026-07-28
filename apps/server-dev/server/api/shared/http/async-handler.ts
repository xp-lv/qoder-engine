/**
 * 异步路由处理器包装 —— 确保抛出的 Promise rejection 进入 Express 错误链
 *
 * Express 4 不会自动捕获 async handler 抛出的 rejection。
 * 系统异常（DB 连接失败等）经此包装转发到全局错误中间件兜底（质量原则第 5 原则）。
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

/**
 * 包装异步路由处理器：捕获 rejection → next(err) → 全局错误中间件
 */
export function asyncHandler(fn: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 请求日志中间件 —— 结构化日志（method/path/status/耗时 ms）
 *
 * 遵循质量原则第 6 原则：可观测性。记录每个请求的方法、路径、响应状态码与耗时。
 * 使用 res.on('finish') 捕获最终状态码。
 */
import type { RequestHandler } from 'express';
import { logger } from '../shared/logger';

export const requestLogger: RequestHandler = (req, res, next) => {
  const startedAt = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    logger.info(
      {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs,
      },
      '请求完成',
    );
  });

  next();
};

/**
 * 404 中间件 —— 未匹配路由兜底
 *
 * 所有未匹配的请求统一返回 404 NOT_FOUND ErrorEnvelope（统一接口文档 §2）。
 * 注册在业务路由之后、全局错误中间件之前。
 */
import type { RequestHandler } from 'express';
import { ErrorCode } from '../shared/types/errors';
import { sendError } from '../shared/http/response';

export const notFound: RequestHandler = (req, res) => {
  sendError(res, {
    code: ErrorCode.NOT_FOUND,
    message: `路由未找到：${req.method} ${req.path}`,
  });
};

/**
 * zod 校验中间件工厂 —— 遵循质量原则第 3 原则（接口即契约 → DTO 校验）
 *
 * 对 req.body / req.query 进行 zod 校验：
 * - 请求体校验失败 → 422 VALIDATION_ERROR（统一接口文档 §2.1）
 * - 查询参数（分页）越界 → 400 QUERY_VALIDATION_ERROR（统一接口文档 §2.3，响应红队 R-003）
 *
 * 校验通过后，将规整后的值写回 req.body / req.query（含默认值填充）。
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodSchema } from 'zod';
import { ErrorCode } from '../types/errors';
import { sendError } from '../http/response';

/** 校验目标 */
export type ValidationTarget = 'body' | 'query';

export interface ValidateOptions {
  /** 校验目标位置 */
  target: ValidationTarget;
  /** zod schema */
  schema: ZodSchema;
  /**
   * 失败 HTTP 状态码：
   * - body 默认 422（VALIDATION_ERROR）
   * - query 默认 400（QUERY_VALIDATION_ERROR，响应 R-003）
   */
  errorCode?: (typeof ErrorCode)[keyof typeof ErrorCode];
}

/**
 * 创建校验中间件
 */
export function validate(options: ValidateOptions): RequestHandler {
  const { target, schema } = options;
  const code =
    options.errorCode ??
    (target === 'body' ? ErrorCode.VALIDATION_ERROR : ErrorCode.QUERY_VALIDATION_ERROR);

  return (req: Request, res: Response, next: NextFunction) => {
    const input = target === 'body' ? req.body : req.query;
    const result = schema.safeParse(input);

    if (!result.success) {
      sendError(res, {
        code,
        message: target === 'body' ? '请求体字段校验失败' : '查询参数校验失败',
        details: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    // 校验通过：写回归整后的值（含默认值）
    if (target === 'body') {
      req.body = result.data;
    } else {
      req.query = result.data as Request['query'];
    }
    next();
  };
}

/**
 * Report 路由装配 —— 仅路由装配，无业务逻辑（质量红线：业务逻辑不写在中间件/路由）
 *
 * 端点：POST /api/reports
 *   - validate(createReportSchema) 前置 zod 校验（失败 → 422）
 *   - asyncHandler 包装，系统异常 → 全局错误中间件
 */
import { Router } from 'express';
import type { ReportController } from './report.controller';
import { createReportSchema } from './report.dto';
import { asyncHandler } from '../../shared/http/async-handler';
import { validate } from '../../shared/validation/validate';

/**
 * 创建 report 路由
 *
 * @param controller 已注入依赖的 ReportController 实例
 */
export function createReportRouter(controller: ReportController): Router {
  const router = Router();

  // POST /api/reports —— Ext 上报 qoder 信息
  router.post(
    '/',
    validate({ target: 'body', schema: createReportSchema }),
    asyncHandler((req, res) => controller.create(req, res)),
  );

  return router;
}

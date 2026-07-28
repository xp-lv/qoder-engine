/**
 * Instance 路由装配 —— 仅路由装配，无业务逻辑（质量红线）
 *
 * 端点：
 *   GET /api/instances
 *   GET /api/instances/:instanceId/history?page=&limit=
 */
import { Router } from 'express';
import type { InstanceController } from './instance.controller';
import { historyQuerySchema } from './instance.dto';
import { asyncHandler } from '../../shared/http/async-handler';
import { validate } from '../../shared/validation/validate';

/**
 * 创建 instance 路由
 *
 * @param controller 已注入依赖的 InstanceController 实例
 */
export function createInstanceRouter(controller: InstanceController): Router {
  const router = Router();

  // GET /api/instances —— 全量实例最新状态（HTTP 兜底）
  router.get('/', asyncHandler((req, res) => controller.list(req, res)));

  // GET /api/instances/:instanceId/history —— 历史上报（分页倒序）
  // query 校验：page/limit 越界 → 400 QUERY_VALIDATION_ERROR（响应 R-003）
  router.get(
    '/:instanceId/history',
    validate({ target: 'query', schema: historyQuerySchema }),
    asyncHandler((req, res) => controller.history(req, res)),
  );

  return router;
}

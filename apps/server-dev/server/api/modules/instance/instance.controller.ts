/**
 * InstanceController —— 极薄 HTTP 边界翻译层
 *
 * 遵循质量红线：Controller 不含业务逻辑、不直接操作数据库；仅做 HTTP ↔ 业务的边界翻译。
 *
 * 端点：
 *   GET /api/instances                              —— 全量实例最新状态（HTTP 兜底）
 *   GET /api/instances/:instanceId/history          —— 某实例历史上报（分页倒序）
 */
import type { Request, Response } from 'express';
import type { IInstanceService } from './instance.service';
import { sendError, sendOk } from '../../shared/http/response';

export class InstanceController {
  constructor(private readonly instanceService: IInstanceService) {}

  /** GET /api/instances —— 契约：200 { items: InstanceDTO[] } */
  async list(_req: Request, res: Response): Promise<void> {
    const items = await this.instanceService.listLatest();
    sendOk(res, { items });
  }

  /** GET /api/instances/:instanceId/history —— 契约：200 { items, total, page }（R-001：无 404 分支，空实例亦 200） */
  async history(req: Request, res: Response): Promise<void> {
    // query 已由 validate 中间件规整（page/limit 含默认值）
    const { page, limit } = req.query as { page: number; limit: number };
    const result = await this.instanceService.getHistory(
      req.params.instanceId,
      page,
      limit,
    );

    if (!result.ok) {
      // 仅分页参数二次防御越界 → 400（R-001：不再有 404 分支）
      sendError(res, result.error);
      return;
    }

    sendOk(res, result.value);
  }
}

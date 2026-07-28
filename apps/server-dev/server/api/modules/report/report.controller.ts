/**
 * ReportController —— 极薄 HTTP 边界翻译层
 *
 * 遵循质量红线：Controller 不含业务逻辑、不直接操作数据库；仅做 HTTP ↔ 业务的边界翻译。
 * 仅 Controller 层知道 HTTP 状态码的存在（Service 返回 Result，不碰 HTTP）。
 *
 * 端点：POST /api/reports —— Ext 上报 qoder 信息
 *   成功 → 201 { ok: true }；字段校验失败 → 422 ErrorEnvelope（由 validate 中间件前置拦截）
 */
import type { Request, Response } from 'express';
import type { CreateReportDTO } from './report.dto';
import type { IReportService } from './report.service';
import { sendError, sendOk } from '../../shared/http/response';

export class ReportController {
  constructor(private readonly reportService: IReportService) {}

  /** POST /api/reports */
  async create(req: Request, res: Response): Promise<void> {
    // req.body 已由 validate 中间件规整为 CreateReportDTO
    const result = await this.reportService.ingest(req.body as CreateReportDTO);

    if (!result.ok) {
      sendError(res, result.error); // AppError → HTTP 状态码映射
      return;
    }

    // 契约：201 { ok: true }（统一接口文档 §2.1）
    sendOk(res, { ok: true }, 201);
  }
}

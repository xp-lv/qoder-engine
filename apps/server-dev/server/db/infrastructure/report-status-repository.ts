/**
 * ReportStatusRepository —— Prisma 实现（基础设施层）
 *
 * 遵循质量原则第 4 原则：实现领域层定义的 ReportStatusRepository 接口。
 * 后端 Service 依赖 ReportStatusRepository 接口（类型），本文件提供具体实现（值）。
 */
import type { ReportStatus, ReportStatusRepository as IReportStatusRepository } from '../domain/types';
import { prisma } from './prisma-client';

/**
 * 将 Prisma ReportStatus 行映射为领域实体 ReportStatus
 */
function toDomain(row: {
  id: number;
  code: string;
  label: string;
  sortOrder: number;
}): ReportStatus {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    sortOrder: row.sortOrder,
  };
}

/**
 * ReportStatusRepository 的 Prisma 实现
 *
 * 此表仅 3 行种子数据，服务启动时 findAll() 加载到内存缓存，
 * 之后高频查询走内存（findByCode），无需频繁访问数据库。
 */
export class ReportStatusRepositoryImpl implements IReportStatusRepository {
  /**
   * 按状态码查找（服务启动时缓存到内存）
   *
   * @param code 状态码：running / idle / error
   */
  async findByCode(code: string): Promise<ReportStatus | null> {
    const row = await prisma.reportStatus.findUnique({
      where: { code },
      select: {
        id: true,
        code: true,
        label: true,
        sortOrder: true,
      },
    });

    return row ? toDomain(row) : null;
  }

  /**
   * 全量查找（启动时加载缓存）
   *
   * report_status 仅 3 行，全量扫描无需额外索引（质量原则第 3 原则）。
   * 结果按 sortOrder 排序，便于前端按既定顺序展示。
   */
  async findAll(): Promise<ReportStatus[]> {
    const rows = await prisma.reportStatus.findMany({
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        code: true,
        label: true,
        sortOrder: true,
      },
    });

    return rows.map(toDomain);
  }
}

/**
 * QoderReportRepository —— Prisma 实现（基础设施层）
 *
 * 遵循质量原则第 4 原则：实现领域层定义的 QoderReportRepository 接口。
 * 后端 Service 依赖 QoderReportRepository 接口（类型），本文件提供具体实现（值）。
 *
 * 关键实现要点：
 * - create() 写操作包裹在事务中（质量原则第 6 原则：事务完整性）
 * - status 字符串 ↔ status_id 映射在 Repository 层完成（统一接口文档 §1.2 status 映射规则）
 * - findAllLatest() 使用 PostgreSQL DISTINCT ON 原生 SQL（Prisma 不支持 DISTINCT ON）
 * - 所有查询显式 select 字段（质量红线：不用 SELECT *）
 */
import { Prisma } from '@prisma/client';
import type {
  CreateReportInput,
  DeleteResult,
  OfflineInstance,
  PaginatedResult,
  QoderReport,
  QoderReportRepository as IQoderReportRepository,
} from '../domain/types';
import { getTransactionOptions, isSQLite } from '../config/database';
import { prisma } from './prisma-client';

/**
 * 事务隔离级别选项（验证适配：集中化 provider 检测）
 * fail_deep fix #2：统一从 config/database.ts 获取事务选项。
 * SQLite → undefined（Prisma SQLite 驱动 TransactionIsolationLevel 仅含 Serializable，
 *           传 ReadCommitted 会触发 tsc 类型错误）；PostgreSQL → { isolationLevel: 'ReadCommitted' }。
 * 本常量在模块加载时求值，全文件共享。
 */
const TX_OPTIONS = getTransactionOptions();

/**
 * 状态码解析器：将状态码字符串（running/idle/error）解析为 status_id 整数
 *
 * 由 ReportStatusRepository 在服务启动时加载到内存缓存构建。
 * 通过构造函数注入，避免 QoderReportRepository 直接依赖 ReportStatusRepository 的具体实现。
 */
export type StatusCodeResolver = (code: string) => Promise<number | null>;

/**
 * 状态码 → id 的反向解析器：用于查询结果 status_id → status 字符串映射
 * 由服务启动时加载的缓存构建（id → code 的 Map）。
 */
export type StatusIdResolver = (id: number) => string | null;

/**
 * Prisma 行类型（含 status 关联，用于映射领域实体）
 */
interface PrismaReportRow {
  id: number;
  instanceId: string;
  hostname: string;
  qoderVersion: string;
  statusId: number;
  uptime: number | null;
  cpuUsage: number | null;
  memUsage: number | null;
  workspaceCount: number | null;
  reportedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * 将 Prisma 行映射为领域实体 QoderReport
 *
 * status_id 整数 → status 状态码字符串（通过 StatusIdResolver 反向映射）
 * updated_at / deleted_at 不暴露给领域实体（append-only 表中 updatedAt 恒等于 createdAt）
 */
function toDomain(
  row: PrismaReportRow,
  resolveStatusId: StatusIdResolver
): QoderReport {
  return {
    id: row.id,
    instanceId: row.instanceId,
    hostname: row.hostname,
    qoderVersion: row.qoderVersion,
    status: resolveStatusId(row.statusId) ?? 'unknown', // status_id → code 映射
    uptime: row.uptime,
    cpuUsage: row.cpuUsage,
    memUsage: row.memUsage,
    workspaceCount: row.workspaceCount,
    reportedAt: row.reportedAt,
    createdAt: row.createdAt,
  };
}

/**
 * 显式 select 字段（遵循质量红线：不用 SELECT *，显式列出字段）
 */
const REPORT_SELECT = {
  id: true,
  instanceId: true,
  hostname: true,
  qoderVersion: true,
  statusId: true,
  uptime: true,
  cpuUsage: true,
  memUsage: true,
  workspaceCount: true,
  reportedAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} satisfies Prisma.QoderReportSelect;

/**
 * QoderReportRepository 的 Prisma 实现
 *
 * 构造函数注入状态解析器（依赖倒置），解耦与 ReportStatusRepository 的具体依赖。
 * 应用启动时：加载 report_status 缓存 → 构建两个 resolver → 注入本实现。
 */
export class QoderReportRepositoryImpl implements IQoderReportRepository {
  constructor(
    /** 状态码字符串 → status_id 解析器（create 时正向映射） */
    private readonly resolveStatusCode: StatusCodeResolver,
    /** status_id → 状态码字符串 解析器（查询时反向映射） */
    private readonly resolveStatusId: StatusIdResolver
  ) {}

  /**
   * 插入一条上报记录
   *
   * 写操作包裹在事务中（质量原则第 6 原则：事务完整性），确保原子性。
   * status 字符串 → status_id 映射在事务内完成。
   *
   * @throws {Error} 当 status code 无效（不在 running/idle/error 中）时抛出
   */
  async create(data: CreateReportInput): Promise<QoderReport> {
    // 1. 解析 status code → status_id
    const statusId = await this.resolveStatusCode(data.status);
    if (statusId === null) {
      throw new Error(
        `[QoderReportRepository.create] 无效的状态码："${data.status}"，` +
          '必须是 running / idle / error 之一'
      );
    }

    // 2. 写操作包裹在事务中（质量原则第 6 原则：事务完整性）
    //    即使是单条 INSERT 也用事务包裹，确保未来扩展多表写入时的原子性
    //    DI-005 fix：显式声明隔离级别 ReadCommitted，使配置真正生效
    const row = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        return tx.qoderReport.create({
          data: {
            instanceId: data.instanceId,
            hostname: data.hostname,
            qoderVersion: data.qoderVersion,
            statusId,
            uptime: data.uptime ?? null,
            cpuUsage: data.cpuUsage ?? null,
            memUsage: data.memUsage ?? null,
            workspaceCount: data.workspaceCount ?? null,
            reportedAt: data.reportedAt,
            // createdAt / updatedAt 由 DB 默认值 now() 填充
          },
          select: REPORT_SELECT,
        });
      },
      TX_OPTIONS
    );

    return toDomain(row, this.resolveStatusId);
  }

  /**
   * 查某实例最新上报（ORDER BY reported_at DESC LIMIT 1）
   *
   * 命中复合索引 idx_qoder_report_instance_reported（质量原则第 3 原则）
   * 过滤已软删除记录（deleted_at IS NULL）
   */
  async findLatestByInstance(instanceId: string): Promise<QoderReport | null> {
    const row = await prisma.qoderReport.findFirst({
      where: {
        instanceId,
        deletedAt: null, // 排除软删除记录
      },
      orderBy: { reportedAt: 'desc' },
      select: REPORT_SELECT,
    });

    return row ? toDomain(row as PrismaReportRow, this.resolveStatusId) : null;
  }

  /**
   * 查所有实例最新状态（DISTINCT ON (instance_id)）
   *
   * 使用 PostgreSQL 原生 DISTINCT ON（Prisma 不支持），命中复合索引。
   * HTTP 兜底场景使用（统一接口文档 §2.2 GET /api/instances）。
   *
   * 排除已软删除记录（deleted_at IS NULL）。
   */
  async findAllLatest(): Promise<QoderReport[]> {
    // 验证适配：SQLite 用 ROW_NUMBER() 替代 PostgreSQL DISTINCT ON
    if (isSQLite()) {
      // SQLite 兼容版：ROW_NUMBER() OVER (PARTITION BY ...) AS rn，取 rn=1
      const rows = await prisma.$queryRaw<PrismaReportRow[]>(Prisma.sql`
        SELECT id, instance_id AS "instanceId", hostname,
          qoder_version AS "qoderVersion", status_id AS "statusId",
          uptime, cpu_usage AS "cpuUsage", mem_usage AS "memUsage",
          workspace_count AS "workspaceCount",
          reported_at AS "reportedAt", created_at AS "createdAt",
          updated_at AS "updatedAt", deleted_at AS "deletedAt"
        FROM (
          SELECT *,
            ROW_NUMBER() OVER (PARTITION BY instance_id ORDER BY reported_at DESC) AS rn
          FROM qoder_report
          WHERE deleted_at IS NULL
        ) WHERE rn = 1
        ORDER BY reported_at DESC
      `);
      return rows.map((row) => toDomain(row, this.resolveStatusId));
    }

    // PostgreSQL 原生版：DISTINCT ON（Prisma 不支持），命中复合索引
    // DI-004 fix：子查询使用显式列名而非 SELECT *，遵循质量红线"不用 SELECT *"
    const pgRows = await prisma.$queryRaw<PrismaReportRow[]>(Prisma.sql`
      SELECT
        id, instance_id AS "instanceId", hostname,
        qoder_version AS "qoderVersion", status_id AS "statusId",
        uptime, cpu_usage AS "cpuUsage", mem_usage AS "memUsage",
        workspace_count AS "workspaceCount",
        reported_at AS "reportedAt", created_at AS "createdAt",
        updated_at AS "updatedAt", deleted_at AS "deletedAt"
      FROM (
        SELECT DISTINCT ON (instance_id)
          id, instance_id, hostname, qoder_version, status_id,
          uptime, cpu_usage, mem_usage, workspace_count,
          reported_at, created_at, updated_at, deleted_at
        FROM qoder_report
        WHERE deleted_at IS NULL
        ORDER BY instance_id, reported_at DESC
      ) latest
      ORDER BY reported_at DESC
    `);

    return pgRows.map((row) => toDomain(row, this.resolveStatusId));
  }

  /**
   * 分页查历史上报，reported_at DESC 倒序
   *
   * 命中复合索引 idx_qoder_report_instance_reported。
   * 统一接口文档 §2.3 GET /api/instances/:id/history。
   *
   * @param page 页码（≥1，由应用层校验）
   * @param limit 每页条数（∈ [1, 200]，由应用层校验，响应 R-003）
   */
  async findHistoryByInstance(
    instanceId: string,
    page: number,
    limit: number
  ): Promise<PaginatedResult<QoderReport>> {
    // 并行查询：当前页数据 + 总数（两次查询命中同一索引）
    const [rows, total] = await Promise.all([
      prisma.qoderReport.findMany({
        where: {
          instanceId,
          deletedAt: null, // 排除软删除记录
        },
        orderBy: { reportedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: REPORT_SELECT,
      }),
      prisma.qoderReport.count({
        where: {
          instanceId,
          deletedAt: null,
        },
      }),
    ]);

    return {
      items: rows.map((row) => toDomain(row as PrismaReportRow, this.resolveStatusId)),
      total,
      page,
    };
  }

  /**
   * DB 兜底离线检测：最后上报时间超过阈值的实例（响应 R-002）
   *
   * 返回每个实例的最后上报时间，由应用层判定是否超过阈值。
   * 命中复合索引 idx_qoder_report_instance_reported。
   *
   * @param thresholdSec 阈值秒数（最后上报时间距今超过此值视为离线）
   */
  async findOfflineInstances(thresholdSec: number): Promise<OfflineInstance[]> {
    // 计算阈值时间点：now() - thresholdSec
    const thresholdDate = new Date(Date.now() - thresholdSec * 1000);

    // 查询每个实例的最后上报时间，过滤超过阈值的
    const rows = await prisma.$queryRaw<{ instance_id: string; last_reported_at: Date }[]>(
      Prisma.sql`
        SELECT instance_id, MAX(reported_at) AS last_reported_at
        FROM qoder_report
        WHERE deleted_at IS NULL
        GROUP BY instance_id
        HAVING MAX(reported_at) < ${thresholdDate}
      `
    );

    return rows.map((row) => ({
      instanceId: row.instance_id,
      lastReportedAt: row.last_reported_at,
    }));
  }

  /**
   * 数据保留策略：软删除 reported_at < before 的记录（设置 deleted_at）
   *
   * 运维/批处理用途（统一接口文档 C-04）：由运维脚本定期调用，非应用运行时高频路径。
   *
   * 写操作包裹在事务中（质量原则第 6 原则：事务完整性），确保批量更新原子性。
   * 仅更新 deleted_at 为 NULL 的记录（避免重复软删除）。
   */
  async softDeleteBefore(before: Date): Promise<DeleteResult> {
    // 批量更新包裹在事务中（DI-005 fix：显式声明隔离级别）
    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        return tx.qoderReport.updateMany({
          where: {
            reportedAt: { lt: before },
            deletedAt: null, // 仅软删除尚未删除的记录
          },
          data: {
            deletedAt: new Date(), // 设置软删除时间戳
          },
        });
      },
      TX_OPTIONS
    );

    return { count: result.count };
  }
}

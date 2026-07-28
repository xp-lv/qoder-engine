/**
 * 领域层类型定义 —— 数据层设计 §4
 *
 * 本文件定义领域实体与 Repository 接口（接口契约）。
 * 遵循质量原则第 4 原则：Repository 接口定义在领域层，实现在基础设施层。
 * 后端 Service 只依赖这里的接口，不直接调用 Prisma Client。
 *
 * 关键设计：
 * - QoderReport.status 为状态码字符串（running/idle/error），非 status_id 整数
 *   （与 API 层 status 映射规则一致，见统一接口文档 §1.2）
 * - Repository 接口屏蔽 Prisma 实现细节，业务逻辑可测试、可替换
 */

// ============================================================
// 领域实体
// ============================================================

/**
 * qoder 上报记录（领域实体）
 *
 * status 为状态码字符串（running/idle/error），由 Repository 层从 status_id 映射而来。
 * created_at 暴露给 ReportDTO（历史记录），updated_at / deleted_at 不暴露给 API。
 */
export interface QoderReport {
  id: number;
  instanceId: string;
  hostname: string;
  qoderVersion: string;
  status: string; // 状态码字符串（running / idle / error）
  uptime: number | null;
  cpuUsage: number | null;
  memUsage: number | null;
  workspaceCount: number | null;
  reportedAt: Date;
  createdAt: Date;
}

/**
 * 状态查找记录（领域实体）
 */
export interface ReportStatus {
  id: number;
  code: string; // running / idle / error
  label: string;
  sortOrder: number;
}

// ============================================================
// 输入类型
// ============================================================

/**
 * 创建上报记录的输入
 *
 * status 为状态码字符串（running/idle/error），Repository 层负责解析为 status_id。
 */
export interface CreateReportInput {
  instanceId: string;
  hostname: string;
  qoderVersion: string;
  status: string; // 状态码字符串
  uptime?: number | null;
  cpuUsage?: number | null;
  memUsage?: number | null;
  workspaceCount?: number | null;
  reportedAt: Date;
}

/**
 * 离线实例查询结果
 */
export interface OfflineInstance {
  instanceId: string;
  lastReportedAt: Date;
}

/**
 * 分页查询结果
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
}

/**
 * 软删除操作结果
 */
export interface DeleteResult {
  count: number;
}

// ============================================================
// Repository 接口（领域层定义，基础设施层实现）
// ============================================================

/**
 * QoderReport 仓储接口 —— 数据层设计 §4.1
 *
 * 实现：见 db/infrastructure/qoder-report-repository.ts（Prisma 实现）
 * 后端 Service 通过依赖注入获取此接口的实例，不直接调用 Prisma Client。
 *
 * 方法用途标注（响应统一接口文档 C-04）：
 * - create / findLatestByInstance / findHistoryByInstance → 应用运行时（REST API 调用）
 * - findAllLatest → 应用运行时（HTTP 兜底 + WS snapshot 推送）
 * - findOfflineInstances → 应用运行时（离线检测兜底，R-002 响应）
 * - softDeleteBefore → 运维/批处理用途（数据保留策略归档，由运维脚本调用）
 */
export interface QoderReportRepository {
  /** 插入一条上报记录；status 由 code 字符串解析为 status_id */
  create(data: CreateReportInput): Promise<QoderReport>;

  /** 查某实例最新上报（ORDER BY reported_at DESC LIMIT 1） */
  findLatestByInstance(instanceId: string): Promise<QoderReport | null>;

  /** 查所有实例最新状态（DISTINCT ON (instance_id)，HTTP 兜底用） */
  findAllLatest(): Promise<QoderReport[]>;

  /** 分页查历史上报，reported_at DESC 倒序 */
  findHistoryByInstance(
    instanceId: string,
    page: number,
    limit: number
  ): Promise<PaginatedResult<QoderReport>>;

  /** DB 兜底离线检测：最后上报时间超过阈值的实例（响应 R-002） */
  findOfflineInstances(thresholdSec: number): Promise<OfflineInstance[]>;

  /** 数据保留策略：软删除 reported_at < before 的记录（设置 deleted_at） */
  softDeleteBefore(before: Date): Promise<DeleteResult>;
}

/**
 * ReportStatus 仓储接口 —— 数据层设计 §4.2
 *
 * 实现：见 db/infrastructure/report-status-repository.ts（Prisma 实现）
 */
export interface ReportStatusRepository {
  /** 按状态码查找（服务启动时缓存到内存） */
  findByCode(code: string): Promise<ReportStatus | null>;

  /** 全量查找（启动时加载缓存） */
  findAll(): Promise<ReportStatus[]>;
}

/**
 * 数据层统一出口（Barrel Export）
 *
 * 后端 Service 通过此文件 import 数据层能力：
 *   import { type QoderReportRepository, createRepositories } from '@/db';
 *
 * 遵循质量原则第 4 原则：业务逻辑只依赖 Repository 接口（类型），
 * 通过 createRepositories() 工厂函数获取具体实现（值）。
 */

// 领域类型 & Repository 接口（类型导出）
export type {
  QoderReport,
  ReportStatus,
  CreateReportInput,
  OfflineInstance,
  PaginatedResult,
  DeleteResult,
  QoderReportRepository,
  ReportStatusRepository,
} from './domain/types';

// Repository 实现（值导出，供工厂函数使用）
export { QoderReportRepositoryImpl } from './infrastructure/qoder-report-repository';
export type { StatusCodeResolver, StatusIdResolver } from './infrastructure/qoder-report-repository';
export { ReportStatusRepositoryImpl } from './infrastructure/report-status-repository';

// Prisma Client（供基础设施层使用，业务逻辑不应直接 import）
export { prisma, getPrismaClient, disconnectPrisma } from './infrastructure/prisma-client';

// 数据库配置（供应用启动入口调用 fail-fast 校验）
// fail_deep fix #2：导出 getTransactionOptions/isSQLite 供后端统一使用事务选项
export { validateEnv, getDatabaseConfig, getTransactionOptions, isSQLite } from './config/database';
export type { DatabaseConfig, TransactionOptions } from './config/database';

import { validateEnv } from './config/database';
import { ReportStatusRepositoryImpl } from './infrastructure/report-status-repository';
import {
  QoderReportRepositoryImpl,
  type StatusCodeResolver,
  type StatusIdResolver,
} from './infrastructure/qoder-report-repository';
import type {
  QoderReportRepository,
  ReportStatusRepository,
} from './domain/types';

/**
 * 数据层工厂函数 —— 应用启动时调用
 *
 * 流程：
 * 1. validateEnv() —— fail-fast 校验必需环境变量（DATABASE_URL）
 * 2. 加载 report_status 缓存（构建 statusCode/id 双向 resolver）
 * 3. 构造 Repository 实现并返回
 *
 * 后端 Service 通过依赖注入获取 Repository 接口实例。
 *
 * @returns { reportRepo, statusRepo } —— Repository 接口实例
 */
export async function createRepositories(): Promise<{
  reportRepo: QoderReportRepository;
  statusRepo: ReportStatusRepository;
}> {
  // 1. fail-fast 环境变量校验
  validateEnv();

  // 2. 加载 report_status 到内存缓存，构建双向 resolver
  const statusRepo = new ReportStatusRepositoryImpl();
  const allStatuses = await statusRepo.findAll();

  // 构建 code → id 映射（create 时正向映射）
  const codeToId = new Map<string, number>();
  // 构建 id → code 映射（查询时反向映射）
  const idToCode = new Map<number, string>();

  for (const status of allStatuses) {
    codeToId.set(status.code, status.id);
    idToCode.set(status.id, status.code);
  }

  const resolveStatusCode: StatusCodeResolver = async (code: string) =>
    codeToId.get(code) ?? null;
  const resolveStatusId: StatusIdResolver = (id: number) =>
    idToCode.get(id) ?? null;

  // 3. 构造 QoderReportRepository（注入 resolver）
  const reportRepo = new QoderReportRepositoryImpl(resolveStatusCode, resolveStatusId);

  return { reportRepo, statusRepo };
}

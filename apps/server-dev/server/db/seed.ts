/**
 * 种子数据脚本 —— 数据层设计 §2.1
 *
 * 职责：向 report_status 表插入 3 条种子数据（running / idle / error）
 *
 * 注意：初始迁移脚本（migrations/20260725_001_init_schema.ts）已包含种子数据 INSERT。
 *       本脚本作为独立工具，用于：
 *       ① 迁移后重新校验/补充种子数据
 *       ② 测试环境重置后快速初始化
 *
 * 使用方式：tsx db/seed.ts
 *
 * 写操作包裹在事务中（质量原则第 6 原则），使用 upsert 确保幂等可重复执行。
 */
import { Prisma } from '@prisma/client';
import { prisma, disconnectPrisma } from './infrastructure/prisma-client';
import { getTransactionOptions, isSQLite } from './config/database';

/** 种子数据定义（与数据层设计 §2.1 一致） */
const SEED_STATUSES = [
  { id: 1, code: 'running', label: '运行中', sortOrder: 1 },
  { id: 2, code: 'idle', label: '空闲', sortOrder: 2 },
  { id: 3, code: 'error', label: '错误', sortOrder: 3 },
] as const;

/**
 * 执行种子数据插入（幂等）
 *
 * 使用 upsert：已存在则更新 label/sortOrder，不存在则插入。
 * 整个操作包裹在事务中确保原子性。
 */
async function seed(): Promise<void> {
  console.log('[seed] 开始插入 report_status 种子数据...');

  // 写操作包裹在事务中（质量原则第 6 原则）
  // fail_deep fix #2：统一使用 getTransactionOptions() 做 provider 条件化
  await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      for (const status of SEED_STATUSES) {
        await tx.reportStatus.upsert({
          where: { code: status.code },
          update: {
            label: status.label,
            sortOrder: status.sortOrder,
          },
          create: {
            id: status.id,
            code: status.code,
            label: status.label,
            sortOrder: status.sortOrder,
          },
        });
      }
      // 重置自增序列：仅 PostgreSQL 需要（SQLite AUTOINCREMENT 自管理）
      // fail_deep fix #1：SQLite 无 setval 函数，按 provider 条件化执行
      if (!isSQLite()) {
        await tx.$executeRawUnsafe(
          `SELECT setval('report_status_id_seq', COALESCE((SELECT MAX(id) FROM report_status), 1), true)`
        );
      }
    },
    getTransactionOptions()
  );

  // 校验插入结果
  const count = await prisma.reportStatus.count();
  console.log(`[seed] ✓ 完成。report_status 表当前 ${count} 条记录。`);

  if (count !== 3) {
    throw new Error(`[seed] 种子数据数量异常：期望 3 条，实际 ${count} 条`);
  }
}

/**
 * CLI 入口
 */
async function main(): Promise<void> {
  try {
    await seed();
  } catch (err) {
    console.error('[seed] 种子数据插入失败：', err);
    process.exit(1);
  } finally {
    await disconnectPrisma();
  }
}

// 仅在直接执行时运行
if (require.main === module) {
  main();
}

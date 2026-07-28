-- ============================================================
-- qoder 监控系统 —— 初始数据库 Schema
-- 来源：数据层设计 §2 + 统一接口文档 §1
-- 说明：此文件为 schema 的 SQL 真相源（source of truth）。
--       ★ 生产环境使用 PostgreSQL 15（下方 DDL）；
--       ★ 本地验证环境使用 SQLite（见文末 §SQLite 兼容版 DDL）。
--       实际迁移由 db/migrations/ 下的可回滚迁移脚本执行（方言感知）。
-- 命名约定：DB 列名 snake_case ↔ Prisma 模型字段 camelCase（@map 桥接）↔ API JSON camelCase
-- ============================================================

-- 启用扩展（如需要）
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid() 等（当前用自增主键，暂不需要）

-- ------------------------------------------------------------
-- 1. report_status（状态查找表）
-- 遵循质量原则第 2 原则：枚举用查找表而非 CHECK 约束，便于扩展状态值
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_status (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(20)  NOT NULL,                  -- 状态码：running / idle / error
    label       VARCHAR(50)  NOT NULL,                  -- 显示标签：运行中 / 空闲 / 错误
    sort_order  INTEGER      NOT NULL DEFAULT 0,        -- 排序权重
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),    -- 审计：创建时间（UTC 无时区）
    updated_at  TIMESTAMP    NOT NULL DEFAULT NOW(),    -- 审计：更新时间（UTC 无时区）
    CONSTRAINT report_status_code_key UNIQUE (code)
);

-- ------------------------------------------------------------
-- 2. qoder_report（qoder 上报记录，append-only）
-- 核心实体。每次 Ext 上报插入一行，不更新、不删除（软删除仅用于数据保留归档）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qoder_report (
    id              SERIAL PRIMARY KEY,                          -- 记录唯一标识
    instance_id     VARCHAR(36)  NOT NULL,                       -- Ext 端生成的 UUID 实例标识
    hostname        VARCHAR(255) NOT NULL,                       -- 上报机器主机名
    qoder_version   VARCHAR(50)  NOT NULL,                       -- qoder 版本号（如 1.4.0）
    status_id       INTEGER      NOT NULL,                       -- 运行状态外键 → report_status(id)
    uptime          INTEGER      CHECK (uptime >= 0),            -- qoder 运行时长（秒），可空
    cpu_usage       DOUBLE PRECISION CHECK (cpu_usage BETWEEN 0 AND 100), -- CPU 使用率（%），可空
    mem_usage       DOUBLE PRECISION CHECK (mem_usage BETWEEN 0 AND 100), -- 内存使用率（%），可空
    workspace_count INTEGER      CHECK (workspace_count >= 0),   -- 工作区数量，可空
    reported_at     TIMESTAMP    NOT NULL,                       -- Ext 端上报时间（UTC 存储）
    created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),         -- 服务器接收时间（审计）
    updated_at      TIMESTAMP    NOT NULL DEFAULT NOW(),         -- 审计字段（恒等于 created_at）
    deleted_at      TIMESTAMP,                                   -- 软删除标记（正常运营为 NULL）
    CONSTRAINT fk_qoder_report_status
        FOREIGN KEY (status_id) REFERENCES report_status (id)
        ON DELETE RESTRICT                                      -- 质量红线：外键不留孤儿记录
);

-- ------------------------------------------------------------
-- 3. 索引（遵循质量原则第 3 原则——索引跟着查询走）
-- 索引总数 2 个（含 PK），覆盖全部高频查询，单表 ≤ 6
-- ------------------------------------------------------------
-- 复合索引：覆盖 F-003 历史分页查询 + F-002 最新状态聚合 + R-002 离线检测兜底
-- 顺序说明：instance_id 区分度高（≤100 实例）在前，reported_at DESC 排序键在后
CREATE INDEX IF NOT EXISTS idx_qoder_report_instance_reported
    ON qoder_report (instance_id, reported_at DESC);

-- report_status 仅 3 行，status_id FK JOIN 走顺序扫描即可，不加索引

-- ============================================================
-- SQLite 兼容版 DDL（本地验证环境，DATABASE_URL="file:./dev.db"）
-- fail_deep fix #1：迁移脚本根据 provider 自动选择以下语法
-- 差异点：SERIAL → INTEGER PRIMARY KEY AUTOINCREMENT
--         NOW()  → CURRENT_TIMESTAMP
--         DOUBLE PRECISION → REAL
--         setval() → 省略（AUTOINCREMENT 自管理）
-- ============================================================
-- CREATE TABLE IF NOT EXISTS report_status (
--     id          INTEGER PRIMARY KEY AUTOINCREMENT,
--     code        VARCHAR(20)  NOT NULL,
--     label       VARCHAR(50)  NOT NULL,
--     sort_order  INTEGER      NOT NULL DEFAULT 0,
--     created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     CONSTRAINT report_status_code_key UNIQUE (code)
-- );
-- CREATE TABLE IF NOT EXISTS qoder_report (
--     id              INTEGER PRIMARY KEY AUTOINCREMENT,
--     instance_id     VARCHAR(36)  NOT NULL,
--     hostname        VARCHAR(255) NOT NULL,
--     qoder_version   VARCHAR(50)  NOT NULL,
--     status_id       INTEGER      NOT NULL,
--     uptime          INTEGER      CHECK (uptime >= 0),
--     cpu_usage       REAL         CHECK (cpu_usage BETWEEN 0 AND 100),
--     mem_usage       REAL         CHECK (mem_usage BETWEEN 0 AND 100),
--     workspace_count INTEGER      CHECK (workspace_count >= 0),
--     reported_at     TIMESTAMP    NOT NULL,
--     created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     deleted_at      TIMESTAMP,
--     CONSTRAINT fk_qoder_report_status
--         FOREIGN KEY (status_id) REFERENCES report_status (id)
--         ON DELETE RESTRICT
-- );
-- CREATE INDEX IF NOT EXISTS idx_qoder_report_instance_reported
--     ON qoder_report (instance_id, reported_at DESC);

-- ============================================================
-- END OF SCHEMA
-- ============================================================

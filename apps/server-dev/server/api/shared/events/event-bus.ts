/**
 * 进程内事件总线接口 —— 解耦 report 与 instance 领域
 *
 * 遵循质量原则第 1 原则：模块之间通过显式接口通信，不直接 import 对方内部实现。
 * report 领域在持久化后 publish("report.received")，instance 领域订阅以驱动实时推送/离线检测。
 *
 * 事件主题契约：
 * - "report.received"   payload: { instanceId: string; reportId: number; createdAt: Date }
 * - "instance.stale-changed" payload: { instanceId: string; effectiveStatus: EffectiveStatus; reportedAt: string }
 *
 * 实现见 infra/events/in-memory-event-bus.ts（组合根注入）。
 */

/** 事件总线抽象接口（领域层定义） */
export interface IEventBus {
  /** 发布事件（同步派发给当前所有订阅者） */
  publish<T>(topic: string, payload: T): void;
  /** 订阅事件主题 */
  subscribe<T>(topic: string, handler: (payload: T) => void): void;
}

/** 事件主题常量（避免魔术字符串） */
export const EventTopic = {
  REPORT_RECEIVED: 'report.received',
  INSTANCE_STALE_CHANGED: 'instance.stale-changed',
} as const;

/** "report.received" 事件载荷 */
export interface ReportReceivedEvent {
  readonly instanceId: string;
  readonly reportId: number;
  readonly createdAt: Date;
}

/**
 * 进程内事件总线实现（基础设施层）
 *
 * 实现领域层 IEventBus 接口（依赖倒置：领域定义接口，基础设施实现）。
 * 同步派发，单进程适用（单用户监控系统无需跨进程消息队列）。
 *
 * 订阅者异常被捕获并记录，避免一个订阅者失败影响其他订阅者或发布者。
 */
import type { IEventBus } from '../../shared/events/event-bus';
import { logger } from '../../shared/logger';

type Handler = (payload: unknown) => void;

export class InMemoryEventBus implements IEventBus {
  private readonly handlers = new Map<string, Set<Handler>>();

  publish<T>(topic: string, payload: T): void {
    const subs = this.handlers.get(topic);
    if (!subs) {
      return;
    }
    for (const handler of subs) {
      try {
        handler(payload as unknown);
      } catch (e) {
        // 订阅者异常隔离：记录但不中断其他订阅者
        logger.error({ topic, err: e }, '事件订阅者处理异常');
      }
    }
  }

  subscribe<T>(topic: string, handler: (payload: T) => void): void {
    let subs = this.handlers.get(topic);
    if (!subs) {
      subs = new Set<Handler>();
      this.handlers.set(topic, subs);
    }
    subs.add(handler as Handler);
  }
}

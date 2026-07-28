/**
 * 全局监控状态（Zustand store）——质量原则第 4 原则：状态机思维。
 *
 * 包含两台状态机：
 *  1. WebSocket 连接态：connecting → connected / reconnecting / error
 *  2. 实例字典：snapshot 全量替换 / report 增量 upsert / status 更新 effectiveStatus
 *
 * 采用「服务端权威派生」（C-01）：effectiveStatus 由后端 status 消息维护，
 * 前端不再本地 isStale 重复计算，避免 ±5s 时钟偏移导致状态闪烁（单一事实来源）。
 */
import { create } from 'zustand';
import type { Instance, StatusMessageData } from '../types';

/** WebSocket 连接状态机（质量原则第 4 原则） */
export type WsState =
  | { status: 'connecting' }
  | { status: 'connected' }
  | { status: 'reconnecting'; attempt: number }
  | { status: 'error'; message: string };

export interface MonitorStore {
  wsState: WsState;
  /** instanceId → 最新上报（snapshot 全量替换，report 增量 upsert） */
  instances: Map<string, Instance>;
  /** 最近一次收到消息的时间戳（用于「最后更新」展示） */
  lastUpdated: number | null;

  // ---- actions ----
  setWsState: (s: WsState) => void;
  /** snapshot → 重建 Map */
  applySnapshot: (items: Instance[]) => void;
  /** report → upsert 单条 */
  applyReport: (item: Instance) => void;
  /** status → 更新单条 effectiveStatus（C-01 服务端权威派生） */
  applyStatus: (data: StatusMessageData) => void;
  /** HTTP 兜底全量替换（WS 不可用时） */
  replaceAll: (items: Instance[]) => void;
  reset: () => void;
}

export const useMonitorStore = create<MonitorStore>((set) => ({
  wsState: { status: 'connecting' },
  instances: new Map(),
  lastUpdated: null,

  setWsState: (s) => set({ wsState: s }),

  applySnapshot: (items) => {
    const map = new Map<string, Instance>();
    for (const item of items) {
      map.set(item.instanceId, item);
    }
    set({ instances: map, lastUpdated: Date.now() });
  },

  applyReport: (item) =>
    set((state) => {
      const map = new Map(state.instances);
      map.set(item.instanceId, item);
      return { instances: map, lastUpdated: Date.now() };
    }),

  applyStatus: (data) =>
    set((state) => {
      const prev = state.instances.get(data.instanceId);
      if (!prev) return state; // 未知实例，忽略
      const map = new Map(state.instances);
      map.set(data.instanceId, { ...prev, effectiveStatus: data.effectiveStatus });
      return { instances: map, lastUpdated: Date.now() };
    }),

  replaceAll: (items) => {
    const map = new Map<string, Instance>();
    for (const item of items) {
      map.set(item.instanceId, item);
    }
    set({ instances: map, lastUpdated: Date.now() });
  },

  reset: () => set({ wsState: { status: 'connecting' }, instances: new Map(), lastUpdated: null }),
}));

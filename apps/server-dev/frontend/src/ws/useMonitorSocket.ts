/**
 * useMonitorSocket —— WebSocket 连接管理 Hook（红队 R-004 重连策略）。
 *
 * 指数退避：初始 1s → ×2 → 上限 30s，无限重试。
 * 消费后端三类消息（snapshot / report / status），统一写入 Zustand store。
 * 服务端 30s ping，浏览器原生 WebSocket 自动回 pong（无需手动处理）。
 */
import { useEffect, useRef } from 'react';
import { config } from '../config/env';
import { useMonitorStore } from '../store/useMonitorStore';
import type { WsMessage } from '../types';

export function useMonitorSocket(): void {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const manualCloseRef = useRef(false);

  useEffect(() => {
    const { setWsState, applySnapshot, applyReport, applyStatus } = useMonitorStore.getState();
    manualCloseRef.current = false;

    const clearReconnectTimer = () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };

    /** 计算下一次重连延迟（指数退避，封顶 30s） */
    const nextDelay = () => {
      const { initialDelayMs, maxDelayMs, multiplier } = config.wsReconnect;
      const delay = Math.min(initialDelayMs * multiplier ** attemptRef.current, maxDelayMs);
      return delay;
    };

    const connect = () => {
      setWsState(attemptRef.current === 0 ? { status: 'connecting' } : { status: 'reconnecting', attempt: attemptRef.current });
      const ws = new WebSocket(config.wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        setWsState({ status: 'connected' });
      };

      ws.onmessage = (event) => {
        let msg: WsMessage;
        try {
          msg = JSON.parse(event.data) as WsMessage;
        } catch {
          return; // 忽略无法解析的消息
        }
        switch (msg.type) {
          case 'snapshot':
            applySnapshot(msg.data ?? []);
            break;
          case 'report':
            applyReport(msg.data);
            break;
          case 'status':
            applyStatus(msg.data);
            break;
          default:
            // ping/pong 由浏览器原生处理，其余未知类型忽略
            break;
        }
      };

      ws.onerror = () => {
        // 错误事件后通常跟随 close，重连逻辑在 onclose 中处理
      };

      ws.onclose = () => {
        if (manualCloseRef.current) return;
        attemptRef.current += 1;
        setWsState({ status: 'reconnecting', attempt: attemptRef.current });
        const delay = nextDelay();
        clearReconnectTimer();
        reconnectTimer.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      manualCloseRef.current = true;
      clearReconnectTimer();
      const ws = wsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

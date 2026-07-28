/**
 * RealtimeGateway —— WebSocket 网关（连接管理 + snapshot/report/status 广播）
 *
 * 后端设计 §2.3 / §6.3。面向前端 SPA（Ext 不使用 WS）。
 *
 * 消息契约（统一接口文档 §2.4）：
 *   - 连接建立 → 推送 { type: "snapshot", data: InstanceDTO[] }
 *   - report.received 事件 → 拉取该实例最新状态 → 广播 { type: "report", data: InstanceDTO }
 *   - instance.stale-changed 事件 → 广播 { type: "status", data: { instanceId, effectiveStatus, reportedAt } }
 *   - 心跳：服务端按间隔发 "ping"；客户端回 "pong"（配合 R-004）
 *
 * 依赖 IInstanceService 抽象接口（依赖倒置，gateway 不直接操作数据库）。
 */
import { WebSocket, type RawData } from 'ws';
import type { WebSocketServer } from 'ws';
import type { ReportReceivedEvent } from '../../shared/events/event-bus';
import type { EffectiveStatus } from '../../shared/types/status';
import { logger } from '../../shared/logger';
import type { InstanceDTO } from './instance.dto';
import type { IInstanceService } from './instance.service';

/** status 消息载荷（统一接口文档 §2.4） */
export interface StatusMessageData {
  instanceId: string;
  effectiveStatus: EffectiveStatus;
  reportedAt: string;
}

/** 出站 WS 消息联合类型 */
export type WsOutbound =
  | { type: 'snapshot'; data: InstanceDTO[] }
  | { type: 'report'; data: InstanceDTO }
  | { type: 'status'; data: StatusMessageData };

export interface RealtimeGatewayDeps {
  wss: WebSocketServer;
  instanceService: IInstanceService;
  /** 心跳 ping 间隔 ms（默认 30_000） */
  heartbeatIntervalMs: number;
}

interface ClientState {
  ws: WebSocket;
  isAlive: boolean;
}

export class RealtimeGateway {
  private readonly clients = new Set<ClientState>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: RealtimeGatewayDeps) {}

  /** 注册连接监听 + 启动心跳；订阅事件由组合根通过 onReportReceived/onStaleChanged 绑定 */
  start(): void {
    this.deps.wss.on('connection', (ws) => this.handleConnection(ws));
    this.startHeartbeat();
  }

  /** 停止心跳（优雅关闭时调用） */
  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** 事件处理：report.received → 广播该实例最新状态 */
  async onReportReceived(event: ReportReceivedEvent): Promise<void> {
    const latest = await this.deps.instanceService.getLatest(event.instanceId);
    if (!latest) {
      return;
    }
    this.broadcast({ type: 'report', data: latest });
  }

  /** 事件处理：instance.stale-changed → 广播 status 消息 */
  onStaleChanged(data: StatusMessageData): void {
    this.broadcast({ type: 'status', data });
  }

  /** 新连接：发 snapshot + 注册心跳/关闭监听 */
  private handleConnection(ws: WebSocket): void {
    const client: ClientState = { ws, isAlive: true };
    this.clients.add(client);

    ws.on('pong', () => {
      client.isAlive = true;
    });
    ws.on('message', (data) => this.onMessage(data, ws));
    ws.on('close', () => {
      this.clients.delete(client);
    });
    ws.on('error', (e) => {
      logger.warn({ err: e }, 'WebSocket 客户端错误');
      this.clients.delete(client);
    });

    // 连接建立即推送 snapshot（统一接口文档 §2.4）
    this.sendSnapshot(ws).catch((e) =>
      logger.error({ err: e }, '推送 snapshot 失败'),
    );
  }

  /** 处理入站消息（应用层心跳 + 预留扩展点） */
  private onMessage(data: RawData, ws: WebSocket): void {
    const text = data.toString();
    if (text === 'ping') {
      // 应用层心跳：客户端主动发文本 'ping'，服务端回 'pong'（统一接口文档 §2.4 C↔S 心跳保活）
      // 与协议层 ws.ping()/pong()（startHeartbeat）互补，供使用应用层心跳的前端库使用。
      this.sendRaw(ws, 'pong');
      return;
    }
    logger.debug({ msg: text }, '收到 WebSocket 消息');
  }

  /** 向单个连接推送全量实例快照 */
  private async sendSnapshot(ws: WebSocket): Promise<void> {
    const items = await this.deps.instanceService.listLatest();
    this.send(ws, { type: 'snapshot', data: items });
  }

  /** 心跳：周期性 ping，未响应的连接强制断开（配合 R-004） */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients) {
        if (!client.isAlive) {
          client.ws.terminate();
          this.clients.delete(client);
          continue;
        }
        client.isAlive = false;
        try {
          client.ws.ping();
        } catch {
          this.clients.delete(client);
        }
      }
    }, this.deps.heartbeatIntervalMs);
  }

  /** 向所有连接广播消息 */
  private broadcast(message: WsOutbound): void {
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      this.sendRaw(client.ws, payload);
    }
  }

  /** 向单个连接发送结构化消息 */
  private send(ws: WebSocket, message: WsOutbound): void {
    this.sendRaw(ws, JSON.stringify(message));
  }

  /** 发送原始字符串（连接非开启时跳过） */
  private sendRaw(ws: WebSocket, payload: string): void {
    // BI-002 fix：ws@8 中 OPEN 为 WebSocket 静态常量（=1），实例属性 ws.OPEN 为 undefined，
    // 故须引用 WebSocket.OPEN（见文件顶部值导入），否则 readyState === undefined 恒 false，全部出站消息被丢弃。
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

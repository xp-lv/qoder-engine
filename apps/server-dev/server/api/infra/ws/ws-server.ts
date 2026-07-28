/**
 * WebSocket 服务器初始化（基础设施层）
 *
 * 遵循后端设计 §6.3：WS 与 REST 共用端口 3000，path=/ws。
 * 使用 ws 8 挂载到同一 HTTP 服务器（server 选项），由 RealtimeGateway 管理连接生命周期。
 *
 * 生产环境在 handleUpgrade 阶段校验 origin（仅放行 corsOrigins）；开发环境放行所有 origin。
 */
import type { Server } from 'http';
import { WebSocketServer } from 'ws';

export interface WsServerOptions {
  /** HTTP 服务器（与 REST 共用） */
  server: Server;
  /** 允许的 origin 列表（生产环境校验） */
  allowedOrigins: string[];
  /** 是否生产环境（生产环境强制 origin 校验） */
  isProd: boolean;
}

/**
 * 创建 WebSocket 服务器（path=/ws）
 */
export function createWsServer(options: WsServerOptions): WebSocketServer {
  const { server, allowedOrigins, isProd } = options;

  const wss = new WebSocketServer({
    noServer: true, // 手动 handleUpgrade 以校验 origin
  });

  server.on('upgrade', (req, socket, head) => {
    // 仅处理 /ws 路径，其他 upgrade 请求拒绝
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== '/ws') {
      socket.destroy();
      return;
    }

    // 生产环境校验 origin（后端设计 §3.2）
    if (isProd) {
      const origin = req.headers.origin ?? '';
      const allowStar = allowedOrigins.includes('*');
      if (!allowStar && !allowedOrigins.includes(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  return wss;
}

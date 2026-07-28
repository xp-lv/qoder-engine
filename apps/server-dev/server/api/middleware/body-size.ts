/**
 * 请求体大小限制中间件 —— 防超大 payload
 *
 * 后端设计 §5：上报体很小（单条 JSON < 1KB），限制请求体大小防止异常/恶意大 payload。
 * 作为 express.json({ limit }) 的补充防线（在 JSON 解析前以原始字节数拦截）。
 */
import type { RequestHandler } from 'express';
import { ErrorCode } from '../shared/types/errors';
import { sendError } from '../shared/http/response';

const DEFAULT_MAX_BYTES = 64 * 1024; // 64kb

/**
 * 创建请求体大小限制中间件
 *
 * @param maxBytes 最大字节数（默认 64kb）
 */
export function createBodySizeGuard(maxBytes = DEFAULT_MAX_BYTES): RequestHandler {
  return (req, res, next) => {
    const lengthHeader = req.headers['content-length'];
    if (lengthHeader !== undefined) {
      const declared = Number(lengthHeader);
      if (Number.isFinite(declared) && declared > maxBytes) {
        sendError(res, {
          code: ErrorCode.VALIDATION_ERROR,
          message: `请求体过大（上限 ${maxBytes} 字节）`,
        });
        return;
      }
    }
    next();
  };
}

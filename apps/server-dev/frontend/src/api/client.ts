/**
 * 统一 API 客户端——封装 fetch，统一错误解析（R-005）。
 *
 * 设计决策（R-005）：
 *  - 成功状态以 HTTP 2xx 判定（不依赖 body.ok）；
 *  - 错误统一解析 { error: { code, message } }，失败时抛出 ApiError。
 *  - 全局无认证，不携带任何 Token/JWT/Session 头。
 */
import { config } from '../config/env';
import type { ErrorEnvelope } from '../types';

/** API 错误（携带后端 code 便于 UI 精确提示） */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
}

/** 解析后端错误信封，解析失败时退化为通用错误 */
async function parseError(res: Response): Promise<ApiError> {
  try {
    const envelope = (await res.json()) as ErrorEnvelope;
    return new ApiError(
      envelope.error?.code ?? 'UNKNOWN_ERROR',
      envelope.error?.message ?? `请求失败 (${res.status})`,
      res.status,
      envelope.error?.details,
    );
  } catch {
    return new ApiError('PARSE_ERROR', `请求失败 (${res.status})`, res.status);
  }
}

/** 统一请求方法：2xx → 返回 JSON；非 2xx → 抛 ApiError */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;
  const url = `${config.apiBaseUrl}${path}`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    // 网络错误 / 中断
    throw new ApiError('NETWORK_ERROR', '网络连接失败，请检查后端服务是否运行', 0, err);
  }

  if (!res.ok) {
    throw await parseError(res);
  }

  // 部分成功响应可能无 body（如 204），统一兜底
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

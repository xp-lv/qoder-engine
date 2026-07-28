/**
 * Result<T, E> 类型 —— 遵循质量原则第 5 原则：用类型表达失败，而非异常控制流
 *
 * 业务错误（如实例不存在、字段非法）用 Result 表达，让失败成为返回值的一部分；
 * 系统异常（如数据库连接失败、代码 bug）才用 throw，由全局错误中间件兜底。
 *
 * 来源：后端设计 §4.3 / 质量原则第 5 原则。
 */

/** 成功或失败的结果容器 */
export type Result<T, E = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** 构造成功结果 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** 构造失败结果 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

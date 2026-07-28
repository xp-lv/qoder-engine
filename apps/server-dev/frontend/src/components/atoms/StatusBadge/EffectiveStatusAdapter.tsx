/**
 * EffectiveStatusAdapter —— 把历史记录的原始 status 适配为 StatusBadge 所需的 effectiveStatus。
 * 历史快照不存在 stale 概念，直接透传原始 status。
 *
 * （为避免在 HistoryRow 内引入额外映射逻辑，此处封装为轻量适配组件。）
 */
import type { QoderStatus } from '../../../types';
import { StatusBadge } from './StatusBadge';

interface Props {
  status: QoderStatus;
}

export function EffectiveStatusAdapter({ status }: Props) {
  return <StatusBadge effectiveStatus={status} />;
}

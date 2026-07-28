/**
 * HistoryRow —— 历史上报表格行分子。
 * 渲染单条历史记录快照（ReportRecord）。
 */
import { memo } from 'react';
import type { ReportRecord } from '../../../types';
import { EffectiveStatusAdapter } from '../../atoms/StatusBadge/EffectiveStatusAdapter';
import { formatDateTime, formatUptime } from '../../../utils/time';
import styles from './HistoryRow.module.css';

interface Props {
  record: ReportRecord;
}

function HistoryRowComponent({ record }: Props) {
  return (
    <tr className={styles.row}>
      <td className={styles.cell} data-label="上报时间">
        {formatDateTime(record.reportedAt)}
      </td>
      <td className={styles.cell} data-label="状态">
        {/* 历史快照用原始 status；为复用 StatusBadge，适配为 effectiveStatus（历史无 stale 概念） */}
        <EffectiveStatusAdapter status={record.status} />
      </td>
      <td className={styles.cell} data-label="CPU">
        {record.cpuUsage == null ? '—' : `${record.cpuUsage}%`}
      </td>
      <td className={styles.cell} data-label="内存">
        {record.memUsage == null ? '—' : `${record.memUsage}%`}
      </td>
      <td className={styles.cell} data-label="运行时长">
        {formatUptime(record.uptime)}
      </td>
      <td className={styles.cell} data-label="工作区">
        {record.workspaceCount == null ? '—' : `${record.workspaceCount} 个`}
      </td>
      <td className={styles.cell} data-label="版本">
        v{record.qoderVersion}
      </td>
    </tr>
  );
}

export const HistoryRow = memo(HistoryRowComponent);

/**
 * HistoryTable —— 历史上报表格组织（实例详情页视觉焦点）。
 * 含表头，按 reportedAt 倒序渲染 HistoryRow × N。
 */
import { memo, useEffect, useRef, useState } from 'react';
import type { ReportRecord } from '../../../types';
import { HistoryRow } from '../../molecules/HistoryRow/HistoryRow';
import styles from './HistoryTable.module.css';

interface Props {
  records: ReportRecord[];
}

const COLUMNS = ['上报时间', '状态', 'CPU', '内存', '运行时长', '工作区', '版本'] as const;

function HistoryTableComponent({ records }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  // 红队 FI-005 修正：仅当内容实际可横向滚动（scrollWidth > clientWidth）时才使容器可聚焦，
  // 避免桌面常规宽度下无滚动需求却产生冗余 tab stop，干扰键盘连续导航。
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setScrollable(el.scrollWidth > el.clientWidth);
    update();
    // 监听容器/视口尺寸变化，动态判定是否需要键盘可聚焦
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [records]);

  return (
    <div
      ref={wrapRef}
      className={styles.wrapper}
      role="region"
      aria-label="历史上报记录"
      tabIndex={scrollable ? 0 : undefined}
    >
      <table className={styles.table}>
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th key={col} scope="col" className={styles.th}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <HistoryRow key={record.id} record={record} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const HistoryTable = memo(HistoryTableComponent);

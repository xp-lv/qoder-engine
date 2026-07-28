/**
 * PaginationBar —— 分页栏分子（上一页/下一页 + 页码）。
 * 采用「上一页 / 下一页 + 当前页 N/M」的简洁分页（监控场景翻页需求简单）。
 */
import { memo } from 'react';
import { PaginationButton } from '../../atoms/PaginationButton/PaginationButton';
import { Text } from '../../atoms/Text/Text';
import styles from './PaginationBar.module.css';

interface Props {
  page: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

function PaginationBarComponent({ page, total, limit, onPageChange, disabled }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const canPrev = page > 1 && !disabled;
  const canNext = page < totalPages && !disabled;

  return (
    <nav className={styles.bar} aria-label="历史记录分页">
      <PaginationButton
        label="上一页"
        disabled={!canPrev}
        onClick={() => canPrev && onPageChange(page - 1)}
      >
        ‹ 上一页
      </PaginationButton>
      <Text variant="secondary">
        第 <strong>{page}</strong> / {totalPages} 页（共 {total} 条）
      </Text>
      <PaginationButton
        label="下一页"
        disabled={!canNext}
        onClick={() => canNext && onPageChange(page + 1)}
      >
        下一页 ›
      </PaginationButton>
    </nav>
  );
}

export const PaginationBar = memo(PaginationBarComponent);

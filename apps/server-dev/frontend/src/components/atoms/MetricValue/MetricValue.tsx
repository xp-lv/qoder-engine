/**
 * MetricValue —— 单个指标数值原子（等宽字体，带单位）。
 * 指标数值用等宽字体（--font-mono），对齐美观。
 */
import { memo } from 'react';
import styles from './MetricValue.module.css';

interface Props {
  /** 数值文本（已格式化），null/undefined 显示 — */
  value: string | number | null | undefined;
  /** 单位（如 %、个、s） */
  unit?: string;
  /** aria-label，便于屏幕阅读器朗读完整含义（可访问性） */
  label: string;
}

function MetricValueComponent({ value, unit, label }: Props) {
  const display = value == null || value === '' ? '—' : String(value);
  return (
    <span className={styles.value} aria-label={`${label}: ${display}${unit ?? ''}`}>
      {display}
      {unit && value != null && value !== '' ? <span className={styles.unit}>{unit}</span> : null}
    </span>
  );
}

export const MetricValue = memo(MetricValueComponent);

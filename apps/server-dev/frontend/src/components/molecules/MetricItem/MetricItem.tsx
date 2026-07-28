/**
 * MetricItem —— 指标项分子（label + MetricValue，如 CPU 23%）。
 */
import { memo } from 'react';
import { MetricValue } from '../../atoms/MetricValue/MetricValue';
import { Text } from '../../atoms/Text/Text';
import styles from './MetricItem.module.css';

interface Props {
  label: string;
  value: string | number | null | undefined;
  unit?: string;
}

function MetricItemComponent({ label, value, unit }: Props) {
  return (
    <div className={styles.item}>
      <Text variant="muted">{label}</Text>
      <MetricValue value={value} unit={unit} label={label} />
    </div>
  );
}

export const MetricItem = memo(MetricItemComponent);

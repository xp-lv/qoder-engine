/**
 * Text —— 文本原子（标题/正文/次要 变体）。
 * 统一文案排版，引用设计 Token。
 */
import { memo, type ElementType } from 'react';
import styles from './Text.module.css';

type Variant = 'h1' | 'h2' | 'h3' | 'body' | 'secondary' | 'muted';

interface Props {
  variant?: Variant;
  /** 渲染的 HTML 标签（默认按 variant 推断） */
  as?: ElementType;
  children: React.ReactNode;
  className?: string;
}

const DEFAULT_TAG: Record<Variant, ElementType> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  body: 'p',
  secondary: 'p',
  muted: 'span',
};

function TextComponent({ variant = 'body', as, children, className }: Props) {
  const Tag = as ?? DEFAULT_TAG[variant];
  return <Tag className={`${styles[variant]}${className ? ` ${className}` : ''}`}>{children}</Tag>;
}

export const Text = memo(TextComponent);

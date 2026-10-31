import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export interface ChipProps {
  tone: 'neutral' | 'gold' | 'success' | 'warning' | 'danger' | 'info';
  icon?: IconName;
  children?: ReactNode;
}

const TONE_STYLES = {
  neutral: 'bg-neutral-100 text-neutral-800 border-neutral-200',
  gold: 'bg-gold-soft text-ink border-gold-soft',
  success: 'bg-success-soft text-success border-success-soft',
  warning: 'bg-warning-soft text-warning border-warning-soft',
  danger: 'bg-danger-soft text-danger border-danger-soft',
  info: 'bg-info-soft text-info border-info-soft',
};

const DEFAULT_ICONS: Partial<Record<ChipProps['tone'], IconName>> = {
  warning: 'alert',
  danger: 'alert',
};

export function Chip({ tone, icon, children }: ChipProps) {
  const resolvedIcon = icon ?? DEFAULT_ICONS[tone];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE_STYLES[tone]}`}
    >
      {resolvedIcon && <Icon name={resolvedIcon} size={14} className="shrink-0" />}
      {children}
    </span>
  );
}

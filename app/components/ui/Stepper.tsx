'use client';
import { Check } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import styles from './ui.module.css';

/**
 * Progress through a short flow; the current step gets aria-current="step" and finished ones also
 * say "done" to screen readers. `current={steps.length}` shows the whole flow as finished.
 */
export function Stepper({ steps, current, label }: { steps: string[]; current: number; label: string }) {
  const { t } = useI18n();
  return (
    <ol className={styles.stepper} aria-label={label}>
      {steps.map((step, i) => {
        const done = i < current;
        const className = [styles.step, i === current && styles.stepCurrent, done && styles.stepDone].filter(Boolean).join(' ');
        return (
          <li key={step} className={className} aria-current={i === current ? 'step' : undefined}>
            <span className={styles.stepDot} aria-hidden>{done ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
            {step}
            {done && <span className="sr-only">, {t('common.done')}</span>}
          </li>
        );
      })}
    </ol>
  );
}

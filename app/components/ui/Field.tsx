'use client';
import { useId, type ComponentProps, type ReactNode } from 'react';
import styles from './ui.module.css';

interface FieldChrome {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Keep the label for screen readers only (the context already shows it). */
  hideLabel?: boolean;
}

/** Links the hint and error, keeping any ids the caller passed in its own aria-describedby. */
function describedBy(inputId: string, hint: unknown, error: unknown, own?: string) {
  return [own, hint ? `${inputId}-hint` : null, error ? `${inputId}-error` : null].filter(Boolean).join(' ') || undefined;
}

export function TextField({ label, hint, error, hideLabel, id, 'aria-describedby': own, ...input }: FieldChrome & Omit<ComponentProps<'input'>, 'className'>) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : styles.label}>{label}</label>
      <input
        id={inputId}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, hint, error, own)}
        {...input}
      />
      {hint && <p id={`${inputId}-hint`} className={styles.hint}>{hint}</p>}
      {error && <p id={`${inputId}-error`} className={styles.error}>{error}</p>}
    </div>
  );
}

export function TextArea({ label, hint, error, hideLabel, id, 'aria-describedby': own, ...textarea }: FieldChrome & Omit<ComponentProps<'textarea'>, 'className'>) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : styles.label}>{label}</label>
      <textarea
        id={inputId}
        className={styles.textarea}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, hint, error, own)}
        {...textarea}
      />
      {hint && <p id={`${inputId}-hint`} className={styles.hint}>{hint}</p>}
      {error && <p id={`${inputId}-error`} className={styles.error}>{error}</p>}
    </div>
  );
}

export function SelectField({ label, hint, error, hideLabel, id, children, 'aria-describedby': own, ...select }: FieldChrome & Omit<ComponentProps<'select'>, 'className'>) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : styles.label}>{label}</label>
      <select
        id={inputId}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, hint, error, own)}
        {...select}
      >
        {children}
      </select>
      {hint && <p id={`${inputId}-hint`} className={styles.hint}>{hint}</p>}
      {error && <p id={`${inputId}-error`} className={styles.error}>{error}</p>}
    </div>
  );
}

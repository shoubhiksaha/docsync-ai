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

function describedBy(hintId: string, errorId: string, hint: unknown, error: unknown) {
  return [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
}

export function TextField({ label, hint, error, hideLabel, id, ...input }: FieldChrome & Omit<ComponentProps<'input'>, 'className'>) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : styles.label}>{label}</label>
      <input
        id={inputId}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(`${inputId}-hint`, `${inputId}-error`, hint, error)}
        {...input}
      />
      {hint && <p id={`${inputId}-hint`} className={styles.hint}>{hint}</p>}
      {error && <p id={`${inputId}-error`} className={styles.error}>{error}</p>}
    </div>
  );
}

export function TextArea({ label, hint, error, hideLabel, id, ...textarea }: FieldChrome & Omit<ComponentProps<'textarea'>, 'className'>) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : styles.label}>{label}</label>
      <textarea
        id={inputId}
        className={styles.textarea}
        aria-describedby={describedBy(`${inputId}-hint`, `${inputId}-error`, hint, error)}
        {...textarea}
      />
      {hint && <p id={`${inputId}-hint`} className={styles.hint}>{hint}</p>}
      {error && <p id={`${inputId}-error`} className={styles.error}>{error}</p>}
    </div>
  );
}

export function SelectField({ label, hint, hideLabel, id, children, ...select }: Omit<FieldChrome, 'error'> & Omit<ComponentProps<'select'>, 'className'>) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : styles.label}>{label}</label>
      <select id={inputId} className={styles.input} aria-describedby={hint ? `${inputId}-hint` : undefined} {...select}>
        {children}
      </select>
      {hint && <p id={`${inputId}-hint`} className={styles.hint}>{hint}</p>}
    </div>
  );
}

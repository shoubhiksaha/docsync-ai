'use client';
import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './Button';
import styles from './ui.module.css';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  closeLabel: string;
  wide?: boolean;
  /** When false, Esc and backdrop clicks don't close it (a choice is required). */
  dismissible?: boolean;
}

/** True when the pointer is on the backdrop: outside the dialog box, not on its padding or scrollbar. */
function onBackdrop(dialog: HTMLDialogElement | null, e: MouseEvent) {
  if (!dialog || e.target !== dialog) return false;
  const box = dialog.getBoundingClientRect();
  return e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom;
}

/**
 * Modal built on the native <dialog> element: it renders in the browser's top layer (so no parent
 * styling can trap or hide it), traps focus, and closes on Esc. Focus returns to the opener.
 */
export function Dialog({ open, onClose, title, description, children, actions, closeLabel, wide, dismissible = true }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  /** Where the press started: a text selection dragged out of the dialog must not close it. */
  const pressedBackdrop = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${wide ? styles.dialogWide : ''}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClose={() => {
        // The browser may close it without a cancel we can stop (a second Esc or Android back with
        // no tap in between), so keep the parent in step: tell it, or show it again if required.
        if (open && !ref.current?.open) {
          if (!dismissible) {
            ref.current?.showModal();
            return;
          }
          onClose();
        }
        opener.current?.focus();
      }}
      onPointerDown={(e) => {
        pressedBackdrop.current = onBackdrop(ref.current, e);
      }}
      onClick={(e) => {
        const close = dismissible && pressedBackdrop.current && onBackdrop(ref.current, e);
        pressedBackdrop.current = false;
        if (close) onClose();
      }}
    >
      {open && (
        <div className={styles.dialogInner}>
          <div className={styles.dialogHeader}>
            <h2 id={titleId} className={styles.dialogTitle}>{title}</h2>
            {dismissible && <IconButton label={closeLabel} icon={<X size={20} aria-hidden />} onClick={onClose} />}
          </div>
          {description && <div id={descriptionId} className={styles.dialogDescription}>{description}</div>}
          {children}
          {actions && <div className={styles.dialogActions}>{actions}</div>}
        </div>
      )}
    </dialog>
  );
}

import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import styles from './ui.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Look {
  variant?: Variant;
  size?: 'md' | 'lg';
  fullWidth?: boolean;
  /** Allow the label to wrap onto several lines (long translated labels on phones). */
  wrap?: boolean;
  icon?: ReactNode;
  className?: string;
}

export function buttonClass({ variant = 'secondary', size = 'md', fullWidth, wrap, className }: Look): string {
  return [styles.btn, styles[variant], size === 'lg' && styles.lg, fullWidth && styles.full, wrap && styles.wrap, className]
    .filter(Boolean)
    .join(' ');
}

type ButtonProps = Look & { loading?: boolean } & Omit<ComponentProps<'button'>, 'className'>;

export function Button({ variant, size, fullWidth, wrap, icon, className, loading, disabled, type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, fullWidth, wrap, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <LoaderCircle className="spin" size={18} aria-hidden /> : icon}
      {children}
    </button>
  );
}

type LinkProps = Look & {
  href: string;
  /** Opens in a new tab (external sites). */
  external?: boolean;
  /** Full page load instead of client navigation (OAuth redirects, API routes). */
  native?: boolean;
  newTabLabel?: string;
} & Omit<ComponentProps<'a'>, 'className' | 'href'>;

export function ButtonLink({ href, external, native, newTabLabel, variant, size, fullWidth, wrap, icon, className, children, ...rest }: LinkProps) {
  const cls = buttonClass({ variant, size, fullWidth, wrap, className });
  if (external || native) {
    return (
      <a href={href} className={cls} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} {...rest}>
        {icon}
        {children}
        {external && newTabLabel && <span className="sr-only"> {newTabLabel}</span>}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

type IconButtonProps = { label: string; icon: ReactNode; variant?: Variant } & Omit<ComponentProps<'button'>, 'className' | 'children'>;

/** Square 44×44 button for icon-only actions; `label` becomes its accessible name and tooltip. */
export function IconButton({ label, icon, variant = 'ghost', type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} className={`${styles.iconBtn} ${styles[variant]}`} aria-label={label} title={label} {...rest}>
      {icon}
    </button>
  );
}

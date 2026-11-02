import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import styles from './ui.module.css';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export function Badge({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`${styles.badge} ${styles[`tone_${tone}`]}`}>
      {icon}
      {children}
    </span>
  );
}

const NOTICE_ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert };

interface NoticeProps {
  tone?: keyof typeof NOTICE_ICONS;
  title?: ReactNode;
  children?: ReactNode;
  /** Announce immediately to screen readers (errors the user must act on). */
  urgent?: boolean;
}

export function Notice({ tone = 'info', title, children, urgent }: NoticeProps) {
  const Icon = NOTICE_ICONS[tone];
  return (
    <div className={`${styles.notice} ${styles[`notice_${tone}`]}`} role={urgent ? 'alert' : 'status'}>
      <Icon size={20} aria-hidden />
      <div className={styles.noticeBody}>
        {title && <p className={styles.noticeTitle}>{title}</p>}
        {children}
      </div>
    </div>
  );
}

interface CardProps {
  title?: ReactNode;
  titleId?: string;
  description?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  as?: 'section' | 'div';
  /** h1 when the card is the whole page (404, error), so the page still has a top-level heading. */
  heading?: 'h1' | 'h2';
}

export function Card({ title, titleId, description, aside, children, as: Tag = 'section', heading: Heading = 'h2' }: CardProps) {
  return (
    <Tag className={styles.card} aria-labelledby={title && titleId ? titleId : undefined}>
      {(title || description) && (
        <div className={styles.cardHeader}>
          <div className={styles.cardTitleRow}>
            {title && <Heading id={titleId} className={styles.cardTitle}>{title}</Heading>}
            {aside}
          </div>
          {description && <div className={styles.cardDescription}>{description}</div>}
        </div>
      )}
      {children}
    </Tag>
  );
}

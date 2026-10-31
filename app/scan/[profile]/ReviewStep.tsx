'use client';
import { useEffect, useId, useRef, useState, type Dispatch, type FormEvent } from 'react';
import { Check, Eye, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import { activeFields, fieldStatus, needsAttention, type ReviewField, type ScanAction, type ScanState } from '@/client/scan-flow';
import { Badge, Button, Dialog, IconButton, Notice, SelectField, TextArea, TextField } from '@/app/components/ui';
import ui from '@/app/components/ui/ui.module.css';
import ModuleBoundary from '@/app/components/ModuleBoundary';
import { usePageUrls } from './usePageUrls';
import VoiceNote from './VoiceNote';
import styles from './scan.module.css';

interface ReviewStepProps {
  state: ScanState;
  dispatch: Dispatch<ScanAction>;
  saving: boolean;
  countdown: number;
  /** Field key used for the duplicate check; '' means "don't check". */
  duplicateKey: string;
  onDuplicateKey: (key: string) => void;
  onSave: () => void;
  onStartOver: () => void;
}

function FieldRow({ field, dispatch }: { field: ReviewField; dispatch: Dispatch<ScanAction> }) {
  const { t } = useI18n();
  const inputId = useId();
  const [renaming, setRenaming] = useState(false);
  const [label, setLabel] = useState(field.label);
  const status = fieldStatus(field);
  const valueRef = useRef<HTMLTextAreaElement>(null);

  // Browsers without CSS `field-sizing` (Firefox, older Safari) grow the box here instead.
  useEffect(() => {
    const el = valueRef.current;
    if (!el || CSS.supports('field-sizing', 'content')) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [field.value]);

  const saveName = (e: FormEvent) => {
    e.preventDefault();
    if (label.trim()) dispatch({ type: 'rename', id: field.id, label: label.trim() });
    setRenaming(false);
  };

  return (
    <li className={styles.fieldRow} data-status={status}>
      <div className={styles.fieldMain}>
        {renaming ? (
          <form onSubmit={saveName} className={styles.row}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <TextField label={t('review.renameLabel')} hideLabel value={label} onChange={e => setLabel(e.target.value)} autoFocus />
            </div>
            <IconButton type="submit" label={t('common.save')} icon={<Check size={20} aria-hidden />} variant="primary" />
          </form>
        ) : (
          <div className={styles.fieldLabelRow}>
            <label htmlFor={inputId} className={styles.fieldLabel}>{field.label}</label>
            {status === 'check' && <Badge tone="warning">{t('review.badgeCheck')}</Badge>}
            {status === 'missing' && <Badge tone="danger">{t('review.badgeMissing')}</Badge>}
          </div>
        )}
        {/* A textarea so long values (names, addresses) wrap instead of being cut off on phones. */}
        <textarea
          ref={valueRef}
          id={inputId}
          className={`${ui.input} ${styles.fieldValue}`}
          rows={1}
          value={field.value}
          onChange={e => dispatch({ type: 'edit', id: field.id, value: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
          aria-invalid={status === 'missing' || undefined}
        />
      </div>
      <div className={styles.fieldActions}>
        {!renaming && <IconButton label={t('review.rename', { label: field.label })} icon={<Pencil size={18} aria-hidden />} onClick={() => setRenaming(true)} />}
        <IconButton label={t('review.removeField', { label: field.label })} icon={<X size={20} aria-hidden />} onClick={() => dispatch({ type: 'remove', id: field.id })} />
      </div>
    </li>
  );
}

function PhotoViewer({ urls, open, onClose }: { urls: string[]; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} title={t('review.photoTitle')} closeLabel={t('common.close')} wide>
      <div className={styles.viewer}>
        {urls.map((url, i) => (
          /* eslint-disable-next-line @next/next/no-img-element -- local object URL */
          <img key={url} src={url} alt={urls.length > 1 ? t('review.page', { n: i + 1 }) : t('review.photoTitle')} />
        ))}
      </div>
    </Dialog>
  );
}

export default function ReviewStep({ state, dispatch, saving, countdown, duplicateKey, onDuplicateKey, onSave, onStartOver }: ReviewStepProps) {
  const { t } = useI18n();
  const urls = usePageUrls(state.pages);
  const [page, setPage] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newValue, setNewValue] = useState('');

  const active = activeFields(state.fields);
  const removed = state.fields.filter(f => f.removed);
  const attention = needsAttention(state.fields);

  const addField = (e: FormEvent) => {
    e.preventDefault();
    if (!newLabel.trim()) return;
    dispatch({ type: 'add', label: newLabel, value: newValue });
    setNewLabel('');
    setNewValue('');
  };

  return (
    <div className={styles.reviewGrid}>
      <aside className={styles.photoPanel} aria-label={t('review.photoTitle')}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
        {urls[page] && <img src={urls[page]} alt={t('review.photoTitle')} className={styles.photo} />}
        {urls.length > 1 && (
          <ul className={styles.thumbs}>
            {urls.map((url, i) => (
              <li key={url}>
                <button type="button" className={styles.pageButton} aria-pressed={i === page} aria-label={t('review.page', { n: i + 1 })} onClick={() => setPage(i)}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
                  <img src={url} alt="" className={styles.thumb} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button icon={<Eye size={18} aria-hidden />} onClick={() => setViewerOpen(true)}>{t('review.viewPhoto')}</Button>
      </aside>

      <div className={styles.reviewMain}>
        <div className={styles.photoStrip}>
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
          {urls[0] && <img src={urls[0]} alt="" className={styles.thumb} />}
          <Button icon={<Eye size={18} aria-hidden />} onClick={() => setViewerOpen(true)}>{t('review.viewPhoto')}</Button>
        </div>

        <div className={styles.reviewHeading}>
          <h2 className={styles.reviewTitle}>{t('review.title')}</h2>
          <p className={styles.muted}>{t('review.subtitle')}</p>
        </div>

        {state.isMock && (
          <Notice tone="warning" title={t('review.sampleTitle')} urgent>
            <p>{t('review.sampleBody')}</p>
          </Notice>
        )}
        {state.error && <Notice tone="danger" title={t('error.saveTitle')} urgent><p>{t(`error.${state.error}`)}</p></Notice>}
        {(state.warnings.length > 0 || attention > 0) && (
          <Notice tone="warning" title={t('review.checkTitle')}>
            {attention > 0 && <p>{t('review.attention', { count: attention })}</p>}
            {state.warnings.length > 0 && <ul style={{ paddingLeft: 20 }}>{state.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
          </Notice>
        )}

        {active.length > 0 && (
          <SelectField label={t('review.duplicateCheck')} value={duplicateKey} onChange={e => onDuplicateKey(e.target.value)}>
            <option value="">{t('review.duplicateNone')}</option>
            {active.map(f => <option key={f.id} value={f.key}>{f.label}</option>)}
          </SelectField>
        )}

        <ul className={styles.fields}>
          {active.map(field => <FieldRow key={field.id} field={field} dispatch={dispatch} />)}
        </ul>
        {active.length === 0 && <Notice tone="warning">{t('review.empty')}</Notice>}

        {removed.length > 0 && (
          <details className={styles.disclosure}>
            <summary>{t('review.removed', { count: removed.length })}</summary>
            <ul className={styles.removedList}>
              {removed.map(f => (
                <li key={f.id} className={styles.removedItem}>
                  <span><strong>{f.label}</strong>{f.value ? `: ${f.value}` : ''}</span>
                  <Button variant="ghost" icon={<RotateCcw size={18} aria-hidden />} onClick={() => dispatch({ type: 'restore', id: f.id })}>{t('common.restore')}</Button>
                </li>
              ))}
            </ul>
          </details>
        )}

        <details className={styles.disclosure}>
          <summary>{t('review.addTitle')}</summary>
          <form className={styles.addForm} onSubmit={addField}>
            <TextField label={t('review.addLabel')} placeholder={t('review.addPlaceholder')} value={newLabel} onChange={e => setNewLabel(e.target.value)} />
            <TextField label={t('review.addValue')} value={newValue} onChange={e => setNewValue(e.target.value)} />
            <Button type="submit" icon={<Plus size={18} aria-hidden />} disabled={!newLabel.trim()}>{t('review.add')}</Button>
          </form>
        </details>

        <details className={styles.disclosure} open={Boolean(state.note || state.audio) || undefined}>
          <summary>{t('review.noteTitle')}</summary>
          <div className={styles.stack} style={{ marginTop: 8 }}>
            <TextArea label={t('done.notes')} hideLabel placeholder={t('review.notePlaceholder')} value={state.note} onChange={e => dispatch({ type: 'note', value: e.target.value })} />
            <ModuleBoundary title={t('boundary.title', { name: t('voice.panel') })} body={t('boundary.body')} retryLabel={t('common.retry')}>
              <VoiceNote
                audio={state.audio}
                onAudio={blob => dispatch({ type: 'audio', blob })}
                onText={text => dispatch({ type: 'note', value: state.note ? `${state.note}\n\n${text}` : text })}
              />
            </ModuleBoundary>
          </div>
        </details>

        {state.autoSave && (
          <Notice tone="info" title={t('review.autoSave', { seconds: countdown })}>
            <div>
              <Button onClick={() => dispatch({ type: 'auto-save-cancel' })}>{t('review.autoSaveCancel')}</Button>
            </div>
          </Notice>
        )}

        <div className={styles.actionBar}>
          <span className={styles.count}>{t('review.fieldCount', { count: active.length })}</span>
          <Button onClick={onStartOver} disabled={saving}>{t('review.startOver')}</Button>
          <Button variant="primary" size="lg" wrap loading={saving} disabled={active.length === 0} onClick={onSave}>
            {saving ? t('common.saving') : t('review.save')}
          </Button>
        </div>
      </div>

      <PhotoViewer urls={urls} open={viewerOpen} onClose={() => setViewerOpen(false)} />
    </div>
  );
}

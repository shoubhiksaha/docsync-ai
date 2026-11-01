'use client';
import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SyntheticEvent } from 'react';
import { Check, Eye, LogIn, Pencil, Pin, PinOff, Plus, RotateCcw, X } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import { activeFields, fieldStatus, type ReviewField, type ScanAction, type ScanState } from '@/client/scan-flow';
import { Badge, Button, Dialog, IconButton, Notice, SelectField, TextArea, TextField } from '@/app/components/ui';
import ui from '@/app/components/ui/ui.module.css';
import ModuleBoundary from '@/app/components/ModuleBoundary';
import { usePageUrls } from './usePageUrls';
import VoiceNote from './VoiceNote';
import styles from './scan.module.css';

interface ReviewStepProps {
  state: ScanState;
  dispatch: Dispatch<ScanAction>;
  documentName: string;
  saving: boolean;
  countdown: number;
  /** Field key used for the duplicate check; '' means "don't check". */
  duplicateKey: string;
  onDuplicateKey: (key: string) => void;
  /** The checked fields are kept on this device after a failed save (Recent scans). */
  kept: boolean;
  onSignIn: () => void;
  onSave: () => void;
  onStartOver: () => void;
}

const PIN_KEY = 'docsync_photo_pinned';
const fieldInputId = (id: string) => `field-${id}`;

/** Scrolls a field to just above the sticky Save bar (clear of a pinned photo) and focuses it. */
function focusField(id: string) {
  const el = document.getElementById(fieldInputId(id));
  el?.scrollIntoView({ block: 'end' });
  el?.focus({ preventScroll: true });
}

function FieldRow({ field, dispatch }: { field: ReviewField; dispatch: Dispatch<ScanAction> }) {
  const { t } = useI18n();
  const inputId = fieldInputId(field.id);
  const statusId = `${inputId}-status`;
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
            {status !== 'ok' && (
              <span id={statusId}>
                {status === 'check' ? <Badge tone="warning">{t('review.badgeCheck')}</Badge> : <Badge tone="danger">{t('review.badgeMissing')}</Badge>}
              </span>
            )}
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
          aria-describedby={status !== 'ok' && !renaming ? statusId : undefined}
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

function PageButtons({ urls, page, onPage }: { urls: string[]; page: number; onPage: (page: number) => void }) {
  const { t } = useI18n();
  if (urls.length < 2) return null;
  return (
    <ul className={styles.thumbs}>
      {urls.map((url, i) => (
        <li key={url}>
          <button type="button" className={styles.pageButton} aria-pressed={i === page} aria-label={t('review.page', { n: i + 1 })} onClick={() => onPage(i)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
            <img src={url} alt="" className={styles.thumb} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function ReviewStep({ state, dispatch, documentName, saving, countdown, duplicateKey, onDuplicateKey, kept, onSignIn, onSave, onStartOver }: ReviewStepProps) {
  const { t } = useI18n();
  const urls = usePageUrls(state.pages);
  const [page, setPage] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newValue, setNewValue] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  const active = activeFields(state.fields);
  const removed = state.fields.filter(f => f.removed);
  const flagged = active.filter(f => fieldStatus(f) !== 'ok');
  const duplicateLabel = duplicateKey ? (state.fields.find(f => f.key === duplicateKey)?.label ?? duplicateKey) : t('review.duplicateNone');

  // Phones: the photo can stay pinned above the fields (remembered on this device).
  useEffect(() => {
    try {
      setPinned(localStorage.getItem(PIN_KEY) === '1');
    } catch {
      // storage unavailable: starts unpinned
    }
  }, []);

  const togglePinned = () => {
    const next = !pinned;
    setPinned(next);
    setZoomed(false);
    try {
      localStorage.setItem(PIN_KEY, next ? '1' : '0');
    } catch {
      // storage unavailable: the choice just isn't remembered
    }
  };

  // A failed save is shown at the top of the review: bring it into view after tapping the sticky Save.
  useEffect(() => {
    if (!state.error || saving) return;
    errorRef.current?.scrollIntoView({ block: 'center' });
    errorRef.current?.focus({ preventScroll: true });
  }, [state.error, saving]);

  // Any sign that the user is checking (touch, scroll, typing, focus) stops the auto-save.
  const pauseAutoSave = (e: SyntheticEvent) => {
    if (state.autoSave && !bar.current?.contains(e.target as Node)) dispatch({ type: 'auto-save-cancel' });
  };

  const onVoiceBusy = (busy: boolean) => {
    setVoiceBusy(busy);
    if (busy && state.autoSave) dispatch({ type: 'auto-save-cancel' });
  };

  const addField = (e: FormEvent) => {
    e.preventDefault();
    if (!newLabel.trim()) return;
    dispatch({ type: 'add', label: newLabel, value: newValue });
    setNewLabel('');
    setNewValue('');
  };

  const saveLabel = saving
    ? t('common.saving')
    : voiceBusy
      ? t('review.voiceBusy')
      : state.autoSave ? t('review.autoSaveIn', { seconds: countdown }) : t('review.save');

  return (
    <div className={styles.reviewGrid} onPointerDown={pauseAutoSave} onKeyDown={pauseAutoSave} onFocus={pauseAutoSave} onWheel={pauseAutoSave}>
      <aside className={styles.photoPanel} aria-label={t('review.photoTitle')}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
        {urls[page] && <img src={urls[page]} alt={t('review.photoTitle')} className={styles.photo} />}
        <PageButtons urls={urls} page={page} onPage={setPage} />
        <Button icon={<Eye size={18} aria-hidden />} onClick={() => setViewerOpen(true)}>{t('review.viewPhoto')}</Button>
      </aside>

      <div className={styles.reviewMain}>
        <div className={styles.photoStrip} data-pinned={pinned || undefined}>
          {pinned && urls[page] ? (
            <div className={styles.pinnedPhoto} data-zoomed={zoomed || undefined}>
              <button type="button" aria-pressed={zoomed} aria-label={t('review.zoomPhoto')} onClick={() => setZoomed(z => !z)}>
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
                <img src={urls[page]} alt="" />
              </button>
            </div>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element -- local object URL */
            urls[0] && <img src={urls[0]} alt="" className={styles.thumb} />
          )}
          <div className={styles.row}>
            {pinned && <PageButtons urls={urls} page={page} onPage={setPage} />}
            <Button icon={pinned ? <PinOff size={18} aria-hidden /> : <Pin size={18} aria-hidden />} aria-pressed={pinned} onClick={togglePinned}>
              {t('review.pinPhoto')}
            </Button>
            <Button icon={<Eye size={18} aria-hidden />} onClick={() => setViewerOpen(true)}>{t('review.viewPhoto')}</Button>
          </div>
        </div>

        <div className={styles.reviewHeading}>
          <h2 className={styles.reviewTitle}>{t('review.title')}</h2>
          <p className={styles.muted}>{t('review.subtitle')}</p>
        </div>

        {state.autoSave && <Notice tone="info">{t('review.autoSave')}</Notice>}
        {state.isMock && (
          <Notice tone="warning" title={t('review.sampleTitle')} urgent>
            <p>{t('review.sampleBody')}</p>
          </Notice>
        )}
        {state.error && (
          <div ref={errorRef} tabIndex={-1}>
            <Notice tone="danger" title={t('error.saveTitle')} urgent>
              <p>{t(`error.${state.error}`)}</p>
              {kept && <p>{t('review.kept')}</p>}
              {state.error === 'session' && (
                <div>
                  <Button variant="primary" icon={<LogIn size={18} aria-hidden />} onClick={onSignIn}>{t('review.signIn')}</Button>
                </div>
              )}
            </Notice>
          </div>
        )}
        {(state.warnings.length > 0 || flagged.length > 0) && (
          <Notice tone="warning" title={t('review.checkTitle')}>
            {flagged.length > 0 && (
              <>
                <p>{t('review.attention', { count: flagged.length })}</p>
                {/* Each flagged field is one tap away, wherever it sits in a long list. */}
                <ul className={styles.jumpList}>
                  {flagged.map(f => (
                    <li key={f.id}>
                      <button type="button" className={styles.jump} onClick={() => focusField(f.id)}>{f.label}</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {state.warnings.length > 0 && <ul style={{ paddingLeft: 20 }}>{state.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
          </Notice>
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
                onText={text => dispatch({ type: 'note-append', text })}
                onBusy={onVoiceBusy}
              />
            </ModuleBoundary>
          </div>
        </details>

        {/* A setting for this document type, not just this scan, so it lives below the fields. */}
        {active.length > 0 && (
          <details className={styles.disclosure}>
            <summary>{t('review.duplicateTitle', { field: duplicateLabel })}</summary>
            <div style={{ marginTop: 8 }}>
              <SelectField label={t('review.duplicateCheck')} hint={t('review.duplicateHint', { name: documentName })} value={duplicateKey} onChange={e => onDuplicateKey(e.target.value)}>
                <option value="">{t('review.duplicateNone')}</option>
                {active.map(f => <option key={f.id} value={f.key}>{f.label}</option>)}
              </SelectField>
            </div>
          </details>
        )}

        {/* Out of the sticky bar, so Save is the only big target where the thumb rests. */}
        <div>
          <Button variant="ghost" icon={<RotateCcw size={18} aria-hidden />} onClick={onStartOver} disabled={saving}>{t('review.startOver')}</Button>
        </div>

        <div ref={bar} className={styles.actionBar}>
          <span className={styles.count}>{t('review.fieldCount', { count: active.length })}</span>
          {state.autoSave && !saving && <Button onClick={() => dispatch({ type: 'auto-save-cancel' })}>{t('review.autoSaveCancel')}</Button>}
          <Button variant="primary" size="lg" wrap loading={saving} disabled={active.length === 0 || voiceBusy} onClick={onSave}>
            {saveLabel}
          </Button>
        </div>
      </div>

      <PhotoViewer urls={urls} open={viewerOpen} onClose={() => setViewerOpen(false)} />
    </div>
  );
}

'use client';
import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SyntheticEvent } from 'react';
import { Check, CircleCheck, Clock, Ellipsis, Eye, LogIn, MicOff, Pencil, Pin, PinOff, Plus, RotateCcw, X } from 'lucide-react';
import { useI18n } from '@/client/i18n/I18nProvider';
import type { MessageKey } from '@/client/i18n';
import { activeFields, canConfirm, failedDestinations, fieldStatus, NOT_KEEPABLE, ruleTargets, uncheckedRules, type DestinationResult, type ReviewField, type RuleWarning, type ScanAction, type ScanState } from '@/client/scan-flow';
import { Badge, Button, IconButton, Notice, SelectField, TextArea, TextField } from '@/app/components/ui';
import ui from '@/app/components/ui/ui.module.css';
import ModuleBoundary from '@/app/components/ModuleBoundary';
import PhotoViewer from './PhotoViewer';
import { usePageUrls } from './usePageUrls';
import VoiceNote from './VoiceNote';
import styles from './scan.module.css';

interface ReviewStepProps {
  state: ScanState;
  dispatch: Dispatch<ScanAction>;
  documentName: string;
  saving: boolean;
  countdown: number;
  /** How much of the save upload has been sent, 0 to 1. */
  saveSent: number;
  /** Field key used for the duplicate check; '' means "don't check", null that it isn't known (Settings didn't load). */
  duplicateKey: string | null;
  onDuplicateKey: (key: string) => void;
  /** The checked fields are kept on this device after a failed save (Recent scans). */
  kept: boolean;
  /** Keeps the checked values on this device after a failed save and starts a new scan. */
  onKeep: () => void;
  onSignIn: () => void;
  onSave: () => void;
  /** The voice note was too large to send: save the record without it. */
  onSaveWithoutVoice: () => void;
  onStartOver: () => void;
}

const PIN_KEY = 'docsync_photo_pinned';
/** Failure reasons worth naming; anything else is just "Failed". */
const FAILURE_CODES = ['not_connected', 'disabled', 'paused'];
const failureKey = (outcome: DestinationResult | undefined): MessageKey =>
  outcome && FAILURE_CODES.includes(outcome.code) ? `dest.${outcome.code}` as MessageKey : 'dest.failed';
const fieldInputId = (id: string) => `field-${id}`;
const restoreButtonId = (id: string) => `restore-${id}`;
/** The duplicate-check choice while Settings haven't loaded (no field key looks like this). */
const UNKNOWN = '__settings__';

/** Scrolls a field to just above the sticky Save bar (clear of a pinned photo) and focuses it. */
function focusField(id: string) {
  const el = document.getElementById(fieldInputId(id));
  el?.scrollIntoView({ block: 'end' });
  el?.focus({ preventScroll: true });
}

/**
 * One field. The value is the big target; "Looks right" is a worded button (a bare tick read as
 * "save"), and renaming or removing sit behind "⋯", away from where the thumb rests on the value.
 * `rules`: the document type's warnings about this value.
 */
function FieldRow({ field, rules, dispatch, onRemove }: { field: ReviewField; rules: RuleWarning[]; dispatch: Dispatch<ScanAction>; onRemove: (id: string) => void }) {
  const { t } = useI18n();
  const notes = rules.map(rule => t(`rule.${rule.code}`, rule.params));
  const inputId = fieldInputId(field.id);
  const statusId = `${inputId}-status`;
  const notesId = `${inputId}-notes`;
  const menuId = `${inputId}-menu`;
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState(false);
  const [label, setLabel] = useState(field.label);
  // A business-rule warning about this value asks for a check too, even when it was read clearly,
  // until the user says it's right: rules can be wrong, and a list that never empties is ignored.
  const status = fieldStatus(field, rules);
  const confirmed = Boolean(field.confirmed) && uncheckedRules(field, rules).length === 0;
  const describedBy = [status !== 'ok' && !renaming && statusId, notes.length && notesId].filter(Boolean).join(' ');
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
          aria-describedby={describedBy || undefined}
        />
        {/* The document type's checks, right under the value they are about; once the user said the
            value is right, they stay as a quiet reminder instead of a warning. */}
        {notes.length > 0 && (
          <ul id={notesId} className={styles.fieldNotes} data-checked={confirmed || undefined}>
            {confirmed && <li className={styles.fieldNotesChecked}><CircleCheck size={16} aria-hidden />{t('review.ruleChecked')}</li>}
            {notes.map(note => <li key={note}>{note}</li>)}
          </ul>
        )}
        {/* A right value the AI wasn't sure of, or one a check questions, is marked as right without retyping it. */}
        {!renaming && canConfirm(field, rules) && (
          <div className={styles.fieldTools}>
            <Button
              icon={confirmed ? <CircleCheck size={18} aria-hidden /> : <Check size={18} aria-hidden />}
              aria-label={t('review.confirm', { label: field.label })}
              aria-pressed={confirmed}
              onClick={() => dispatch({ type: 'confirm', id: field.id, confirmed: !confirmed, rules: rules.map(rule => rule.code) })}
            >
              {t('review.looksRight')}
            </Button>
          </div>
        )}
        {!renaming && menu && (
          <div id={menuId} className={styles.fieldTools}>
            <Button variant="ghost" icon={<Pencil size={18} aria-hidden />} onClick={() => { setMenu(false); setLabel(field.label); setRenaming(true); }}>{t('review.renameShort')}</Button>
            <Button variant="ghost" icon={<X size={18} aria-hidden />} onClick={() => onRemove(field.id)}>{t('review.removeShort')}</Button>
          </div>
        )}
      </div>
      {!renaming && (
        <div className={styles.fieldActions}>
          <IconButton label={t('review.more', { label: field.label })} icon={<Ellipsis size={20} aria-hidden />} aria-expanded={menu} aria-controls={menu ? menuId : undefined} onClick={() => setMenu(open => !open)} />
        </div>
      )}
    </li>
  );
}

/** Where a field was just removed: one line with the way back, instead of the field vanishing. */
function RemovedRow({ field, onRestore }: { field: ReviewField; onRestore: (id: string) => void }) {
  const { t } = useI18n();
  const restore = useRef<HTMLButtonElement>(null);
  // The "⋯" menu that had focus is gone: focus moves to the way back.
  useEffect(() => restore.current?.focus(), []);
  return (
    <li className={styles.removedItem}>
      <span>{t('review.removedOne', { label: field.label })}</span>
      <Button ref={restore} variant="ghost" icon={<RotateCcw size={18} aria-hidden />} onClick={() => onRestore(field.id)}>{t('common.restore')}</Button>
    </li>
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

export default function ReviewStep({ state, dispatch, documentName, saving, countdown, saveSent, duplicateKey, onDuplicateKey, kept, onKeep, onSignIn, onSave, onSaveWithoutVoice, onStartOver }: ReviewStepProps) {
  const { t } = useI18n();
  const urls = usePageUrls(state.pages);
  const [page, setPage] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newValue, setNewValue] = useState('');
  /** Fields removed on this screen, shown in place with a way back until restored. */
  const [justRemoved, setJustRemoved] = useState<ReadonlySet<string>>(new Set());
  /** Where focus goes once a restore has rendered: the field that came back, or the next "Restore". */
  const [restoreFocus, setRestoreFocus] = useState<{ field: string } | { button: string } | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const notePanel = useRef<HTMLDetailsElement>(null);
  const hasNote = Boolean(state.note || state.audio);

  const active = activeFields(state.fields);
  const listed = state.fields.filter(f => !f.removed || justRemoved.has(f.id));
  const removed = state.fields.filter(f => f.removed && !justRemoved.has(f.id));
  // Business-rule warnings in the user's language, each under its field; until the checks have run
  // on this device, the server's sentences are shown as a list instead.
  const ruleText = (rule: RuleWarning) => t(`rule.${rule.code}`, rule.params);
  const rules = state.rules ? ruleTargets(state.fields, state.rules) : null;
  const rulesFor = (id: string) => rules?.byField.get(id) ?? [];
  const generalWarnings = rules ? rules.general.map(ruleText) : state.warnings;
  const flagged = active.filter(f => fieldStatus(f, rulesFor(f.id)) !== 'ok');
  // Every destination answered and none saved: say which, instead of "the service didn't respond".
  const failedEverywhere = state.result?.status === 'failed' ? failedDestinations(state.result) : [];
  // The remembered duplicate-check field may not be on this scan: say the check is off, by name, never by key.
  const duplicateField = duplicateKey ? active.find(f => f.key === duplicateKey) : undefined;
  const missingLabel = duplicateKey && !duplicateField ? state.fields.find(f => f.key === duplicateKey)?.label : undefined;
  const duplicateLabel = duplicateKey === null
    ? t('review.duplicateSettings')
    : !duplicateKey
      ? t('review.duplicateNone')
      : duplicateField?.label ?? (missingLabel ? t('review.duplicateMissing', { field: missingLabel }) : t('review.duplicateOff'));

  const removeField = (id: string) => {
    dispatch({ type: 'remove', id });
    setJustRemoved(ids => new Set(ids).add(id));
  };
  const restoreField = (id: string) => {
    dispatch({ type: 'restore', id });
    setJustRemoved(ids => {
      const next = new Set(ids);
      next.delete(id);
      return next;
    });
    // The row with the Restore button is gone: focus moves to the field that came back.
    setRestoreFocus({ field: id });
  };
  // From the "Removed fields" list: on to the next one there, or to the field once the list is empty.
  const restoreFromList = (id: string) => {
    const index = removed.findIndex(f => f.id === id);
    const next = removed[index + 1] ?? removed[index - 1];
    dispatch({ type: 'restore', id });
    setRestoreFocus(next ? { button: restoreButtonId(next.id) } : { field: id });
  };

  // Keyboard and screen-reader users keep their place in a long list instead of landing on the page.
  useEffect(() => {
    if (!restoreFocus) return;
    if ('field' in restoreFocus) focusField(restoreFocus.field);
    else document.getElementById(restoreFocus.button)?.focus();
    setRestoreFocus(null);
  }, [restoreFocus]);

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

  // A note or voice note that arrives (a restored scan, a transcript) opens its panel. It is never
  // closed for the user: clearing the text mustn't collapse the box they are typing in.
  useEffect(() => {
    if (hasNote && notePanel.current) notePanel.current.open = true;
  }, [hasNote]);

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

  // While the photo uploads on a slow connection, the button says how much has gone.
  const sentPercent = Math.floor(saveSent * 10) * 10;
  const saveLabel = saving
    ? sentPercent > 0 && sentPercent < 100 ? t('review.savingSent', { percent: sentPercent }) : t('common.saving')
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
            // The thumbnail is the "View photo" button, so the strip stays one row on a phone.
            urls[0] && (
              <button type="button" className={styles.thumbButton} aria-label={t('review.viewPhoto')} title={t('review.viewPhoto')} onClick={() => setViewerOpen(true)}>
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
                <img src={urls[0]} alt="" className={styles.thumb} />
                <span className={styles.thumbIcon} aria-hidden><Eye size={16} /></span>
              </button>
            )
          )}
          <div className={styles.row}>
            {pinned && <PageButtons urls={urls} page={page} onPage={setPage} />}
            <Button icon={pinned ? <PinOff size={18} aria-hidden /> : <Pin size={18} aria-hidden />} aria-pressed={pinned} onClick={togglePinned}>
              {t('review.pinPhoto')}
            </Button>
            {pinned && <Button icon={<Eye size={18} aria-hidden />} onClick={() => setViewerOpen(true)}>{t('review.viewPhoto')}</Button>}
          </div>
        </div>

        <div className={styles.reviewHeading}>
          <h2 className={styles.reviewTitle}>{t('review.title')}</h2>
          <p className={`${styles.muted} ${styles.reviewSubtitle}`}>{t('review.subtitle')}</p>
        </div>

        {state.autoSave && <Notice tone="info">{t('review.autoSave')}</Notice>}
        {state.isMock && (
          <Notice tone="warning" title={t('review.sampleTitle')} urgent>
            <p>{t('review.sampleBody')}</p>
          </Notice>
        )}
        {/* "Try a sample" is read and saved for real: say the row it adds to the sheet is a test. */}
        {state.sample && (
          <Notice tone="info" title={t('review.sampleScanTitle')}>
            <p>{t('review.sampleScanBody')}</p>
          </Notice>
        )}
        {state.error && (
          <div ref={errorRef} tabIndex={-1}>
            <Notice tone="danger" title={t('error.saveTitle')} urgent>
              {failedEverywhere.length > 0 ? (
                <>
                  <p>{t('done.failedBody')}</p>
                  <ul style={{ paddingLeft: 20 }}>
                    {failedEverywhere.map(d => <li key={d}>{d === 'media' && !state.audio ? t('dest.mediaPhoto') : t(`dest.${d}`)}: {t(failureKey(state.result?.destinations[d]))}</li>)}
                  </ul>
                </>
              ) : <p>{t(`error.${state.error}`)}</p>}
              {kept && <p>{t('review.kept')}</p>}
              {state.error === 'audio_too_large' && state.audio && (
                <div>
                  <Button variant="primary" icon={<MicOff size={18} aria-hidden />} onClick={onSaveWithoutVoice}>{t('review.saveWithoutVoice')}</Button>
                </div>
              )}
              {!NOT_KEEPABLE.includes(state.error) && (
                <div className={styles.row}>
                  {state.error === 'session' && <Button variant="primary" icon={<LogIn size={18} aria-hidden />} onClick={onSignIn}>{t('review.signIn')}</Button>}
                  {/* Trying again later can work: the checked values wait on this phone meanwhile. */}
                  {state.pages.length > 0 && <Button icon={<Clock size={18} aria-hidden />} onClick={onKeep}>{t('capture.keep')}</Button>}
                </div>
              )}
            </Notice>
          </div>
        )}
        {(generalWarnings.length > 0 || flagged.length > 0) && (
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
            {generalWarnings.length > 0 && <ul style={{ paddingLeft: 20 }}>{generalWarnings.map(w => <li key={w}>{w}</li>)}</ul>}
          </Notice>
        )}

        {/* Locked while saving: a change made now would not be in the saved record. */}
        <fieldset className={styles.formArea} disabled={saving}>
          <ul className={styles.fields}>
            {listed.map(field => field.removed
              ? <RemovedRow key={field.id} field={field} onRestore={restoreField} />
              : <FieldRow key={field.id} field={field} rules={rulesFor(field.id)} dispatch={dispatch} onRemove={removeField} />)}
          </ul>
          {active.length === 0 && <Notice tone="warning">{t('review.empty')}</Notice>}

          {removed.length > 0 && (
            <details className={styles.disclosure}>
              <summary>{t('review.removed', { count: removed.length })}</summary>
              <ul className={styles.removedList}>
                {removed.map(f => (
                  <li key={f.id} className={styles.removedItem}>
                    <span><strong>{f.label}</strong>{f.value ? `: ${f.value}` : ''}</span>
                    <Button id={restoreButtonId(f.id)} variant="ghost" icon={<RotateCcw size={18} aria-hidden />} onClick={() => restoreFromList(f.id)}>{t('common.restore')}</Button>
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

          <details ref={notePanel} className={styles.disclosure}>
            <summary>{t('review.noteTitle')}</summary>
            <div className={styles.stack} style={{ marginTop: 8 }}>
              <TextArea label={t('done.notes')} hideLabel placeholder={t('review.notePlaceholder')} value={state.note} onChange={e => dispatch({ type: 'note', value: e.target.value })} />
              <ModuleBoundary title={t('boundary.title', { name: t('voice.panel') })} body={t('boundary.body')} retryLabel={t('common.retry')}>
                <VoiceNote
                  audio={state.audio}
                  onAudio={blob => dispatch({ type: 'audio', blob })}
                  onText={text => dispatch({ type: 'note-append', text })}
                  onBusy={onVoiceBusy}
                  saving={saving}
                />
              </ModuleBoundary>
            </div>
          </details>
        </fieldset>

        {/* A setting for this document type, not just this scan, so it lives below the fields. */}
        {active.length > 0 && (
          <details className={styles.disclosure}>
            <summary>{t('review.duplicateTitle', { field: duplicateLabel })}</summary>
            <div style={{ marginTop: 8 }}>
              <SelectField label={t('review.duplicateCheck')} hint={t('review.duplicateHint', { name: documentName })} value={duplicateKey ?? UNKNOWN} onChange={e => onDuplicateKey(e.target.value)}>
                {duplicateKey === null && <option value={UNKNOWN} disabled>{duplicateLabel}</option>}
                <option value="">{t('review.duplicateNone')}</option>
                {duplicateKey && !duplicateField && <option value={duplicateKey} disabled>{duplicateLabel}</option>}
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

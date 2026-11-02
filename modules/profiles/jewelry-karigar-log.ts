import { parseNumber, toAsciiDigits } from '@/core/text';
import { parseIndianDate } from './checks';
import { fieldKey, fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField, RuleWarning } from './types';

const DATE_ISSUED = ['dateIssued', 'issueDate', 'date'];
const DATE_RETURNED = ['dateReturned', 'returnDate', 'deliveryDate', 'dateReceived'];
const METAL_ISSUED = ['metalIssued', 'goldIssued', 'silverIssued', 'metalIssuedG', 'goldIssuedG', 'issuedWeight'];
const FINISHED = ['finishedWeight', 'finishedWeightG', 'ornamentWeight', 'grossWeight', 'readyWeight'];
const STONES = ['stoneWeight', 'stonesWeight', 'stoneWeightG', 'otherWeight', 'stonesOtherWeight'];
const RETURNED = ['metalReturned', 'goldReturned', 'balanceReturned', 'scrapReturned'];
const WASTAGE_G = ['wastageGrams', 'wastageG', 'wastageGm', 'wastageWeight', 'wastage', 'ghat', 'ghatt', 'chhijat'];
const WASTAGE_PCT = ['wastagePercent', 'wastagePct', 'wastagePercentage', 'wastage'];
const PURITY = ['purity', 'tunch', 'touch', 'karat', 'fineness'];
const MAKING = ['makingCharges', 'making', 'labourCharges', 'laborCharges', 'majdoori', 'banwai'];

/** Above this the app asks the user to double-check; it is a rule of thumb, not a trade limit. */
const HIGH_WASTAGE_PCT = 8;
/** Usual fineness for each karat (parts per thousand), as in BIS hallmarks such as 22K916. */
const FINENESS: Record<number, number[]> = { 24: [999, 995], 23: [958], 22: [916], 20: [833], 18: [750], 14: [585] };
/** "22K", "22 kt", "18 carat"; also straight before the fineness in a hallmark ("22K916"). */
const KARAT = /(\d{2})\s*(?:k|kt|ct|carat|karat)(?![a-z])/i;
/** Three digits on their own, or after the karat in a hallmark ("22K916" → 916). */
const FINENESS_IN_TEXT = /(?<!\d)(\d{3})(?!\d)/;
/** Grams per unit a weight may be written in; carats only for stones (1 ct = 0.2 g). */
const GRAM_UNITS: [RegExp, number][] = [
  [/^(?:g|gms?|grams?|gm|ग्राम|ग्रा)$/i, 1],
  [/^(?:mg|mgs|milligrams?|मिलीग्राम)$/i, 0.001],
  [/^(?:kg|kgs|किलो)$/i, 1000],
];
const CARATS = /^(?:ct|cts|carats?|कैरेट)$/i;
/** A number and the word after it: "20.150 g", "850 mg", "0.85 ct", "20.000". */
const GRAM_PART = /(\d+(?:\.\d+)?)\s*([a-z]+|[ऀ-ॿ]+)?/i;

/** Named as a percent ("Wastage %"), or a plain "Wastage" written as one ("3.5%", "3.5 प्रतिशत") and not in grams. */
const isPercent = (f: RecordField) => /%|percent|pct|प्रतिशत/i.test(`${f.key} ${f.label}`)
  || (/%|प्रतिशत/.test(f.value ?? '') && !/\d\s*(?:g|gms?|grams?|ग्राम)(?![a-z])/i.test(f.value ?? ''));
/** "Wastage %" and "Wastage (g)" both normalize close to "wastage", so grams and percent are told apart here. */
const wastageGramsField = (fields: RecordField[]) => findField(fields.filter(f => !isPercent(f)), WASTAGE_G);
const wastagePctField = (fields: RecordField[]) => findField(fields.filter(isPercent), WASTAGE_PCT);
/**
 * A weight in grams: a number on its own is grams, "850 mg" → 0.85, and for stones "0.85 ct" →
 * 0.17. Undefined when no number is written; null when the unit isn't one of these, so no
 * impossible wastage is worked out from it.
 */
function gramsIn(text: string | undefined, stones = false): number | null | undefined {
  const match = toAsciiDigits(text ?? '').replace(/(\d),(?=\d)/g, '$1').match(GRAM_PART);
  if (!match) return undefined;
  const unit = match[2];
  const perUnit = !unit ? 1 : stones && CARATS.test(unit) ? 0.2 : GRAM_UNITS.find(([pattern]) => pattern.test(unit))?.[1];
  return perUnit === undefined ? null : Number(match[1]) * perUnit;
}
const weight = (fields: RecordField[], aliases: string[], stones = false) => gramsIn(fieldValue(fields, aliases), stones);
const grams = (n: number) => String(Number(n.toFixed(3)));
const pct = (n: number) => String(Number(n.toFixed(2)));

interface Weights { issued: number; finished: number; stones: number; returned: number; netMetal: number; used: number; wastage: number }

/**
 * Weights from the card, in grams; missing stones or returned metal count as 0 (plain ornament,
 * nothing returned). Null when a weight is missing or written in a unit that can't be read.
 */
function weights(fields: RecordField[]): Weights | null {
  const issued = weight(fields, METAL_ISSUED);
  const finished = weight(fields, FINISHED);
  const stonesWritten = weight(fields, STONES, true);
  const returnedWritten = weight(fields, RETURNED);
  // Nothing written (undefined) counts as 0; a unit that can't be read (null) stops the sums.
  if (issued == null || finished == null || stonesWritten === null || returnedWritten === null) return null;
  const stones = stonesWritten ?? 0;
  const returned = returnedWritten ?? 0;
  const netMetal = finished - stones;
  return { issued, finished, stones, returned, netMetal, used: issued - returned, wastage: issued - returned - netMetal };
}

export const jewelryKarigarLog: DocumentProfile = {
  id: 'jewelry-karigar-log',
  title: 'Jewelry Making (Karigari) Logs',
  documentName: 'Karigar Job Card',
  description: 'Track raw gold issued, wastage, and finished ornament weight for each karigar job.',
  group: 'crafts',
  sheetTab: 'Karigar_Jobs',
  sheetTitle: 'DocSync — Jewelry Karigari Logs',
  sampleDocument: { href: '/samples/jewelry-karigar-log.jpg', fileName: 'Sample_Karigar_Job_Card.jpg' },
  duplicateKey: 'jobNumber',
  translations: {
    hi: {
      title: 'गहना कारीगरी रजिस्टर',
      documentName: 'कारीगर जॉब पर्ची',
      description: 'हर कारीगर जॉब में दिया गया सोना, घटत और तैयार गहनों का वज़न दर्ज करें।',
    },
  },
  extraction: {
    context: 'This is an Indian jeweller\'s karigar job card or karigar register entry: gold or silver given to a karigar (कारीगर) to make one ornament order, and what came back. Typical fields: job/order no., date issued and date returned, karigar name, ornament (e.g. jhumka, ring, chain), metal, purity or tunch (टंच, e.g. 22K/916, 18K/750, silver 925), metal issued in grams (सोना दिया), finished ornament weight (तैयार वज़न), stone/other weight (नग/स्टोन वज़न; keep the unit when it is mg or carats, e.g. "0.85 ct"), any unused metal returned (वापसी), wastage in grams and % (घट/छीजत) and making charges (मजदूरी/बनवाई) as a rupee total. Record weights in grams as written (up to 3 decimals); keep wastage grams and wastage % as separate fields.',
    priorityFields: ['Job Number', 'Date Issued', 'Karigar Name', 'Ornament', 'Purity', 'Metal Issued (g)', 'Finished Weight (g)', 'Stone Weight (g)', 'Wastage (g)', 'Making Charges'],
  },
  mockFields: [
    { key: 'jobNumber', label: 'Job Number', value: 'KJ-2026-0412', confidence: 93, category: 'identity' },
    { key: 'dateIssued', label: 'Date Issued', value: '05-10-2026', confidence: 92, category: 'date' },
    { key: 'karigarName', label: 'Karigar Name', value: 'Tapan Karmakar', confidence: 94, category: 'identity' },
    { key: 'ornament', label: 'Ornament', value: 'Jhumka Pair (stone work)', confidence: 86, category: 'other' },
    { key: 'metal', label: 'Metal', value: 'Gold', confidence: 97, category: 'other' },
    { key: 'purity', label: 'Purity', value: '22K / 916', confidence: 90, category: 'other' },
    { key: 'metalIssued', label: 'Metal Issued (g)', value: '20.000', confidence: 95, category: 'other' },
    { key: 'finishedWeight', label: 'Finished Weight (g)', value: '20.150', confidence: 93, category: 'other' },
    { key: 'stoneWeight', label: 'Stone Weight (g)', value: '0.850', confidence: 88, category: 'other' },
    { key: 'wastageGrams', label: 'Wastage (g)', value: '0.700', confidence: 89, category: 'other' },
    { key: 'makingCharges', label: 'Making Charges', value: '₹3,500', confidence: 94, category: 'financial' },
    { key: 'dateReturned', label: 'Date Returned', value: '14-10-2026', confidence: 91, category: 'date' },
  ],
  notion: {
    titleFrom: ['karigarName', 'karigar', 'name'],
    dateFrom: ['dateReturned', 'returnDate', 'dateIssued', 'date'],
    properties: [
      { name: 'Amount', type: 'number', from: MAKING },
      { name: 'Metal Issued (g)', type: 'number', from: METAL_ISSUED },
      { name: 'Wastage (g)', type: 'number', from: ['wastageGrams', 'wastageG', 'wastageGm', 'wastageWeight'] },
    ],
  },
  derive(fields) {
    const w = weights(fields);
    let out = fields;
    let wastage = gramsIn(wastageGramsField(fields)?.value) ?? null;
    if (!wastageGramsField(fields) && w && w.wastage >= -0.0005) {
      wastage = Math.max(0, w.wastage);
      out = [...out, { key: 'wastageGrams', label: 'Wastage (g)', value: grams(wastage), confidence: 100, category: 'other' }];
    }
    if (!wastagePctField(fields) && w && wastage !== null && w.used > 0) {
      out = [...out, { key: 'wastagePercent', label: 'Wastage %', value: pct((wastage / w.used) * 100), confidence: 100, category: 'other' }];
    }
    return out;
  },
  validate(fields) {
    const warnings: RuleWarning[] = [];
    const w = weights(fields);
    const statedWastage = gramsIn(wastageGramsField(fields)?.value) ?? null;
    const wastageKey = wastageGramsField(fields)?.key;

    if (w && w.netMetal + w.returned > w.issued + 0.005) {
      warnings.push({
        code: 'jewelry.metalOver',
        field: fieldKey(fields, FINISHED),
        params: { accounted: grams(w.netMetal + w.returned), finished: w.finished, stones: w.stones, returned: w.returned, issued: w.issued },
      });
    } else if (w && statedWastage !== null && Math.abs(statedWastage - w.wastage) > 0.01) {
      warnings.push({ code: 'jewelry.wastage', field: wastageKey, params: { stated: statedWastage, expected: grams(w.wastage) } });
    }

    const statedPct = parseNumber(wastagePctField(fields)?.value);
    const wastage = statedWastage ?? (w && w.wastage > 0 ? w.wastage : null);
    const computedPct = w && wastage !== null && w.used > 0 ? (wastage / w.used) * 100 : null;
    const percent = statedPct ?? computedPct;
    // Cards round the percent, and some work it out on the finished weight, so only a clear mismatch is flagged.
    if (w && wastage !== null && statedPct !== null && computedPct !== null && Math.abs(statedPct - computedPct) > 0.5) {
      warnings.push({
        code: 'jewelry.wastagePct',
        field: wastagePctField(fields)?.key,
        params: { stated: pct(statedPct), wastage: grams(wastage), used: grams(w.used), expected: pct(computedPct) },
      });
    }
    if (percent !== null && percent > HIGH_WASTAGE_PCT) {
      warnings.push({
        code: 'jewelry.wastageHigh',
        field: wastagePctField(fields)?.key ?? wastageKey,
        params: { percent: pct(percent), limit: HIGH_WASTAGE_PCT },
      });
    }

    const purity = fieldValue(fields, PURITY) ?? '';
    const karat = parseNumber(purity.match(KARAT)?.[1]);
    const fineness = parseNumber(purity.match(FINENESS_IN_TEXT)?.[1]);
    if (karat !== null && fineness !== null && FINENESS[karat] && !FINENESS[karat].includes(fineness)) {
      warnings.push({ code: 'jewelry.purity', field: fieldKey(fields, PURITY), params: { purity, karat, fineness, usual: FINENESS[karat].join('/') } });
    }

    const from = parseIndianDate(fieldValue(fields, DATE_ISSUED))?.time ?? null;
    const to = parseIndianDate(fieldValue(fields, DATE_RETURNED))?.time ?? null;
    if (from !== null && to !== null && to < from) {
      warnings.push({
        code: 'jewelry.dates',
        field: fieldKey(fields, DATE_RETURNED),
        params: { returned: fieldValue(fields, DATE_RETURNED) ?? '', issued: fieldValue(fields, DATE_ISSUED) ?? '' },
      });
    }
    return warnings;
  },
};

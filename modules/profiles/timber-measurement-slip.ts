import { parseNumber } from '@/core/text';
import { amountValue, derivedRupees, moneyClose, rupees } from './checks';
import { fieldKey, fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField, RuleWarning } from './types';

const LOGS = ['logs', 'logDetails', 'measurements', 'logMeasurements'];
const PIECES = ['pieceCount', 'numberOfLogs', 'logCount', 'pieces', 'noOfPieces', 'nag'];
const VOLUME = ['totalVolume', 'volume', 'totalCft', 'cft', 'cubicFeet'];
const RATE = ['ratePerCft', 'rate', 'ratePerCubicFoot'];
const AMOUNT = ['amount', 'totalAmount', 'netAmount'];
const CUSTOMER = ['customerName', 'customer', 'buyer', 'party'];
const SPECIES = ['woodSpecies', 'woodType', 'species', 'wood'];

const FEET = String.raw`feet|foot|ft|'|फ़ुट|फुट`;
const INCH = String.raw`inches|inch|in|"|इंच`;
/** A number with a length unit: "10 ft", "48 in". */
const MEASURED = String.raw`\s*\d+(?:\.\d+)?\s*(?:${FEET}|${INCH})`;
/** Words for a count of logs: "3 nos", "3 pcs", "3 नग". */
const COUNT = String.raw`nos?\.?|pcs?\.?|pieces?|logs?|nag|नग|लट्ठे`;
/**
 * One measurement line: length × girth (either order), with an optional count of equal logs
 * after it ("10 ft × 48 in × 3 nos", "10 × 48 × 3") or before it ("3 nos × 10 ft × 48 in", or
 * "3 × 10 ft × 48 in" when both measurements carry a unit). A count is a whole number not followed
 * by a length unit, so "× 6 in" is never one.
 */
const LOG_LINE = new RegExp(
  String.raw`(?:\b(\d+)\s*(?:(?:${COUNT})\s*[×xX*]|[×xX*](?=${MEASURED}\s*[×xX*]${MEASURED}))\s*)?`
  + String.raw`(\d+(?:\.\d+)?)\s*(${FEET}|${INCH})?\s*[×xX*]\s*(\d+(?:\.\d+)?)\s*(${FEET}|${INCH})?`
  + String.raw`(?:\s*[×xX*]\s*(\d+)(?![\d.])(?!\s*(?:${FEET}|${INCH})))?`,
  'i',
);
const IS_INCH = new RegExp(`^(${INCH})$`, 'i');
const IS_FEET = new RegExp(`^(${FEET})$`, 'i');
/** Metric measurements need a different formula, so the Hoppus check is skipped for them. */
const METRIC = /\d\s*(cm|mm|m|mtr|metres?|meters?)\b|सेमी|मीटर/i;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Hoppus volume in cft of each log in "10 ft × 48 in; 12 ft × 40 in × 3 nos" (length in feet,
 * girth in inches; a line with a count stands for that many equal logs); null if any log can't be read.
 */
function logVolumes(text: string): number[] | null {
  if (METRIC.test(text)) return null;
  const lines = text.split(/[;\n]+/).map(s => s.trim()).filter(Boolean);
  const volumes: number[] = [];
  for (const line of lines) {
    const m = line.match(LOG_LINE);
    if (!m) return null;
    let length = Number(m[2]);
    let girth = Number(m[4]);
    if ((m[3] && IS_INCH.test(m[3])) || (m[5] && IS_FEET.test(m[5]))) [length, girth] = [girth, length];
    const count = Number(m[1] ?? m[6] ?? 1);
    if (!(count >= 1)) return null;
    for (let i = 0; i < count; i++) volumes.push(((girth / 4) ** 2 * length) / 144);
  }
  return volumes.length ? volumes : null;
}

export const timberMeasurementSlip: DocumentProfile = {
  id: 'timber-measurement-slip',
  title: 'Timber Mart Measurement Slips',
  documentName: 'Timber Measurement Slip',
  description: 'Turn each timber mart slip into one row: wood type, logs, lengths, girths, cubic feet and amount.',
  group: 'industry',
  sheetTab: 'Timber_Slips',
  sheetTitle: 'DocSync — Timber Measurement Slips',
  sampleDocument: { href: '/samples/timber-measurement-slip.jpg', fileName: 'Sample_Timber_Measurement_Slip.jpg' },
  duplicateKey: 'slipNumber',
  translations: {
    hi: {
      title: 'लकड़ी टाल नाप पर्चियाँ',
      documentName: 'लकड़ी नाप पर्ची',
      description: 'हर लकड़ी पर्ची से किस्म, लट्ठों की गिनती, लंबाई, गोलाई, घन फ़ुट और रकम पढ़कर शीट में जोड़ें।',
    },
  },
  extraction: {
    context: 'This is an Indian timber mart (लकड़ी टाल, timber depot) measurement slip (नाप पर्ची) for logs sold by volume. Capture slip number, date, timber mart, customer (ग्राहक), wood species (e.g. शीशम sheesham, सागौन teak, आम mango, नीम neem, बबूल babool), number of logs or pieces (नग/लट्ठे), total volume in cubic feet (घन फ़ुट, cft), rate per cft and amount (रकम). Put every log in ONE "Logs" field as "length ft × girth in; …" with length (लंबाई) in feet and girth (गोलाई, the round measurement) in inches, and a line that stands for several equal logs as "length ft × girth in × count nos"; volume is normally by the Hoppus rule (girth/4)² × length ÷ 144.',
    priorityFields: ['Slip Number', 'Date', 'Timber Mart', 'Customer', 'Wood Species', 'Number of Logs', 'Logs', 'Total Volume (cft)', 'Rate per cft', 'Amount'],
  },
  mockFields: [
    { key: 'slipNumber', label: 'Slip Number', value: '1127', confidence: 92, category: 'identity' },
    { key: 'date', label: 'Date', value: '25-10-2026', confidence: 95, category: 'date' },
    { key: 'timberMart', label: 'Timber Mart', value: 'New Rampur Timber Mart', confidence: 90, category: 'identity' },
    { key: 'customerName', label: 'Customer', value: 'Harish Furniture Works', confidence: 86, category: 'identity' },
    { key: 'woodSpecies', label: 'Wood Species', value: 'Sheesham', confidence: 91, category: 'other' },
    { key: 'pieceCount', label: 'Number of Logs', value: '5', confidence: 95, category: 'other' },
    { key: 'logs', label: 'Logs', value: '10 ft × 48 in; 12 ft × 40 in; 8 ft × 36 in; 9 ft × 44 in; 11 ft × 32 in', confidence: 82, category: 'other' },
    { key: 'totalVolume', label: 'Total Volume (cft)', value: '35.28', confidence: 90, category: 'other' },
    { key: 'ratePerCft', label: 'Rate per cft', value: '₹1,400', confidence: 93, category: 'financial' },
    { key: 'amount', label: 'Amount', value: '₹49,392', confidence: 96, category: 'financial' },
  ],
  notion: {
    titleFrom: CUSTOMER,
    dateFrom: ['date', 'slipDate'],
    properties: [
      { name: 'Amount', type: 'number', from: AMOUNT },
      { name: 'Volume (cft)', type: 'number', from: VOLUME },
      { name: 'Wood Species', type: 'select', from: SPECIES },
    ],
  },
  derive(fields) {
    const added: RecordField[] = [];
    let volume = parseNumber(fieldValue(fields, VOLUME));
    if (!findField(fields, VOLUME)) {
      const logs = fieldValue(fields, LOGS);
      const volumes = logs ? logVolumes(logs) : null;
      if (volumes) {
        volume = round2(volumes.reduce((a, b) => a + b, 0));
        added.push({ key: 'totalVolume', label: 'Total Volume (cft)', value: String(volume), confidence: 100, category: 'other' });
      }
    }
    const rate = amountValue(fieldValue(fields, RATE));
    if (!findField(fields, AMOUNT) && volume !== null && rate !== null) {
      added.push({ key: 'amount', label: 'Amount', value: derivedRupees(round2(volume * rate)), confidence: 100, category: 'financial' });
    }
    return added.length ? [...fields, ...added] : fields;
  },
  validate(fields) {
    const warnings: RuleWarning[] = [];
    const volume = parseNumber(fieldValue(fields, VOLUME));
    const rate = amountValue(fieldValue(fields, RATE));
    const amount = amountValue(fieldValue(fields, AMOUNT));
    const pieces = parseNumber(fieldValue(fields, PIECES));
    const logs = fieldValue(fields, LOGS);
    const volumes = logs ? logVolumes(logs) : null;

    if (volume !== null && rate !== null && amount !== null && !moneyClose(volume * rate, amount)) {
      warnings.push({ code: 'timber.amount', field: fieldKey(fields, AMOUNT), params: { amount: rupees(amount), volume, rate: rupees(rate), expected: rupees(volume * rate) } });
    }
    if (volumes) {
      if (pieces !== null && pieces !== volumes.length) {
        warnings.push({ code: 'timber.logs', field: fieldKey(fields, PIECES), params: { pieces, measured: volumes.length } });
      }
      const measured = round2(volumes.reduce((a, b) => a + b, 0));
      if (volume !== null && Math.abs(measured - volume) > Math.max(0.1, measured * 0.05)) {
        warnings.push({ code: 'timber.volume', field: fieldKey(fields, VOLUME), params: { volume, measured } });
      }
    }
    return warnings;
  },
};

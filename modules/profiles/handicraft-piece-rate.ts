import { parseNumber, toAsciiDigits } from '@/core/text';
import { amountValue, maskAadhaar, moneyClose, quantityInRateUnits, rateBasis, rupees } from './checks';
import { fieldKey, fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField, RuleWarning } from './types';

const ISSUED = ['piecesIssued', 'issued', 'qtyIssued'];
const COMPLETED = ['piecesCompleted', 'completed', 'piecesMade', 'qtyCompleted', 'piecesReceived'];
const REJECTED = ['piecesRejected', 'rejected', 'qcRejected', 'rejectedPieces'];
const RATE = ['ratePerPiece', 'rate', 'pieceRate'];
const AMOUNT = ['amountDue', 'amount', 'totalAmount', 'grossAmount'];
const ADVANCE = ['advance', 'advancePaid', 'advanceDeducted'];
const NET = ['netPayable', 'netAmount', 'netPaid', 'balancePayable'];
const ENTRIES = ['entries', 'lines', 'products', 'items'];

/** "Cushion CC-07 – 110 pcs × ₹45", "Bangles – 4 doz × ₹120": quantity, its unit and the rate. */
const QTY_RATE = /(\d+(?:\.\d+)?)\s*([a-z]+\.?|[ऀ-ॿ]+)?\s*[×xX*@]\s*(?:₹|rs\.?)?\s*(\d+(?:\.\d+)?)/i;

const num = (fields: RecordField[], aliases: string[]) => parseNumber(fieldValue(fields, aliases));
const money = (fields: RecordField[], aliases: string[]) => amountValue(fieldValue(fields, aliases));
const round2 = (n: number) => String(Number(n.toFixed(2)));

interface Expected {
  value: number;
  /** For accepted pieces × rate; absent when the amount is the sum of the product lines. */
  accepted?: number;
  /** Rate per piece ("₹120 per dozen" → ₹10). */
  rate?: number;
}

/**
 * The product lines' amounts (quantity × rate, in the rate's basis: "48 pcs × ₹120 per dozen" →
 * ₹480; null for a line that can't be read), or null when there are none. `mixed` when the lines
 * have more than one rate, so the card's totals can't be priced with a single rate.
 */
function entryAmounts(fields: RecordField[]): { amounts: (number | null)[]; mixed: boolean } | null {
  const text = fieldValue(fields, ENTRIES);
  if (!text) return null;
  const lines = toAsciiDigits(text).replace(/(\d),(?=\d)/g, '$1').split(/[;\n]+/).map(s => s.trim()).filter(Boolean);
  const rates = new Set<number>();
  const amounts = lines.map(line => {
    const m = line.match(QTY_RATE);
    if (!m) return null;
    rates.add(Number(m[3]));
    const units = quantityInRateUnits(`${m[1]} ${m[2] ?? ''}`, undefined, rateBasis(line.slice((m.index ?? 0) + m[0].length)));
    return units === null ? null : units * Number(m[3]);
  });
  if (rates.size === 0) return null;
  return { amounts, mixed: rates.size > 1 };
}

/**
 * The amount due: the product lines added up when every line has pieces × rate, else accepted
 * pieces × the rate per piece (a rate "per dozen" or "per 100" is divided down); a blank or
 * unreadable "rejected" counts as none. Null when a figure is missing, or the lines have several
 * rates and not all of them can be read.
 */
function expectedAmount(fields: RecordField[]): Expected | null {
  const entries = entryAmounts(fields);
  if (entries && entries.amounts.every(a => a !== null)) {
    return { value: Math.round((entries.amounts as number[]).reduce((a, b) => a + b, 0) * 100) / 100 };
  }
  if (entries?.mixed) return null;
  const completed = num(fields, COMPLETED);
  const rateField = findField(fields, RATE);
  const rate = amountValue(rateField?.value);
  if (!rateField || completed === null || rate === null) return null;
  const basis = rateBasis(rateField.value, rateField.label);
  const perPiece = rate / (basis?.unit === null ? basis.per : 1);
  const accepted = completed - (num(fields, REJECTED) ?? 0);
  return { accepted, rate: perPiece, value: Math.round(accepted * perPiece * 100) / 100 };
}

export const handicraftPieceRate: DocumentProfile = {
  id: 'handicraft-piece-rate',
  title: 'Handicraft Artisan Piece-rate Cards',
  documentName: 'Artisan Piece-rate Card',
  description: "Keep each artisan's pieces made, quality-check rejections and payment due in your sheet.",
  group: 'crafts',
  sheetTab: 'Artisan_Piece_Rate',
  sheetTitle: 'DocSync — Handicraft Piece-rate Cards',
  sampleDocument: { href: '/samples/handicraft-piece-rate.jpg', fileName: 'Sample_Artisan_Piece_Rate_Card.jpg' },
  duplicateKey: 'cardNumber',
  translations: {
    hi: {
      title: 'हस्तशिल्प कारीगर नग-दर कार्ड',
      documentName: 'कारीगर नग-दर कार्ड',
      description: 'हर कारीगर के बने नग, गुणवत्ता जाँच में रिजेक्ट नग और बकाया भुगतान पढ़कर शीट में जोड़ें।',
    },
  },
  extraction: {
    context: 'This is an Indian handicraft artisan piece-rate card (job card) from an exporter, workshop or craft cluster, recording work given to one artisan and the payment due. Typical fields: card no., artisan name (कारीगर का नाम) and artisan ID, date or period, product/design no. (माल/डिज़ाइन), pieces issued (दिए नग), pieces completed (बने नग), pieces rejected in QC (रिजेक्ट/छँटनी), rate per piece (दर), amount due (रकम), advance (एडवांस/पेशगी) and net payable (बाकी भुगतान). Record the card date (or the last day of the period) as "Date" and a written period such as "1–15 Oct" as "Period"; if several products are listed, put the totals in these fields and the lines compactly in one "Entries" field (e.g. "Cushion CC-07 – 110 pcs × ₹45; Runner TR-02 – 20 pcs × ₹60"). Write a rate with its basis ("₹120 per dozen", "₹450 per 100"). If an Aadhaar number is written, record only its last 4 digits as "XXXX XXXX 1234".',
    priorityFields: ['Card Number', 'Artisan Name', 'Artisan ID', 'Date', 'Product / Design', 'Pieces Issued', 'Pieces Completed', 'Pieces Rejected', 'Rate per Piece', 'Net Payable'],
  },
  mockFields: [
    { key: 'cardNumber', label: 'Card Number', value: 'PRC-2026-0233', confidence: 92, category: 'identity' },
    { key: 'artisanName', label: 'Artisan Name', value: 'Shabana Bano', confidence: 95, category: 'identity' },
    { key: 'artisanId', label: 'Artisan ID', value: 'ART-0581', confidence: 88, category: 'identity' },
    { key: 'date', label: 'Date', value: '15-10-2026', confidence: 93, category: 'date' },
    { key: 'product', label: 'Product / Design', value: 'Embroidered Cushion Cover (CC-07)', confidence: 85, category: 'other' },
    { key: 'piecesIssued', label: 'Pieces Issued', value: '120', confidence: 96, category: 'other' },
    { key: 'piecesCompleted', label: 'Pieces Completed', value: '115', confidence: 95, category: 'other' },
    { key: 'piecesRejected', label: 'Pieces Rejected', value: '5', confidence: 90, category: 'other' },
    { key: 'ratePerPiece', label: 'Rate per Piece', value: '₹45', confidence: 94, category: 'financial' },
    { key: 'amountDue', label: 'Amount Due', value: '₹4,950', confidence: 95, category: 'financial' },
    { key: 'advance', label: 'Advance', value: '₹1,000', confidence: 91, category: 'financial' },
    { key: 'netPayable', label: 'Net Payable', value: '₹3,950', confidence: 96, category: 'financial' },
  ],
  notion: {
    titleFrom: ['artisanName', 'artisan', 'name'],
    dateFrom: ['date', 'cardDate', 'periodEnd', 'periodTo'],
    properties: [
      { name: 'Amount', type: 'number', from: AMOUNT },
      { name: 'Quantity', type: 'number', from: COMPLETED },
      { name: 'Pieces Rejected (QC)', type: 'number', from: REJECTED },
    ],
  },
  derive(fields) {
    let out = fields.map(maskAadhaar);
    if (out.every((f, i) => f === fields[i])) out = fields;

    let amount = money(out, AMOUNT);
    const expected = expectedAmount(out);
    if (!findField(out, AMOUNT) && expected) {
      amount = expected.value;
      out = [...out, { key: 'amountDue', label: 'Amount Due', value: round2(amount), confidence: 100, category: 'financial' }];
    }
    const advance = money(out, ADVANCE);
    if (!findField(out, NET) && amount !== null && advance !== null) {
      out = [...out, { key: 'netPayable', label: 'Net Payable', value: round2(amount - advance), confidence: 100, category: 'financial' }];
    }
    return out;
  },
  validate(fields) {
    const warnings: RuleWarning[] = [];
    const issued = num(fields, ISSUED);
    const completed = num(fields, COMPLETED);
    const rejected = num(fields, REJECTED);
    const amount = money(fields, AMOUNT);
    const advance = money(fields, ADVANCE);
    const net = money(fields, NET);

    if (issued !== null && completed !== null && completed > issued) {
      warnings.push({ code: 'handicraft.completedOver', field: fieldKey(fields, COMPLETED), params: { completed, issued } });
    }
    if (completed !== null && rejected !== null && rejected > completed) {
      warnings.push({ code: 'handicraft.rejectedOver', field: fieldKey(fields, REJECTED), params: { rejected, completed } });
    }
    const expected = expectedAmount(fields);
    if (amount !== null && expected && !moneyClose(amount, expected.value)) {
      warnings.push(expected.accepted === undefined || expected.rate === undefined
        ? { code: 'handicraft.entries', field: fieldKey(fields, AMOUNT), params: { amount: rupees(amount), expected: rupees(expected.value) } }
        : {
          code: 'handicraft.amount',
          field: fieldKey(fields, AMOUNT),
          params: { amount: rupees(amount), accepted: expected.accepted, rate: rupees(expected.rate), expected: rupees(expected.value) },
        });
    }
    if (amount !== null && advance !== null && net !== null && Math.abs(amount - advance - net) > 1) {
      warnings.push({
        code: 'handicraft.net',
        field: fieldKey(fields, NET),
        params: { net: rupees(net), amount: rupees(amount), advance: rupees(advance), expected: rupees(amount - advance) },
      });
    }
    return warnings;
  },
};

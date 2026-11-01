import { parseNumber } from '@/core/text';
import { amountValue, derivedRupees, idDate, maskAadhaar, moneyClose, parseIndianDate, rupees, weightKg } from './checks';
import { fieldKey, fieldValue, findField, withSlipId } from './fields';
import type { DocumentProfile, RecordField, RuleWarning } from './types';

const DATE_ISSUED = ['dateIssued', 'issueDate', 'yarnIssueDate'];
const DATE_RECEIVED = ['dateReceived', 'receivedDate', 'receiptDate', 'clothReceivedDate'];
const YARN_ISSUED = ['yarnIssued', 'yarnIssuedKg', 'yarnGiven'];
const YARN_CONSUMED = ['yarnConsumed', 'yarnConsumedKg', 'yarnUsed'];
const YARN_RETURNED = ['yarnReturned', 'yarnReturnedKg', 'yarnBalance'];
const PIECES = ['piecesWoven', 'pieces', 'noOfPieces'];
const METRES = ['metresWoven', 'metersWoven', 'metres', 'meters'];
const PIECE_RATE = ['ratePerPiece', 'pieceRate'];
const METRE_RATE = ['ratePerMetre', 'ratePerMeter', 'metreRate', 'meterRate'];
const RATE = ['rate', 'wageRate'];
const WAGES = ['wages', 'wageAmount', 'totalWages', 'grossWages'];
const ADVANCE = ['advance', 'advancePaid', 'advanceDeducted'];
const NET = ['netPaid', 'netPayable', 'netAmount', 'amountPaid'];
const WEAVER = ['weaverId', 'loomNumber', 'loomNo', 'weaverNumber', 'weaverNo', 'weaverName', 'weaver', 'name'];


const num = (fields: RecordField[], aliases: string[]) => parseNumber(fieldValue(fields, aliases));
const money = (fields: RecordField[], aliases: string[]) => amountValue(fieldValue(fields, aliases));
/** Yarn in kg, as written or in grams ("4.5", "4.5 kg", "4200 g", "4 किलो 200 ग्राम"). */
const yarnKg = (fields: RecordField[], aliases: string[]) => weightKg(fieldValue(fields, aliases));

interface WageSum { by: 'pieces' | 'metres'; quantity: number; rate: number; value: number }

/** Every way the document's numbers say wages should be worked out ("6 pieces × ₹450"). */
function wageCandidates(fields: RecordField[]): WageSum[] {
  const pieces = num(fields, PIECES);
  const metres = num(fields, METRES);
  const pieceRate = money(fields, PIECE_RATE);
  const metreRate = money(fields, METRE_RATE);
  const rate = money(fields, RATE);
  const out: WageSum[] = [];
  const add = (by: WageSum['by'], quantity: number | null, rate: number | null) => {
    if (quantity !== null && rate !== null) out.push({ by, quantity, rate, value: quantity * rate });
  };
  add('pieces', pieces, pieceRate);
  add('metres', metres, metreRate);
  add('pieces', pieces, rate);
  add('metres', metres, rate);
  return out;
}

export const handloomWeaverLog: DocumentProfile = {
  id: 'handloom-weaver-log',
  title: 'Handloom Weaver Logs',
  documentName: 'Handloom Weaver Log',
  description: "Keep each weaver's yarn issued and used, metres woven and piece-rate wages in your sheet.",
  group: 'crafts',
  sheetTab: 'Handloom_Weavers',
  sheetTitle: 'DocSync — Handloom Weaver Logs',
  sampleDocument: { href: '/samples/handloom-weaver-log.jpg', fileName: 'Sample_Handloom_Weaver_Log.jpg' },
  // A loom gets yarn many times: one weaver's yarn issued on one day is one log entry.
  duplicateKey: 'slipId',
  translations: {
    hi: {
      title: 'हथकरघा बुनकर रजिस्टर',
      documentName: 'बुनकर हिसाब पर्ची',
      description: 'दिया गया और लगा धागा, बुने गए मीटर और नग-दर मज़दूरी का हिसाब पढ़कर शीट में जोड़ें।',
    },
  },
  extraction: {
    context: 'This is an Indian handloom weaver\'s log: a page of a master weaver\'s or weavers\' cooperative society register, or a weaver passbook (बुनकर पासबुक), recording yarn given to one weaver and the cloth received back. Typical fields: weaver name (बुनकर का नाम), weaver or loom no., society or master weaver, date yarn issued (धागा दिया) and date cloth received (कपड़ा जमा), yarn type and count (e.g. cotton 2/80s, silk), yarn issued and yarn consumed or returned in kg (सूत/धागा), pieces (नग/थान) and metres woven, rate per piece or per metre (दर), wages (मज़दूरी), advance (पेशगी/एडवांस) and net paid (भुगतान). If the page has several dated lines for this weaver, put the totals in these fields and list the lines compactly in one "Entries" field (e.g. "02-10 – 2 sarees – ₹900; 09-10 – 4 sarees – ₹1,800"). If an Aadhaar number is written, record only its last 4 digits as "XXXX XXXX 1234".',
    priorityFields: ['Weaver Name', 'Weaver / Loom No.', 'Date Issued', 'Date Received', 'Yarn Type / Count', 'Yarn Issued (kg)', 'Yarn Consumed (kg)', 'Pieces Woven', 'Wages', 'Net Paid'],
  },
  mockFields: [
    { key: 'weaverName', label: 'Weaver Name', value: 'Sitaram Pal', confidence: 94, category: 'identity' },
    { key: 'weaverId', label: 'Weaver / Loom No.', value: 'L-117', confidence: 90, category: 'identity' },
    { key: 'dateIssued', label: 'Date Issued', value: '02-10-2026', confidence: 92, category: 'date' },
    { key: 'dateReceived', label: 'Date Received', value: '16-10-2026', confidence: 91, category: 'date' },
    { key: 'yarnType', label: 'Yarn Type / Count', value: 'Cotton 2/80s', confidence: 84, category: 'other' },
    { key: 'yarnIssued', label: 'Yarn Issued (kg)', value: '4.50', confidence: 93, category: 'other' },
    { key: 'yarnConsumed', label: 'Yarn Consumed (kg)', value: '4.20', confidence: 88, category: 'other' },
    { key: 'piecesWoven', label: 'Pieces Woven', value: '6', confidence: 96, category: 'other' },
    { key: 'ratePerPiece', label: 'Rate per Piece', value: '₹450', confidence: 93, category: 'financial' },
    { key: 'wages', label: 'Wages', value: '₹2,700', confidence: 95, category: 'financial' },
    { key: 'advance', label: 'Advance', value: '₹1,000', confidence: 90, category: 'financial' },
    { key: 'netPaid', label: 'Net Paid', value: '₹1,700', confidence: 95, category: 'financial' },
  ],
  notion: {
    titleFrom: ['weaverName', 'weaver', 'name'],
    dateFrom: ['dateReceived', 'receivedDate', 'date', 'dateIssued'],
    properties: [
      { name: 'Amount', type: 'number', from: WAGES },
      { name: 'Quantity', type: 'number', from: PIECES },
      { name: 'Yarn Issued (kg)', type: 'number', from: YARN_ISSUED },
    ],
  },
  derive(fields) {
    let out = fields.map(maskAadhaar);
    if (out.every((f, i) => f === fields[i])) out = fields;

    let wages = money(out, WAGES);
    if (!findField(out, WAGES)) {
      const candidates = wageCandidates(out);
      if (candidates.length === 1) {
        wages = candidates[0].value;
        out = [...out, { key: 'wages', label: 'Wages', value: derivedRupees(wages), confidence: 100, category: 'financial' }];
      }
    }
    const advance = money(out, ADVANCE);
    if (!findField(out, NET) && wages !== null && advance !== null) {
      out = [...out, { key: 'netPaid', label: 'Net Paid', value: derivedRupees(wages - advance), confidence: 100, category: 'financial' }];
    }
    return withSlipId(out, [fieldValue(out, WEAVER), idDate(fieldValue(out, DATE_ISSUED))]);
  },
  validate(fields) {
    const warnings: RuleWarning[] = [];
    const wages = money(fields, WAGES);
    const advance = money(fields, ADVANCE);
    const net = money(fields, NET);
    const issued = yarnKg(fields, YARN_ISSUED);
    const consumed = yarnKg(fields, YARN_CONSUMED);
    const returned = yarnKg(fields, YARN_RETURNED);

    const candidates = wageCandidates(fields);
    if (wages !== null && candidates.length && !candidates.some(c => moneyClose(wages, c.value))) {
      const c = candidates[0];
      warnings.push({
        code: c.by === 'pieces' ? 'handloom.wagesPieces' : 'handloom.wagesMetres',
        field: fieldKey(fields, WAGES),
        params: { wages: rupees(wages), quantity: c.quantity, rate: rupees(c.rate), expected: rupees(c.value) },
      });
    }
    if (wages !== null && advance !== null && net !== null && Math.abs(wages - advance - net) > 1) {
      warnings.push({
        code: 'handloom.net',
        field: fieldKey(fields, NET),
        params: { net: rupees(net), wages: rupees(wages), advance: rupees(advance), expected: rupees(wages - advance) },
      });
    }
    if (issued !== null && consumed !== null && consumed > issued + 0.005) {
      warnings.push({ code: 'handloom.yarnConsumed', field: fieldKey(fields, YARN_CONSUMED), params: { consumed, issued } });
    } else if (issued !== null && returned !== null && returned > issued + 0.005) {
      warnings.push({ code: 'handloom.yarnReturned', field: fieldKey(fields, YARN_RETURNED), params: { returned, issued } });
    } else if (issued !== null && consumed !== null && returned !== null && consumed + returned > issued + 0.005) {
      warnings.push({ code: 'handloom.yarnTotal', field: fieldKey(fields, YARN_ISSUED), params: { consumed, returned, issued } });
    }
    const from = parseIndianDate(fieldValue(fields, DATE_ISSUED))?.time ?? null;
    const to = parseIndianDate(fieldValue(fields, DATE_RECEIVED))?.time ?? null;
    if (from !== null && to !== null && to < from) {
      warnings.push({
        code: 'handloom.dates',
        field: fieldKey(fields, DATE_RECEIVED),
        params: { received: fieldValue(fields, DATE_RECEIVED) ?? '', issued: fieldValue(fields, DATE_ISSUED) ?? '' },
      });
    }
    return warnings;
  },
};

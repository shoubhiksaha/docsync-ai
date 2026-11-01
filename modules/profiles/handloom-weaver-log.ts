import { parseNumber } from '@/core/text';
import { maskAadhaar, moneyClose, parseIndianDate, rupees } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField } from './types';

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


const num = (fields: RecordField[], aliases: string[]) => parseNumber(fieldValue(fields, aliases));
const round2 = (n: number) => String(Number(n.toFixed(2)));

/** Every way the document's numbers say wages should be worked out ("6 pieces × ₹450"). */
function wageCandidates(fields: RecordField[]): { text: string; value: number }[] {
  const pieces = num(fields, PIECES);
  const metres = num(fields, METRES);
  const pieceRate = num(fields, PIECE_RATE);
  const metreRate = num(fields, METRE_RATE);
  const rate = num(fields, RATE);
  const out: { text: string; value: number }[] = [];
  if (pieces !== null && pieceRate !== null) out.push({ text: `${pieces} pieces × ${rupees(pieceRate)}`, value: pieces * pieceRate });
  if (metres !== null && metreRate !== null) out.push({ text: `${metres} m × ${rupees(metreRate)}`, value: metres * metreRate });
  if (rate !== null && pieces !== null) out.push({ text: `${pieces} pieces × ${rupees(rate)}`, value: pieces * rate });
  if (rate !== null && metres !== null) out.push({ text: `${metres} m × ${rupees(rate)}`, value: metres * rate });
  return out;
}

export const handloomWeaverLog: DocumentProfile = {
  id: 'handloom-weaver-log',
  title: 'Handloom Weaver Logs',
  documentName: 'Handloom Weaver Log',
  description: 'Digitize yarn issued and consumed, metres woven, and piece-rate wage calculations.',
  group: 'crafts',
  sheetTab: 'Handloom_Weavers',
  sheetTitle: 'DocSync — Handloom Weaver Logs',
  sampleDocument: { href: '/samples/handloom-weaver-log.jpg', fileName: 'Sample_Handloom_Weaver_Log.jpg' },
  translations: {
    hi: {
      title: 'हथकरघा बुनकर रजिस्टर',
      documentName: 'बुनकर हिसाब पर्ची',
      description: 'दिया गया और लगा धागा, बुने गए मीटर और नग-दर मज़दूरी का हिसाब डिजिटल करें।',
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

    let wages = num(out, WAGES);
    if (!findField(out, WAGES)) {
      const candidates = wageCandidates(out);
      if (candidates.length === 1) {
        wages = candidates[0].value;
        out = [...out, { key: 'wages', label: 'Wages', value: round2(wages), confidence: 100, category: 'financial' }];
      }
    }
    const advance = num(out, ADVANCE);
    if (!findField(out, NET) && wages !== null && advance !== null) {
      out = [...out, { key: 'netPaid', label: 'Net Paid', value: round2(wages - advance), confidence: 100, category: 'financial' }];
    }
    return out;
  },
  validate(fields) {
    const warnings: string[] = [];
    const wages = num(fields, WAGES);
    const advance = num(fields, ADVANCE);
    const net = num(fields, NET);
    const issued = num(fields, YARN_ISSUED);
    const consumed = num(fields, YARN_CONSUMED);
    const returned = num(fields, YARN_RETURNED);

    const candidates = wageCandidates(fields);
    if (wages !== null && candidates.length && !candidates.some(c => moneyClose(wages, c.value))) {
      const c = candidates[0];
      warnings.push(`Wages (${rupees(wages)}) don't match ${c.text} = ${rupees(c.value)}. Please check the rate and quantity.`);
    }
    if (wages !== null && advance !== null && net !== null && Math.abs(wages - advance - net) > 1) {
      warnings.push(`Net paid (${rupees(net)}) doesn't equal wages ${rupees(wages)} − advance ${rupees(advance)} = ${rupees(wages - advance)}.`);
    }
    if (issued !== null && consumed !== null && consumed > issued + 0.005) {
      warnings.push(`Yarn consumed (${consumed} kg) is more than yarn issued (${issued} kg). Please check the weights.`);
    } else if (issued !== null && returned !== null && returned > issued + 0.005) {
      warnings.push(`Yarn returned (${returned} kg) is more than yarn issued (${issued} kg). Please check the weights.`);
    } else if (issued !== null && consumed !== null && returned !== null && consumed + returned > issued + 0.005) {
      warnings.push(`Yarn consumed (${consumed} kg) + returned (${returned} kg) is more than yarn issued (${issued} kg). Please check the weights.`);
    }
    const from = parseIndianDate(fieldValue(fields, DATE_ISSUED))?.time ?? null;
    const to = parseIndianDate(fieldValue(fields, DATE_RECEIVED))?.time ?? null;
    if (from !== null && to !== null && to < from) {
      warnings.push(`Date received (${fieldValue(fields, DATE_RECEIVED)}) is before date issued (${fieldValue(fields, DATE_ISSUED)}). Please check the dates.`);
    }
    return warnings;
  },
};

import { parseNumber } from '@/core/text';
import { amountValue, derivedRupees, isMobileNumber, parseIndianDate, rupees, signedAmount } from './checks';
import { fieldKey, fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField, RuleWarning } from './types';

const PHONE = ['phone', 'phoneNumber', 'mobile', 'mobileNumber', 'contactNumber'];
const ITEMS = ['items', 'itemsOut', 'itemsIssued', 'saman'];
const TOTAL_PIECES = ['totalPieces', 'totalItems', 'totalQty', 'totalQuantity', 'totalOut'];
const TOTAL_RETURNED = ['totalReturned', 'totalPiecesReturned', 'totalQtyReturned', 'returnedQty', 'totalIn'];
const SHORT = ['itemsShortDamaged', 'shortDamaged', 'itemsShort', 'shortOrDamaged', 'damaged', 'short'];
const DELIVERY = ['deliveryDate', 'issueDate', 'dateOut'];
const RETURN = ['returnDate', 'dateReturned', 'dateIn'];
const RENT = ['rent', 'totalRent', 'rentAmount', 'kiraya'];
const ADVANCE = ['advance', 'advancePaid', 'advanceAmount'];
const BALANCE = ['balance', 'balanceDue', 'baki', 'balanceAmount'];

/** Between an item's name and its quantities, and between "out" and "returned": "Chairs – 200 – 195". */
const ITEM_SEPARATOR = /\s*[–—]\s*|\s+-\s+/;
/** Rate or amount maths on a line ("200 × ₹10 = ₹2,000"), so its other numbers aren't quantities. */
const LINE_MATHS = /[×*@=₹]|\brs\.?/i;
/** "Nil", "None", "-": nothing short or damaged. */
const NOTHING = /^(?:nil|none|no|na|n\/a|-+|0|कुछ नहीं|नहीं)$/i;

interface ItemLine { name: string; out: number; returned: number | null }

function firstNumber(text: string | undefined): number | null {
  const match = text?.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/**
 * "Chairs – 200 – 195; Shamiana 40×60 – 1" → chairs 200 out and 195 back, shamiana 1 out. The
 * quantity is the number straight after the item name, so a size in the name or a rate after it
 * ("Chairs – 200 × ₹10 = ₹2,000") isn't counted. Null if any line has no quantity.
 */
function parseItems(items: string | undefined): ItemLine[] | null {
  const lines = (items ?? '').split(/[;\n]/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) return null;
  const parsed: ItemLine[] = [];
  for (const line of lines) {
    const [name, ...rest] = line.split(ITEM_SEPARATOR);
    if (!rest.length) {
      // No separator ("Chairs 200"): its last number, unless the line also has rate maths.
      const numbers = line.replace(/,/g, '').match(/\d+(\.\d+)?/g);
      if (!numbers || LINE_MATHS.test(line)) return null;
      parsed.push({ name: line.slice(0, line.search(/\d/)).trim() || line, out: Number(numbers[numbers.length - 1]), returned: null });
      continue;
    }
    const out = firstNumber(rest[0]);
    if (out === null) return null;
    const returned = rest.length > 1 && !LINE_MATHS.test(rest.join(' ')) ? firstNumber(rest[1]) : null;
    parsed.push({ name: name.trim(), out, returned });
  }
  return parsed;
}

const sum = (numbers: number[]) => numbers.reduce((a, b) => a + b, 0);
/** Pieces back across the list, when every line says how many came back. */
const returnedTotal = (lines: ItemLine[] | null) =>
  lines && lines.every(l => l.returned !== null) ? sum(lines.map(l => l.returned ?? 0)) : null;

export const decoratorChallan: DocumentProfile = {
  id: 'decorator-challan',
  title: 'Event Decorator Challans',
  documentName: 'Decorator Challan',
  description: 'Track chairs, tents, and lighting equipment rented out and returned.',
  group: 'shops',
  sheetTab: 'Decorator_Challans',
  sheetTitle: 'DocSync — Event Decorator Challans',
  sampleDocument: { href: '/samples/decorator-challan.jpg', fileName: 'Sample_Decorator_Challan.jpg' },
  duplicateKey: 'challanNumber',
  translations: {
    hi: {
      title: 'डेकोरेटर चालान',
      documentName: 'डेकोरेटर चालान',
      description: 'किराए पर दी और लौटाई गई कुर्सियाँ, टेंट और लाइटें दर्ज करें।',
    },
  },
  extraction: {
    context: 'This is an Indian tent house / event decorator challan (delivery note) for items rented out for a wedding or function, usually a printed carbon-copy pad filled in by hand with labels like "चालान नं.", "नाम", "स्थान", "सामान", "किराया", "एडवांस", "बाकी" and "वापसी". Put every item line into the one "Items" field as "item – qty out – qty returned" separated by semicolons (e.g. "Chairs – 200 – 195; Shamiana 40×60 – 1 – 1"), or just "item – qty out" while nothing has come back, and record the challan date, total pieces out and total returned, delivery and return dates, rent, security deposit, advance and balance. If the return section notes items short, broken or damaged ("कम", "टूटा"), record them in "Items Short/Damaged", and write "Nil" there when it says nil.',
    priorityFields: ['Challan Number', 'Date', 'Customer Name', 'Phone', 'Venue', 'Items', 'Total Pieces', 'Total Returned', 'Delivery Date', 'Return Date', 'Rent', 'Security Deposit', 'Balance', 'Items Short/Damaged'],
  },
  // The values on public/samples/decorator-challan.jpg, so "Try a sample" without an AI key shows what's on it.
  mockFields: [
    { key: 'challanNumber', label: 'Challan Number', value: '1187', confidence: 94, category: 'identity' },
    { key: 'date', label: 'Date', value: '28-10-2026', confidence: 93, category: 'date' },
    { key: 'customerName', label: 'Customer Name', value: 'Suresh Agarwal', confidence: 92, category: 'identity' },
    { key: 'phone', label: 'Phone', value: '98765 41203', confidence: 88, category: 'contact' },
    { key: 'event', label: 'Event', value: 'Shaadi (Wedding)', confidence: 85, category: 'other' },
    { key: 'venue', label: 'Venue', value: 'Shiv Mandir Ground', confidence: 83, category: 'other' },
    { key: 'items', label: 'Items', value: 'Plastic chairs – 200 – 200; Round tables – 20 – 20; Shamiana 40×60 – 1 – 1; Halogen lights – 12 – 12; Pedestal fans – 6 – 6', confidence: 81, category: 'other' },
    { key: 'totalPieces', label: 'Total Pieces', value: '239', confidence: 86, category: 'other' },
    { key: 'totalReturned', label: 'Total Returned', value: '239', confidence: 85, category: 'other' },
    { key: 'deliveryDate', label: 'Delivery Date', value: '28-10-2026', confidence: 93, category: 'date' },
    { key: 'returnDate', label: 'Return Date', value: '30-10-2026', confidence: 90, category: 'date' },
    { key: 'rent', label: 'Rent', value: '₹18,500', confidence: 95, category: 'financial' },
    { key: 'securityDeposit', label: 'Security Deposit', value: '₹5,000', confidence: 91, category: 'financial' },
    { key: 'advance', label: 'Advance', value: '₹8,000', confidence: 94, category: 'financial' },
    { key: 'balance', label: 'Balance', value: '₹10,500', confidence: 92, category: 'financial' },
    { key: 'itemsShortDamaged', label: 'Items Short/Damaged', value: 'Nil', confidence: 88, category: 'other' },
  ],
  notion: {
    titleFrom: ['customerName', 'customer', 'partyName', 'name'],
    dateFrom: ['date', 'challanDate', 'deliveryDate'],
    properties: [
      { name: 'Amount', type: 'number', from: RENT },
      { name: 'Quantity', type: 'number', from: TOTAL_PIECES },
      { name: 'Phone', type: 'rich_text', from: PHONE },
    ],
  },
  derive(fields) {
    const added: RecordField[] = [];
    const lines = parseItems(fieldValue(fields, ITEMS));
    if (lines && !findField(fields, TOTAL_PIECES)) {
      added.push({ key: 'totalPieces', label: 'Total Pieces', value: String(sum(lines.map(l => l.out))), confidence: 100, category: 'other' });
    }
    const back = returnedTotal(lines);
    if (back !== null && !findField(fields, TOTAL_RETURNED)) {
      added.push({ key: 'totalReturned', label: 'Total Returned', value: String(back), confidence: 100, category: 'other' });
    }
    if (!findField(fields, BALANCE)) {
      const rent = amountValue(fieldValue(fields, RENT));
      const advance = amountValue(fieldValue(fields, ADVANCE));
      if (rent !== null && advance !== null) {
        added.push({ key: 'balance', label: 'Balance', value: derivedRupees(rent - advance), confidence: 100, category: 'financial' });
      }
    }
    return added.length ? [...fields, ...added] : fields;
  },
  validate(fields) {
    const warnings: RuleWarning[] = [];
    const deliveryText = fieldValue(fields, DELIVERY);
    const returnText = fieldValue(fields, RETURN);
    const delivered = parseIndianDate(deliveryText)?.time ?? null;
    const returned = parseIndianDate(returnText)?.time ?? null;
    if (delivered !== null && returned !== null && returned < delivered) {
      warnings.push({ code: 'decorator.dates', field: fieldKey(fields, RETURN), params: { returned: returnText ?? '', delivered: deliveryText ?? '' } });
    }

    const rent = amountValue(fieldValue(fields, RENT));
    const advance = amountValue(fieldValue(fields, ADVANCE));
    // Paid ahead is a negative balance ("-₹200", "₹200 advance").
    const balance = signedAmount(fieldValue(fields, BALANCE));
    if (rent !== null && advance !== null && balance !== null && Math.abs(rent - advance - balance) > 1) {
      warnings.push({
        code: 'decorator.balance',
        field: fieldKey(fields, BALANCE),
        params: { balance: rupees(balance), rent: rupees(rent), advance: rupees(advance), expected: rupees(rent - advance) },
      });
    }

    const lines = parseItems(fieldValue(fields, ITEMS));
    const pieces = parseNumber(fieldValue(fields, TOTAL_PIECES));
    const counted = lines && sum(lines.map(l => l.out));
    if (pieces !== null && counted !== null && pieces !== counted) {
      warnings.push({ code: 'decorator.pieces', field: fieldKey(fields, TOTAL_PIECES), params: { pieces, counted } });
    }
    const back = parseNumber(fieldValue(fields, TOTAL_RETURNED));
    const countedBack = returnedTotal(lines);
    if (back !== null && countedBack !== null && back !== countedBack) {
      warnings.push({ code: 'decorator.returned', field: fieldKey(fields, TOTAL_RETURNED), params: { returned: back, counted: countedBack } });
    }

    // What went out should come back, or be written down as short or damaged.
    const short = fieldValue(fields, SHORT);
    if (!short || NOTHING.test(short)) {
      const missing = (lines ?? []).filter(l => l.returned !== null && l.returned < l.out);
      if (missing.length) {
        const items = missing.map(l => `${l.out - (l.returned ?? 0)} ${l.name}`).join(', ');
        warnings.push({ code: 'decorator.missingItems', field: fieldKey(fields, ITEMS), params: { items } });
      } else if (countedBack === null && pieces !== null && back !== null && back < pieces) {
        warnings.push({ code: 'decorator.missingPieces', field: fieldKey(fields, TOTAL_RETURNED), params: { missing: pieces - back, pieces } });
      }
    }

    const phone = fieldValue(fields, PHONE)?.replace(/[\s-]/g, '');
    if (phone && !isMobileNumber(phone)) {
      warnings.push({ code: 'phone', field: fieldKey(fields, PHONE), params: { phone } });
    }
    return warnings;
  },
};

import { parseNumber } from '@/core/text';
import { isMobileNumber, rupees } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField } from './types';

const PHONE = ['phone', 'phoneNumber', 'mobile', 'mobileNumber', 'contactNumber'];
const ITEMS = ['items', 'itemsOut', 'itemsIssued', 'saman'];
const TOTAL_PIECES = ['totalPieces', 'totalItems', 'totalQty', 'totalQuantity'];
const DELIVERY = ['deliveryDate', 'issueDate', 'dateOut'];
const RETURN = ['returnDate', 'dateReturned', 'dateIn'];
const RENT = ['rent', 'totalRent', 'rentAmount', 'kiraya'];
const ADVANCE = ['advance', 'advancePaid', 'advanceAmount'];
const BALANCE = ['balance', 'balanceDue', 'baki', 'balanceAmount'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "28-10-2026", "28/10/26", "28-Oct-2026" or "2026-10-28" → UTC timestamp; null when unreadable. */
function parseDate(value: string | undefined): number | null {
  if (!value) return null;
  const iso = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dmy = value.match(/^(\d{1,2})[-/. ]+(\d{1,2}|[A-Za-z]{3,})[-/., ]+(\d{2}|\d{4})\b/);
  if (!dmy) return null;
  const month = /\d/.test(dmy[2]) ? Number(dmy[2]) : MONTHS.indexOf(dmy[2].slice(0, 3).toLowerCase()) + 1;
  if (month < 1 || month > 12) return null;
  const year = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
  return Date.UTC(year, month - 1, Number(dmy[1]));
}

/** "Chairs – 200; Round tables – 20" → 220: the last number of each line; null if a line has none. */
function countPieces(items: string | undefined): number | null {
  if (!items) return null;
  const lines = items.split(/[;\n]/).map(s => s.trim()).filter(Boolean);
  let total = 0;
  for (const line of lines) {
    const numbers = line.replace(/,/g, '').match(/\d+(\.\d+)?/g);
    if (!numbers) return null;
    total += Number(numbers[numbers.length - 1]);
  }
  return lines.length ? total : null;
}

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
    context: 'This is an Indian tent house / event decorator challan (delivery note) for items rented out for a wedding or function, usually a printed carbon-copy pad filled in by hand with labels like "चालान नं.", "नाम", "स्थान", "सामान", "किराया", "एडवांस", "बाकी" and "वापसी". Put every item line into the one "Items" field as "item – qty" separated by semicolons (e.g. "Chairs – 200; Shamiana 40×60 – 1"), and record the total pieces, delivery and return dates, rent, security deposit, advance and balance. If the return section notes items short, broken or damaged ("कम", "टूटा"), record them in "Items Short/Damaged".',
    priorityFields: ['Challan Number', 'Customer Name', 'Phone', 'Venue', 'Items', 'Total Pieces', 'Delivery Date', 'Return Date', 'Rent', 'Balance'],
  },
  mockFields: [
    { key: 'challanNumber', label: 'Challan Number', value: '1187', confidence: 94, category: 'identity' },
    { key: 'customerName', label: 'Customer Name', value: 'Suresh Agarwal', confidence: 92, category: 'identity' },
    { key: 'phone', label: 'Phone', value: '98765 41203', confidence: 88, category: 'contact' },
    { key: 'event', label: 'Event', value: 'Shaadi (Wedding)', confidence: 85, category: 'other' },
    { key: 'venue', label: 'Venue', value: 'Shiv Mandir Ground', confidence: 83, category: 'other' },
    { key: 'items', label: 'Items', value: 'Plastic chairs – 200; Round tables – 20; Shamiana 40×60 – 1; Halogen lights – 12; Pedestal fans – 6', confidence: 81, category: 'other' },
    { key: 'totalPieces', label: 'Total Pieces', value: '239', confidence: 86, category: 'other' },
    { key: 'deliveryDate', label: 'Delivery Date', value: '28-10-2026', confidence: 93, category: 'date' },
    { key: 'returnDate', label: 'Return Date', value: '30-10-2026', confidence: 90, category: 'date' },
    { key: 'rent', label: 'Rent', value: '₹18,500', confidence: 95, category: 'financial' },
    { key: 'advance', label: 'Advance', value: '₹8,000', confidence: 94, category: 'financial' },
    { key: 'balance', label: 'Balance', value: '₹10,500', confidence: 92, category: 'financial' },
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
    if (!findField(fields, TOTAL_PIECES)) {
      const pieces = countPieces(fieldValue(fields, ITEMS));
      if (pieces !== null) added.push({ key: 'totalPieces', label: 'Total Pieces', value: String(pieces), confidence: 100, category: 'other' });
    }
    if (!findField(fields, BALANCE)) {
      const rent = parseNumber(fieldValue(fields, RENT));
      const advance = parseNumber(fieldValue(fields, ADVANCE));
      if (rent !== null && advance !== null) {
        added.push({ key: 'balance', label: 'Balance', value: String(rent - advance), confidence: 100, category: 'financial' });
      }
    }
    return added.length ? [...fields, ...added] : fields;
  },
  validate(fields) {
    const warnings: string[] = [];
    const deliveryText = fieldValue(fields, DELIVERY);
    const returnText = fieldValue(fields, RETURN);
    const delivered = parseDate(deliveryText);
    const returned = parseDate(returnText);
    if (delivered !== null && returned !== null && returned < delivered) {
      warnings.push(`Return date (${returnText}) is before the delivery date (${deliveryText}). Please check both dates.`);
    }

    const rent = parseNumber(fieldValue(fields, RENT));
    const advance = parseNumber(fieldValue(fields, ADVANCE));
    const balance = parseNumber(fieldValue(fields, BALANCE));
    if (rent !== null && advance !== null && balance !== null && Math.abs(rent - advance - balance) > 1) {
      warnings.push(`Balance (${rupees(balance)}) doesn't equal rent − advance (${rupees(rent)} − ${rupees(advance)} = ${rupees(rent - advance)}).`);
    }

    const pieces = parseNumber(fieldValue(fields, TOTAL_PIECES));
    const counted = countPieces(fieldValue(fields, ITEMS));
    if (pieces !== null && counted !== null && pieces !== counted) {
      warnings.push(`Total pieces (${pieces}) doesn't match the item list, which adds up to ${counted}. Please recount.`);
    }

    const phone = fieldValue(fields, PHONE)?.replace(/[\s-]/g, '');
    if (phone && !isMobileNumber(phone)) {
      warnings.push(`Phone "${phone}" doesn't look like a 10-digit Indian mobile number. Please check it.`);
    }
    return warnings;
  },
};

import { parseNumber } from '@/core/text';
import { isMobileNumber, rupees } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField } from './types';

const ITEMS = ['items', 'itemDetails', 'lineItems', 'materials'];
const ITEM_COUNT = ['itemCount', 'numberOfItems', 'items count'];
const TOTAL = ['total', 'totalAmount', 'billTotal', 'grandTotal'];
const PAID = ['paid', 'amountPaid', 'advance', 'jama', 'received'];
const BALANCE = ['balance', 'balanceDue', 'due', 'baki', 'remaining'];
const PHONE = ['supplierPhone', 'phone', 'mobile', 'phoneNumber', 'contact'];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One entry per item: the Items text is "item – qty unit × rate = amount; …". */
const itemEntries = (fields: RecordField[]) => (fieldValue(fields, ITEMS) ?? '').split(/[;\n]+/).map(s => s.trim()).filter(Boolean);

const NUMBER = String.raw`(\d[\d,]*(?:\.\d+)?)`;
/** "40 kg × ₹32", "3 doz x 60", "12 pkt @ Rs 45": quantity and rate. */
const QTY_RATE = new RegExp(String.raw`${NUMBER}\s*[a-zA-Zऀ-ॿ.]*\s*[×xX*@]\s*(?:₹|rs\.?)?\s*${NUMBER}`, 'i');
const AFTER_EQUALS = new RegExp(String.raw`=\s*(?:₹|rs\.?)?\s*${NUMBER}[^=]*$`, 'i');

interface ItemMath { name: string; written: number | null; computed: number | null }

function itemMath(entry: string): ItemMath {
  const written = entry.match(AFTER_EQUALS);
  const qtyRate = entry.match(QTY_RATE);
  return {
    name: entry.split(/\s[–—-]\s|[:,]/)[0].trim(),
    written: written ? parseNumber(written[1]) : null,
    computed: qtyRate ? round2(Number(qtyRate[1].replace(/,/g, '')) * Number(qtyRate[2].replace(/,/g, ''))) : null,
  };
}

/** Sum of the item amounts, or null unless every entry has a readable amount. */
function itemsSum(entries: string[]): number | null {
  if (!entries.length) return null;
  let sum = 0;
  for (const entry of entries) {
    const { written, computed } = itemMath(entry);
    const amount = written ?? computed;
    if (amount === null) return null;
    sum += amount;
  }
  return round2(sum);
}

export const catererMaterialBill: DocumentProfile = {
  id: 'caterer-material-bill',
  title: 'Caterer Raw Material Bills',
  documentName: 'Caterer Raw Material Bill',
  description: 'Parse handwritten sabzi mandi and wholesale grocery bills, with paid and balance amounts per function.',
  group: 'farm',
  sheetTab: 'Caterer_Bills',
  sheetTitle: 'DocSync — Caterer Raw Material Bills',
  sampleDocument: { href: '/samples/caterer-material-bill.jpg', fileName: 'Sample_Caterer_Material_Bill.jpg' },
  translations: {
    hi: {
      title: 'कैटरर कच्चा माल बिल',
      documentName: 'कच्चे माल का बिल',
      description: 'सब्ज़ी मंडी और थोक किराना के हाथ से लिखे बिल पढ़ें, हर फ़ंक्शन का जमा और बाकी पैसा भी।',
    },
  },
  extraction: {
    context: 'This is a handwritten Indian sabzi mandi or wholesale grocery bill (kachcha bill) bought by a caterer for a function, often on a small printed pad with labels like "माल", "नग", "किलो", "भाव", "रकम", "कुल", "जमा" and "बाकी", and the function or party name written at the top. Typical fields: bill number (if any), date, supplier name and phone, function/event name, the item lines, number of items, total, amount paid and balance. Put all item lines in ONE field "Items", one item per entry separated by "; ", each as "item – qty unit × rate = amount".',
    priorityFields: ['Date', 'Supplier Name', 'Function / Event', 'Items', 'Item Count', 'Total', 'Paid', 'Balance'],
  },
  mockFields: [
    { key: 'billNumber', label: 'Bill Number', value: '318', confidence: 80, category: 'identity' },
    { key: 'date', label: 'Date', value: '20-10-2026', confidence: 93, category: 'date' },
    { key: 'supplierName', label: 'Supplier Name', value: 'Shri Balaji Sabzi Bhandar', confidence: 90, category: 'identity' },
    { key: 'supplierPhone', label: 'Supplier Phone', value: '98765 41207', confidence: 86, category: 'contact' },
    { key: 'eventName', label: 'Function / Event', value: 'Sharma Wedding – Sangeet', confidence: 82, category: 'metadata' },
    {
      key: 'items', label: 'Items', confidence: 78, category: 'other',
      value: 'Potato – 50 kg × ₹24 = ₹1,200; Onion – 40 kg × ₹32 = ₹1,280; Tomato – 25 kg × ₹28 = ₹700; Cauliflower – 20 kg × ₹40 = ₹800; Green Peas – 15 kg × ₹60 = ₹900; Coriander – 3 kg × ₹80 = ₹240',
    },
    { key: 'itemCount', label: 'Item Count', value: '6', confidence: 95, category: 'other' },
    { key: 'total', label: 'Total', value: '₹5,120', confidence: 94, category: 'financial' },
    { key: 'paid', label: 'Paid', value: '₹3,000', confidence: 91, category: 'financial' },
    { key: 'balance', label: 'Balance', value: '₹2,120', confidence: 92, category: 'financial' },
  ],
  notion: {
    titleFrom: ['eventName', 'functionName', 'event', 'supplierName'],
    dateFrom: ['date', 'billDate'],
    properties: [
      { name: 'Amount', type: 'number', from: TOTAL },
      { name: 'Party', type: 'rich_text', from: ['supplierName', 'supplier', 'vendorName', 'shopName'] },
      { name: 'Caterer Balance Due', type: 'number', from: BALANCE },
    ],
  },
  derive(fields) {
    let out = fields;
    const entries = itemEntries(out);
    if (!findField(out, ITEM_COUNT) && entries.length) {
      out = [...out, { key: 'itemCount', label: 'Item Count', value: String(entries.length), confidence: 100, category: 'other' }];
    }
    const sum = itemsSum(entries);
    if (!findField(out, TOTAL) && sum !== null) {
      out = [...out, { key: 'total', label: 'Total', value: String(sum), confidence: 100, category: 'financial' }];
    }
    const total = parseNumber(fieldValue(out, TOTAL));
    const paid = parseNumber(fieldValue(out, PAID));
    if (!findField(out, BALANCE) && total !== null && paid !== null) {
      out = [...out, { key: 'balance', label: 'Balance', value: String(round2(total - paid)), confidence: 100, category: 'financial' }];
    }
    return out;
  },
  validate(fields) {
    const warnings: string[] = [];
    const entries = itemEntries(fields);
    const total = parseNumber(fieldValue(fields, TOTAL));
    const paid = parseNumber(fieldValue(fields, PAID));
    const balance = parseNumber(fieldValue(fields, BALANCE));
    const phone = fieldValue(fields, PHONE)?.replace(/\s+/g, '');

    for (const { name, written, computed } of entries.map(itemMath)) {
      if (written !== null && computed !== null && Math.abs(written - computed) > 1) {
        warnings.push(`${name}: quantity × rate is ${rupees(computed)}, but ${rupees(written)} is written. Check this line.`);
      }
    }
    const sum = itemsSum(entries);
    if (sum !== null && total !== null && Math.abs(sum - total) > Math.max(1, total * 0.01)) {
      warnings.push(`Total (${rupees(total)}) doesn't match the sum of the items (${rupees(sum)}). Check for a missed or extra line.`);
    }
    if (total !== null && paid !== null) {
      if (paid > total) {
        warnings.push(`Paid (${rupees(paid)}) is more than the bill total (${rupees(total)}). Please check.`);
      } else if (balance !== null && Math.abs(total - paid - balance) > 1) {
        warnings.push(`Balance (${rupees(balance)}) doesn't equal total − paid (${rupees(total)} − ${rupees(paid)} = ${rupees(round2(total - paid))}).`);
      }
    }
    if (phone && !isMobileNumber(phone)) {
      warnings.push(`Phone "${phone}" doesn't look like a 10-digit Indian mobile number. Please check it.`);
    }
    return warnings;
  },
};

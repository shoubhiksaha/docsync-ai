import { parseNumber } from '@/core/text';
import { gstTotal, isGstin, parseIndianDate, rupees, type IndianDate } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile } from './types';

const SUBTOTAL = ['subtotal', 'subTotal', 'taxableAmount', 'taxableValue'];
const GST = ['gst', 'gstAmount', 'totalGst', 'tax', 'taxAmount'];
const TOTAL = ['total', 'totalAmount', 'grandTotal', 'billTotal', 'netAmount'];
const GSTIN = ['dealerGstin', 'gstin', 'gstNumber', 'gstNo'];
const ITEMS = ['items', 'products', 'itemDetails', 'lineItems'];
const BILL_DATE = ['date', 'billDate', 'invoiceDate'];

const round2 = (n: number) => Math.round(n * 100) / 100;

const pad = (n: number) => String(n).padStart(2, '0');
/** "03-12-2026", or "12/2028" for a month-only expiry. */
const show = (date: IndianDate) => (date.monthOnly ? `${pad(date.m)}/${date.y}` : `${pad(date.d)}-${pad(date.m)}-${date.y}`);

/** The Items text split into one entry per product ("; " or new line between products). */
const itemEntries = (items: string) => items.split(/[;\n]+/).map(s => s.trim()).filter(Boolean);
const productName = (entry: string) => entry.split(/\s[–—-]\s|,/)[0].trim();

function hasBatch(entry: string): boolean {
  const match = entry.match(/(?:\bbatch|\blot\b|\bb\.\s*no|बैच)\s*(?:no\.?|number)?\s*[:#.\-–]?\s*([a-z0-9][a-z0-9/-]*)/i);
  return Boolean(match && !/^(na|n\/a|nil|none|no)$/i.test(match[1]));
}

/** The expiry in an Items entry; a month-only "Exp 08/28" counts as the last day of that month. */
function expiry(entry: string): IndianDate | null {
  const match = entry.match(/(?:\bexp\.?\s*dt|\bexp(?:iry)?(?:\s*date)?|\buse before|एक्सपायरी)\.?\s*[:\-–]?\s*(.+)/i);
  return match ? parseIndianDate(match[1], { monthOnly: true }) : null;
}

export const pesticideBill: DocumentProfile = {
  id: 'pesticide-bill',
  title: 'Agriculture Pesticide Bills',
  documentName: 'Agri Input Bill',
  description: 'Track fertiliser, seed and pesticide purchases with batch, expiry and GST for farm accounts.',
  group: 'farm',
  sheetTab: 'Agri_Input_Bills',
  sheetTitle: 'DocSync — Agriculture Pesticide Bills',
  sampleDocument: { href: '/samples/pesticide-bill.jpg', fileName: 'Sample_Pesticide_Bill.jpg' },
  duplicateKey: 'billNumber',
  translations: {
    hi: {
      title: 'कृषि दवा बिल',
      documentName: 'खाद-बीज-दवा बिल',
      description: 'खेती के हिसाब के लिए खाद, बीज और कीटनाशक की ख़रीद, बैच, एक्सपायरी और GST दर्ज करें।',
    },
  },
  extraction: {
    context: 'This is an Indian agri-input dealer bill (krishi seva kendra) for pesticides, fertilisers and seeds, printed or handwritten, with labels such as "बिल नं.", "दिनांक", "किसान का नाम", "ग्राम", "बैच नं.", "एक्सपायरी", "मात्रा", "दर", "राशि" and "कुल". Typical fields: bill number, date, dealer name, dealer licence number, dealer GSTIN, farmer name and village, the product lines, subtotal, GST and total. Put all product lines in ONE field "Items", one product per entry separated by "; ", each as "product pack – Batch … – Exp … – qty × rate = amount".',
    priorityFields: ['Bill Number', 'Date', 'Dealer Name', 'Dealer Licence No', 'Dealer GSTIN', 'Farmer Name', 'Items', 'Subtotal', 'GST', 'Total'],
  },
  mockFields: [
    { key: 'billNumber', label: 'Bill Number', value: 'KSK/26-27/1184', confidence: 93, category: 'identity' },
    { key: 'date', label: 'Date', value: '12-10-2026', confidence: 96, category: 'date' },
    { key: 'dealerName', label: 'Dealer Name', value: 'Kisan Seva Krishi Kendra', confidence: 94, category: 'identity' },
    { key: 'dealerLicenceNo', label: 'Dealer Licence No', value: 'PL/SGJ/2024/0371', confidence: 82, category: 'identity' },
    { key: 'dealerGstin', label: 'Dealer GSTIN', value: '23AKSPK4521M1Z8', confidence: 88, category: 'identity' },
    { key: 'farmerName', label: 'Farmer Name', value: 'Mohan Lal Patidar', confidence: 90, category: 'identity' },
    { key: 'village', label: 'Village', value: 'Rampur', confidence: 87, category: 'contact' },
    {
      key: 'items', label: 'Items', confidence: 84, category: 'other',
      value: 'Chlorantraniliprole 18.5% SC 150 ml – Batch CT2611 – Exp 08/2028 – 2 × ₹1,450 = ₹2,900; Mancozeb 75% WP 1 kg – Batch MZ0925 – Exp 05/2028 – 2 × ₹520 = ₹1,040; Gram (Chana) Seed 30 kg – Lot GS2609 – Exp 03/2027 – 1 × ₹2,400 = ₹2,400',
    },
    { key: 'subtotal', label: 'Subtotal', value: '₹6,340.00', confidence: 92, category: 'financial' },
    { key: 'gst', label: 'GST', value: '₹709.20', confidence: 90, category: 'financial' },
    { key: 'total', label: 'Total', value: '₹7,049.20', confidence: 97, category: 'financial' },
  ],
  notion: {
    titleFrom: ['dealerName', 'dealer', 'shopName'],
    dateFrom: BILL_DATE,
    properties: [
      { name: 'Amount', type: 'number', from: TOTAL },
      { name: 'Agri Dealer GSTIN', type: 'rich_text', from: GSTIN },
    ],
  },
  derive(fields) {
    if (findField(fields, TOTAL)) return fields;
    const subtotal = parseNumber(fieldValue(fields, SUBTOTAL));
    const gst = gstTotal(fields, GST, subtotal);
    if (subtotal === null || gst == null) return fields;
    return [...fields, { key: 'total', label: 'Total', value: String(round2(subtotal + gst)), confidence: 100, category: 'financial' }];
  },
  validate(fields) {
    const warnings: string[] = [];
    const subtotal = parseNumber(fieldValue(fields, SUBTOTAL));
    const gst = gstTotal(fields, GST, subtotal);
    const total = parseNumber(fieldValue(fields, TOTAL));
    const gstin = fieldValue(fields, GSTIN)?.replace(/\s+/g, '').toUpperCase();

    if (subtotal !== null && gst != null && total !== null && Math.abs(subtotal + gst - total) > 1) {
      warnings.push(`Total (${rupees(total)}) doesn't equal subtotal + GST (${rupees(subtotal)} + ${rupees(gst)} = ${rupees(round2(subtotal + gst))}).`);
    }
    if (gstin && !isGstin(gstin)) {
      warnings.push(`Dealer GSTIN "${gstin}" doesn't match the 15-character GSTIN format (e.g. 23ABCDE1234F1Z5). Please check it.`);
    }

    const entries = itemEntries(fieldValue(fields, ITEMS) ?? '');
    const billDate = parseIndianDate(fieldValue(fields, BILL_DATE));
    if (billDate !== null) {
      const expired = entries.flatMap(entry => {
        const exp = expiry(entry);
        return exp !== null && exp.time < billDate.time ? [`${productName(entry)} (exp ${show(exp)})`] : [];
      });
      if (expired.length) {
        warnings.push(`Expiry is before the bill date (${show(billDate)}) for: ${expired.join(', ')}. Check the expiry, and don't use expired stock.`);
      }
    }
    const noBatch = entries.filter(entry => !hasBatch(entry)).map(productName);
    if (noBatch.length) {
      warnings.push(`No batch number recorded for: ${noBatch.join(', ')}. Dealers normally write the batch and expiry of agrochemicals on the bill; ask for them.`);
    }
    return warnings;
  },
};

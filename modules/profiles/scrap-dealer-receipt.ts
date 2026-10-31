import { parseNumber } from '@/core/text';
import { rupees } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField } from './types';

const ITEMS = ['items', 'itemDetails', 'materials', 'entries'];
const TOTAL_WEIGHT = ['totalWeight', 'totalWeightKg', 'weight', 'netWeight'];
const TOTAL_AMOUNT = ['totalAmount', 'amount', 'total', 'netAmount'];
const SELLER = ['sellerName', 'seller', 'customerName', 'customer', 'party'];

const kg = (n: number) => `${Math.round(n * 1000) / 1000} kg`;
/** Within ₹1 or 1%, whichever is larger. */
const close = (a: number, b: number, abs = 1) => Math.abs(a - b) <= Math.max(abs, Math.abs(b) * 0.01);

interface ScrapItem {
  name: string;
  /** Quantity as written before the "×" (kg, grams converted to kg, or pieces). */
  quantity: number | null;
  /** Weight in kg; null for items counted in pieces or with no quantity. */
  weightKg: number | null;
  rate: number | null;
  amount: number | null;
}

const QTY_RATE = /(\d+(?:\.\d+)?)\s*(kgs?|किलो|gms?|g|grams?|pcs?|nos?|नग)?\s*[×xX*@]\s*(?:₹|rs\.?)?\s*(\d+(?:\.\d+)?)/i;
const LINE_AMOUNT = /=\s*(?:₹|rs\.?)?\s*(\d+(?:\.\d+)?)/i;

/** "Newspaper – 12 kg × ₹14 = ₹168; Copper – 500 g × ₹560 = ₹280" → one entry per item. */
function parseItems(text: string): ScrapItem[] {
  return text
    .replace(/(\d),(?=\d)/g, '$1')
    .split(/[;\n]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(line => {
      const qr = line.match(QTY_RATE);
      const amt = line.match(LINE_AMOUNT);
      const name = line.split(/\s*[–—:-]\s*|\s+\d/)[0].trim() || line;
      const unit = qr?.[2]?.toLowerCase() ?? 'kg';
      const quantity = qr ? Number(qr[1]) : null;
      const counted = /^(pcs?|nos?|नग)$/.test(unit);
      const grams = /^(gms?|g|grams?)$/.test(unit);
      const weightKg = quantity === null || counted ? null : grams ? quantity / 1000 : quantity;
      return {
        name,
        quantity,
        weightKg,
        rate: qr ? Number(qr[3]) : null,
        amount: amt ? Number(amt[1]) : null,
      };
    });
}

/** Weight × rate (rate is per kg, or per piece for counted items); a rate always comes with a quantity. */
function computed(item: ScrapItem): number | null {
  return item.rate === null ? null : (item.weightKg ?? (item.quantity as number)) * item.rate;
}

/** Line value as written, else weight × rate. */
function lineValue(item: ScrapItem): number | null {
  return item.amount ?? computed(item);
}

function sumAll(values: (number | null)[]): number | null {
  if (!values.length || values.some(v => v === null)) return null;
  return (values as number[]).reduce((a, b) => a + b, 0);
}

export const scrapDealerReceipt: DocumentProfile = {
  id: 'scrap-dealer-receipt',
  title: 'Scrap Dealer (Kabadiwala) Receipts',
  documentName: 'Kabadiwala Receipt',
  description: 'Read collection weight receipts and daily rate cards: material, kg, rate per kg and total.',
  group: 'industry',
  sheetTab: 'Scrap_Receipts',
  sheetTitle: 'DocSync — Kabadiwala Receipts',
  sampleDocument: { href: '/samples/scrap-dealer-receipt.jpg', fileName: 'Sample_Kabadiwala_Receipt.jpg' },
  duplicateKey: 'receiptNumber',
  translations: {
    hi: {
      title: 'कबाड़ीवाला भाव और रसीदें',
      documentName: 'कबाड़ी रसीद',
      description: 'कबाड़ की तौल रसीदें और रोज़ के भाव कार्ड पढ़ें: सामान, किलो, भाव और कुल रकम।',
    },
  },
  extraction: {
    context: 'This is an Indian scrap dealer (kabadiwala, कबाड़ी) collection receipt or parchi (पर्ची), usually handwritten, listing materials bought by weight: newspaper (रद्दी/अख़बार), cardboard (गत्ता), iron (लोहा), plastic (प्लास्टिक), copper (तांबा), brass (पीतल), aluminium. Capture receipt/parchi number, date, dealer name, seller/customer name, every line in ONE "Items" field written as "material – weight kg × ₹rate = ₹amount; …" (rate is per kg; use "pcs" for items counted by piece), then total weight (कुल वज़न, kg), total amount (कुल रकम) and payment mode (cash/UPI). For a rate card (भाव), put "material – ₹rate/kg; …" in Items and leave the totals empty.',
    priorityFields: ['Receipt Number', 'Date', 'Dealer Name', 'Seller Name', 'Items', 'Total Weight', 'Total Amount', 'Payment Mode'],
  },
  mockFields: [
    { key: 'receiptNumber', label: 'Receipt Number', value: '0318', confidence: 90, category: 'identity' },
    { key: 'date', label: 'Date', value: '26-10-2026', confidence: 94, category: 'date' },
    { key: 'dealerName', label: 'Dealer Name', value: 'Rampur Kabad Bhandar', confidence: 91, category: 'identity' },
    { key: 'sellerName', label: 'Seller Name', value: 'Meena Verma', confidence: 85, category: 'identity' },
    {
      key: 'items',
      label: 'Items',
      value: 'Newspaper – 12 kg × ₹14 = ₹168; Cardboard – 8 kg × ₹9 = ₹72; Iron – 6.5 kg × ₹28 = ₹182; Plastic – 3 kg × ₹12 = ₹36; Copper wire – 0.5 kg × ₹560 = ₹280',
      confidence: 80,
      category: 'other',
    },
    { key: 'totalWeight', label: 'Total Weight', value: '30 kg', confidence: 92, category: 'other' },
    { key: 'totalAmount', label: 'Total Amount', value: '₹738', confidence: 96, category: 'financial' },
    { key: 'paymentMode', label: 'Payment Mode', value: 'Cash', confidence: 88, category: 'financial' },
  ],
  notion: {
    titleFrom: SELLER,
    dateFrom: ['date', 'receiptDate'],
    properties: [
      { name: 'Amount', type: 'number', from: TOTAL_AMOUNT },
      { name: 'Weight (kg)', type: 'number', from: TOTAL_WEIGHT },
    ],
  },
  derive(fields) {
    const text = fieldValue(fields, ITEMS);
    if (!text) return fields;
    const items = parseItems(text);
    const added: RecordField[] = [];
    const weight = sumAll(items.map(i => i.weightKg));
    const amount = sumAll(items.map(lineValue));
    if (!findField(fields, TOTAL_WEIGHT) && weight !== null) {
      added.push({ key: 'totalWeight', label: 'Total Weight', value: `${Math.round(weight * 1000) / 1000} kg`, confidence: 100, category: 'other' });
    }
    if (!findField(fields, TOTAL_AMOUNT) && amount !== null) {
      added.push({ key: 'totalAmount', label: 'Total Amount', value: String(Math.round(amount * 100) / 100), confidence: 100, category: 'financial' });
    }
    return added.length ? [...fields, ...added] : fields;
  },
  validate(fields) {
    const warnings: string[] = [];
    const text = fieldValue(fields, ITEMS);
    if (!text) return warnings;
    const items = parseItems(text);

    for (const item of items) {
      const expected = computed(item);
      if (item.amount === null || expected === null) continue;
      if (!close(expected, item.amount)) {
        warnings.push(`"${item.name}": ${item.quantity} × ${rupees(item.rate as number)} = ${rupees(expected)}, but ${rupees(item.amount)} is written. Please check the weight or rate.`);
      }
    }

    const totalAmount = parseNumber(fieldValue(fields, TOTAL_AMOUNT));
    const itemsAmount = sumAll(items.map(lineValue));
    if (totalAmount !== null && itemsAmount !== null && !close(itemsAmount, totalAmount)) {
      warnings.push(`Total amount (${rupees(totalAmount)}) doesn't match the items (${rupees(itemsAmount)}). Please check the addition.`);
    }

    const totalWeight = parseNumber(fieldValue(fields, TOTAL_WEIGHT));
    const itemsWeight = sumAll(items.map(i => i.weightKg));
    if (totalWeight !== null && itemsWeight !== null && !close(itemsWeight, totalWeight, 0.1)) {
      warnings.push(`Total weight (${kg(totalWeight)}) doesn't match the items (${kg(itemsWeight)}). Please check the weights.`);
    }
    return warnings;
  },
};

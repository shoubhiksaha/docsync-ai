import { amountValue, rateBasis, rupees, weightKg } from './checks';
import { fieldKey, fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField, RuleWarning } from './types';

const ITEMS = ['items', 'itemDetails', 'materials', 'entries'];
const TOTAL_WEIGHT = ['totalWeight', 'totalWeightKg', 'weight', 'netWeight'];
const TOTAL_AMOUNT = ['totalAmount', 'amount', 'total', 'netAmount'];
const SELLER = ['sellerName', 'seller', 'customerName', 'customer', 'party'];

const kg = (n: number) => `${Math.round(n * 1000) / 1000} kg`;
/** Within ₹1 or 1%, whichever is larger. */
const close = (a: number, b: number, abs = 1) => Math.abs(a - b) <= Math.max(abs, Math.abs(b) * 0.01);

interface ScrapItem {
  name: string;
  /** Quantity as written before the "×" (in its own unit: kg, qtl, g or pieces). */
  quantity: number | null;
  /** Weight in kg; null for items counted in pieces or with no quantity. */
  weightKg: number | null;
  rate: number | null;
  /** kg the rate is for: 1 for a rate per kg (the usual), 100 for "₹2,800/qtl". */
  rateKg: number;
  amount: number | null;
}

const QTY_RATE = /(\d+(?:\.\d+)?)\s*([a-z]+\.?|[ऀ-ॿ]+)?\s*[×xX*@]\s*(?:₹|rs\.?)?\s*(\d+(?:\.\d+)?)/i;
const LINE_AMOUNT = /=\s*(?:₹|rs\.?)?\s*(\d+(?:\.\d+)?)/i;
const COUNTED = /^(?:pcs?|pieces?|nos?|नग|पीस)$/i;

/**
 * "Newspaper – 12 kg × ₹14 = ₹168; Copper – 500 g × ₹560 = ₹280; Iron – 1.5 qtl × ₹2,800 = ₹4,200"
 * → one entry per item. Any weight unit is converted to kg. The rate is per kg unless the line
 * names its basis ("× ₹2,800/qtl"), or the written line amount only works out per the line's unit.
 */
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
      const unit = (qr?.[2] ?? 'kg').replace(/\.$/, '');
      const quantity = qr ? Number(qr[1]) : null;
      const weight = quantity === null || COUNTED.test(unit) ? null : weightKg(`${quantity} ${unit}`, null);
      const rate = qr ? Number(qr[3]) : null;
      const amount = amt ? Number(amt[1]) : null;
      const basis = qr ? rateBasis(line.slice((qr.index ?? 0) + qr[0].length)) : null;
      let rateKg = (basis?.unit ? weightKg(`${basis.per} ${basis.unit}`, null) : null) ?? 1;
      if (!basis && weight !== null && quantity && rate !== null && amount !== null && !close(weight * rate, amount) && close(quantity * rate, amount)) {
        rateKg = weight / quantity;
      }
      return { name, quantity, weightKg: weight, rate, rateKg, amount };
    });
}

/** Weight × rate (rate per `rateKg` kg, or per piece for counted items); a rate always comes with a quantity. */
function computed(item: ScrapItem): number | null {
  if (item.rate === null) return null;
  return item.weightKg === null ? (item.quantity as number) * item.rate : (item.weightKg / item.rateKg) * item.rate;
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
    context: 'This is an Indian scrap dealer (kabadiwala, कबाड़ी) collection receipt or parchi (पर्ची), usually handwritten, listing materials bought by weight: newspaper (रद्दी/अख़बार), cardboard (गत्ता), iron (लोहा), plastic (प्लास्टिक), copper (तांबा), brass (पीतल), aluminium. Capture receipt/parchi number, date, dealer name, seller/customer name, every line in ONE "Items" field written as "material – weight kg × ₹rate = ₹amount; …" (rate is per kg; keep another weight unit as written, e.g. "1.5 qtl × ₹2,800/qtl"; use "pcs" for items counted by piece), then total weight (कुल वज़न, with its unit), total amount (कुल रकम) and payment mode (cash/UPI). For a rate card (भाव), put "material – ₹rate/kg; …" in Items and leave the totals empty.',
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
    const warnings: RuleWarning[] = [];
    const text = fieldValue(fields, ITEMS);
    if (!text) return warnings;
    const items = parseItems(text);

    for (const item of items) {
      const expected = computed(item);
      if (item.amount === null || expected === null) continue;
      if (!close(expected, item.amount)) {
        warnings.push({
          code: 'scrap.line',
          field: fieldKey(fields, ITEMS),
          params: { item: item.name, quantity: item.quantity ?? '', rate: rupees(item.rate as number), expected: rupees(expected), amount: rupees(item.amount) },
        });
      }
    }

    const totalAmount = amountValue(fieldValue(fields, TOTAL_AMOUNT));
    const itemsAmount = sumAll(items.map(lineValue));
    if (totalAmount !== null && itemsAmount !== null && !close(itemsAmount, totalAmount)) {
      warnings.push({ code: 'scrap.total', field: fieldKey(fields, TOTAL_AMOUNT), params: { total: rupees(totalAmount), items: rupees(itemsAmount) } });
    }

    const totalWeight = weightKg(fieldValue(fields, TOTAL_WEIGHT));
    const itemsWeight = sumAll(items.map(i => i.weightKg));
    if (totalWeight !== null && itemsWeight !== null && !close(itemsWeight, totalWeight, 0.1)) {
      warnings.push({ code: 'scrap.weight', field: fieldKey(fields, TOTAL_WEIGHT), params: { total: kg(totalWeight), items: kg(itemsWeight) } });
    }
    return warnings;
  },
};

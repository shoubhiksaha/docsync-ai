import { parseNumber } from '@/core/text';
import { rupees } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile } from './types';

const QUANTITY = ['quantityLitres', 'quantity', 'litres', 'liters', 'milkQuantity', 'qty'];
const RATE = ['ratePerLitre', 'ratePerLiter', 'rate'];
const AMOUNT = ['amount', 'totalAmount', 'value'];
const FAT = ['fatPercent', 'fat', 'fatPercentage'];
const SNF = ['snfPercent', 'snf', 'snfPercentage'];
const MILK_TYPE = ['milkType', 'milk', 'animal', 'cattleType'];

/** Typical fat % ranges by milk type; anything outside is more likely a misread than real milk. */
const FAT_RANGE = { cow: [2.5, 7], buffalo: [4, 12], mixed: [2.5, 12] } as const;
const SNF_RANGE = [7, 10.5] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

function milkKind(value: string | undefined): keyof typeof FAT_RANGE {
  const text = value ?? '';
  const buffalo = /buf|भैंस|bhain|\bB\b/i.test(text);
  const cow = /cow|गाय|\bC\b/i.test(text);
  if (buffalo === cow) return 'mixed';
  return buffalo ? 'buffalo' : 'cow';
}

export const dairyCollectionSlip: DocumentProfile = {
  id: 'dairy-collection-slip',
  title: 'Dairy Collection Slips',
  documentName: 'Dairy Collection Slip',
  description: 'Parse milk quantity, fat %, SNF, rate per litre and amount from local dairy chits.',
  group: 'farm',
  sheetTab: 'Dairy_Slips',
  sheetTitle: 'DocSync — Dairy Collection Slips',
  sampleDocument: { href: '/samples/dairy-collection-slip.jpg', fileName: 'Sample_Dairy_Collection_Slip.jpg' },
  translations: {
    hi: {
      title: 'डेयरी दूध पर्चियाँ',
      documentName: 'डेयरी दूध पर्ची',
      description: 'डेयरी की पर्चियों से दूध की मात्रा, फ़ैट, SNF, प्रति लीटर दर और रकम पढ़ें।',
    },
  },
  extraction: {
    context: 'This is an Indian village dairy or milk co-operative collection slip, often a small thermal printout from the milk testing machine or a handwritten chit, with labels like "सदस्य कोड", "नाम", "पाली" (सुबह/शाम), "गाय/भैंस", "लीटर", "फ़ैट", "SNF", "CLR", "दर" and "राशि". Typical fields: society name, member code, member name, date, shift (morning/evening, often M/E), milk type (cow/buffalo/mixed, often C/B), quantity in litres (sometimes kg), fat %, SNF %, CLR, rate per litre and amount. Record quantity with its unit.',
    priorityFields: ['Member Code', 'Member Name', 'Date', 'Shift', 'Milk Type', 'Quantity (Litres)', 'Fat %', 'SNF %', 'Rate per Litre', 'Amount'],
  },
  mockFields: [
    { key: 'societyName', label: 'Society Name', value: 'Sampleganj Dugdh Utpadak Sahkari Samiti', confidence: 88, category: 'metadata' },
    { key: 'memberCode', label: 'Member Code', value: '0427', confidence: 96, category: 'identity' },
    { key: 'memberName', label: 'Member Name', value: 'Savitri Devi Yadav', confidence: 90, category: 'identity' },
    { key: 'date', label: 'Date', value: '16-10-2026', confidence: 97, category: 'date' },
    { key: 'shift', label: 'Shift', value: 'Morning', confidence: 93, category: 'metadata' },
    { key: 'milkType', label: 'Milk Type', value: 'Buffalo', confidence: 94, category: 'other' },
    { key: 'quantityLitres', label: 'Quantity (Litres)', value: '6.4', confidence: 97, category: 'other' },
    { key: 'fatPercent', label: 'Fat %', value: '6.8', confidence: 95, category: 'other' },
    { key: 'snfPercent', label: 'SNF %', value: '9.0', confidence: 92, category: 'other' },
    { key: 'clr', label: 'CLR', value: '30.5', confidence: 78, category: 'other' },
    { key: 'ratePerLitre', label: 'Rate per Litre', value: '₹47.60', confidence: 95, category: 'financial' },
    { key: 'amount', label: 'Amount', value: '₹304.64', confidence: 98, category: 'financial' },
  ],
  notion: {
    titleFrom: ['memberName', 'name', 'farmerName', 'memberCode'],
    dateFrom: ['date', 'collectionDate'],
    properties: [
      { name: 'Amount', type: 'number', from: AMOUNT },
      { name: 'Quantity', type: 'number', from: QUANTITY },
      { name: 'Fat %', type: 'number', from: FAT },
    ],
  },
  derive(fields) {
    if (findField(fields, AMOUNT)) return fields;
    const quantity = parseNumber(fieldValue(fields, QUANTITY));
    const rate = parseNumber(fieldValue(fields, RATE));
    if (quantity === null || rate === null) return fields;
    return [...fields, { key: 'amount', label: 'Amount', value: String(round2(quantity * rate)), confidence: 100, category: 'financial' }];
  },
  validate(fields) {
    const warnings: string[] = [];
    const quantity = parseNumber(fieldValue(fields, QUANTITY));
    const rate = parseNumber(fieldValue(fields, RATE));
    const amount = parseNumber(fieldValue(fields, AMOUNT));
    const fat = parseNumber(fieldValue(fields, FAT));
    const snf = parseNumber(fieldValue(fields, SNF));

    if (quantity !== null && rate !== null && amount !== null) {
      const expected = round2(quantity * rate);
      if (Math.abs(expected - amount) > Math.max(1, expected * 0.01)) {
        warnings.push(`Amount (${rupees(amount)}) doesn't match quantity × rate (${quantity} L × ${rupees(rate)} = ${rupees(expected)}). Check the litres and the rate.`);
      }
    }
    if (fat !== null) {
      const kind = milkKind(fieldValue(fields, MILK_TYPE));
      const [low, high] = FAT_RANGE[kind];
      if (fat < low || fat > high) {
        warnings.push(`Fat ${fat}% is outside the usual ${low}–${high}% for ${kind} milk. Check the fat reading${kind === 'mixed' ? '' : ' and the milk type'}.`);
      }
    }
    if (snf !== null && (snf < SNF_RANGE[0] || snf > SNF_RANGE[1])) {
      warnings.push(`SNF ${snf}% is outside the usual ${SNF_RANGE[0]}–${SNF_RANGE[1]}%. Check the SNF reading.`);
    }
    return warnings;
  },
};

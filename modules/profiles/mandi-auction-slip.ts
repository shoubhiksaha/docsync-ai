import { parseNumber } from '@/core/text';
import { rupees } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField } from './types';

const WEIGHT = ['weightQuintals', 'weightQtl', 'quintals', 'weight', 'netWeight'];
const RATE = ['ratePerQuintal', 'rate', 'bidPrice', 'bhav', 'price'];
const GROSS = ['grossAmount', 'saleAmount', 'gross', 'amount'];
const DEDUCTIONS = ['totalDeductions', 'deductions', 'deduction', 'kataui', 'katauti'];
const DEDUCTION_PARTS = [
  ['marketFee', 'mandiFee', 'mandiShulk', 'mandiTax'],
  ['commission', 'arhat', 'aadhat', 'commissionAmount'],
  ['labour', 'labourCharges', 'hammali', 'hamali'],
  ['weighing', 'weighingCharges', 'tulai'],
];
const NET = ['netPayable', 'netAmount', 'amountPayable', 'netPayment'];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Weight in quintals; a value written in kg (and not in quintals) is converted. */
function quintals(fields: RecordField[]): number | null {
  const raw = fieldValue(fields, WEIGHT) ?? '';
  const n = parseNumber(raw);
  if (n === null) return null;
  return /kg|किलो/i.test(raw) && !/q(?:uin|n)?ta?l|क्विंटल/i.test(raw) ? n / 100 : n;
}

/** Total deductions as written, else the sum of the itemised ones (null when none are present). */
function deductions(fields: RecordField[]): number | null {
  const total = parseNumber(fieldValue(fields, DEDUCTIONS));
  if (total !== null) return total;
  const parts = DEDUCTION_PARTS.map(aliases => parseNumber(fieldValue(fields, aliases))).filter((n): n is number => n !== null);
  return parts.length ? round2(parts.reduce((a, b) => a + b, 0)) : null;
}

export const mandiAuctionSlip: DocumentProfile = {
  id: 'mandi-auction-slip',
  title: 'Mandi Auction Slips',
  documentName: 'Mandi Auction Slip',
  description: 'Extract crop, farmer name, weight, bid price, deductions and net payable from APMC mandi slips.',
  group: 'farm',
  sheetTab: 'Mandi_Slips',
  sheetTitle: 'DocSync — Mandi Auction Slips',
  sampleDocument: { href: '/samples/mandi-auction-slip.jpg', fileName: 'Sample_Mandi_Auction_Slip.jpg' },
  duplicateKey: 'slipNumber',
  translations: {
    hi: {
      title: 'मंडी नीलामी पर्चियाँ',
      documentName: 'मंडी नीलामी पर्ची',
      description: 'APMC मंडी पर्चियों से फ़सल, किसान का नाम, वज़न, बोली भाव, कटौती और शुद्ध भुगतान निकालें।',
    },
  },
  extraction: {
    context: 'This is an Indian APMC mandi auction or sale slip (J-form / bikri parchi), usually a printed pad filled by hand, often with Hindi labels such as "किसान", "आढ़तिया", "खरीदार", "जिंस", "बोरी", "वज़न (क्विंटल)", "भाव", "मंडी शुल्क", "आढ़त", "हम्माली" and "शुद्ध भुगतान". Typical fields: slip or lot number, date, mandi name, farmer name and village, commission agent (arhtiya), buyer/trader, commodity and variety, number of bags, weight in quintals, rate per quintal, gross amount, deductions (market fee, commission, labour) and net payable to the farmer. Record the weight with its unit and each deduction as its own field when itemised.',
    priorityFields: ['Slip Number', 'Date', 'Farmer Name', 'Commodity', 'Weight (Quintals)', 'Rate per Quintal', 'Gross Amount', 'Total Deductions', 'Net Payable'],
  },
  mockFields: [
    { key: 'slipNumber', label: 'Slip Number', value: 'KUM-26-04718', confidence: 93, category: 'identity' },
    { key: 'date', label: 'Date', value: '14-10-2026', confidence: 95, category: 'date' },
    { key: 'mandiName', label: 'Mandi Name', value: 'Krishi Upaj Mandi Samiti, Sampleganj', confidence: 90, category: 'metadata' },
    { key: 'farmerName', label: 'Farmer Name', value: 'Ramprasad Kushwaha', confidence: 88, category: 'identity' },
    { key: 'commissionAgent', label: 'Commission Agent (Arhtiya)', value: 'Shyam Traders', confidence: 84, category: 'identity' },
    { key: 'buyerName', label: 'Buyer', value: 'Annapurna Agro Processors', confidence: 86, category: 'identity' },
    { key: 'commodity', label: 'Commodity', value: 'Soybean (Yellow)', confidence: 92, category: 'other' },
    { key: 'weightQuintals', label: 'Weight (Quintals)', value: '18.60 qtl', confidence: 94, category: 'other' },
    { key: 'ratePerQuintal', label: 'Rate per Quintal', value: '₹4,850', confidence: 95, category: 'financial' },
    { key: 'grossAmount', label: 'Gross Amount', value: '₹90,210', confidence: 96, category: 'financial' },
    { key: 'totalDeductions', label: 'Total Deductions', value: '₹2,985', confidence: 89, category: 'financial' },
    { key: 'netPayable', label: 'Net Payable', value: '₹87,225', confidence: 97, category: 'financial' },
  ],
  notion: {
    titleFrom: ['farmerName', 'farmer', 'sellerName'],
    dateFrom: ['date', 'auctionDate', 'slipDate'],
    properties: [
      { name: 'Amount', type: 'number', from: NET },
      { name: 'Mandi Weight (qtl)', type: 'number', from: ['weightQuintals', 'weightQtl', 'quintals'] },
      { name: 'Mandi Rate (₹/qtl)', type: 'number', from: ['ratePerQuintal', 'bidPrice'] },
    ],
  },
  derive(fields) {
    let out = fields;
    const weight = quintals(out);
    const rate = parseNumber(fieldValue(out, RATE));
    if (!findField(out, GROSS) && weight !== null && rate !== null) {
      out = [...out, { key: 'grossAmount', label: 'Gross Amount', value: String(round2(weight * rate)), confidence: 100, category: 'financial' }];
    }
    const gross = parseNumber(fieldValue(out, GROSS));
    const cut = deductions(out);
    if (!findField(out, NET) && gross !== null && cut !== null) {
      out = [...out, { key: 'netPayable', label: 'Net Payable', value: String(round2(gross - cut)), confidence: 100, category: 'financial' }];
    }
    return out;
  },
  validate(fields) {
    const warnings: string[] = [];
    const weight = quintals(fields);
    const rate = parseNumber(fieldValue(fields, RATE));
    const gross = parseNumber(fieldValue(fields, GROSS));
    const cut = deductions(fields);
    const net = parseNumber(fieldValue(fields, NET));

    if (weight !== null && rate !== null && gross !== null) {
      const expected = round2(weight * rate);
      if (Math.abs(expected - gross) > Math.max(1, expected * 0.01)) {
        warnings.push(`Gross amount (${rupees(gross)}) doesn't match weight × rate (${weight} qtl × ${rupees(rate)} = ${rupees(expected)}). Check the weight and the bid price.`);
      }
    }
    if (gross !== null && net !== null) {
      if (net > gross) {
        warnings.push(`Net payable (${rupees(net)}) is more than the gross amount (${rupees(gross)}). Please check the slip.`);
      } else if (cut !== null && Math.abs(gross - cut - net) > 1) {
        warnings.push(`Net payable (${rupees(net)}) doesn't equal gross − deductions (${rupees(gross)} − ${rupees(cut)} = ${rupees(round2(gross - cut))}).`);
      }
    }
    return warnings;
  },
};

import { parseNumber } from '@/core/text';
import { amountOrRate, amountValue, derivedRupees, moneyClose, rateBasis, rupees, weightKg } from './checks';
import { fieldKey, fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField, RuleWarning } from './types';

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
/** Bags, crates or boxes, for a rate quoted per bag or per crate. */
const COUNT = ['bags', 'numberOfBags', 'noOfBags', 'bori', 'crates', 'numberOfCrates', 'noOfCrates', 'boxes', 'peti'];

/** No single lot of produce weighs this many quintals, so a bare weight above it is in kg. */
const MAX_LOT_QUINTALS = 500;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Weight in quintals ("18.60 qtl", "1860 kg", "18 क्विंटल 60 किलो" → 18.6). A number without a
 * unit is quintals, unless it is above 500 or only kg makes weight × rate (₹ per quintal) match
 * the written gross: then it is kg (the unit is often only in the column header, and the model may
 * still label the field "Weight (Quintals)"). With `bareKg` (a rate per kg) it is always kg.
 */
function quintals(fields: RecordField[], rate: number | null, gross: number | null, bareKg = false): number | null {
  const text = fieldValue(fields, WEIGHT);
  const kg = weightKg(text, null);
  if (kg !== null) return kg / 100;
  const n = parseNumber(text);
  if (n === null) return null;
  if (bareKg) return n / 100;
  const kgMatches = rate !== null && gross !== null && moneyClose((n / 100) * rate, gross) && !moneyClose(n * rate, gross);
  return n > MAX_LOT_QUINTALS || kgMatches ? n / 100 : n;
}

/**
 * Gross worked out as weight × rate in the rate's basis: per quintal unless the rate or its label
 * names another ("₹24/kg", "₹45,000 per MT"), or bags × rate for a rate per bag or crate. Null when
 * a figure is missing, or the rate is per bag or crate and no count of them is written.
 */
function grossFromRate(fields: RecordField[], gross: number | null): { amount: number; quintals?: number; quantity: string; rate: number; per: string } | null {
  const rateField = findField(fields, RATE);
  const rate = amountValue(rateField?.value);
  if (!rateField || rate === null) return null;
  const basis = rateBasis(rateField.value, rateField.label) ?? { per: 1, unit: 'qtl' };
  const per = [basis.per === 1 ? '' : basis.per.toLocaleString('en-IN'), basis.unit ?? ''].filter(Boolean).join(' ');
  const kgPerBasis = basis.unit === null ? null : weightKg(`1 ${basis.unit}`, null);
  if (kgPerBasis === null) {
    const count = parseNumber(fieldValue(fields, COUNT));
    if (count === null) return null;
    return { amount: round2((count / basis.per) * rate), quantity: String(count), rate, per };
  }
  const basisKg = kgPerBasis * basis.per;
  const weight = quintals(fields, (rate * 100) / basisKg, gross, basisKg < 100);
  if (weight === null) return null;
  const units = (weight * 100) / basisKg;
  return {
    amount: round2(units * rate),
    quintals: basisKg === 100 ? weight : undefined,
    quantity: `${Number((units * basis.per).toFixed(3))} ${basis.unit}`,
    rate,
    per,
  };
}

/**
 * Total deductions as written, else the sum of the itemised ones (null when none are present). A
 * deduction may be a percent of the gross ("1.5%", "2% ₹1,804" → ₹1,804); one that is only a
 * percent with no gross to work it out on makes the total unknown.
 */
function deductions(fields: RecordField[], gross: number | null): number | null {
  const total = amountOrRate(fieldValue(fields, DEDUCTIONS), gross);
  if (total !== null) return total;
  let sum: number | null = null;
  for (const aliases of DEDUCTION_PARTS) {
    const text = fieldValue(fields, aliases);
    const part = amountOrRate(text, gross);
    if (part === null && text?.includes('%')) return null;
    if (part !== null) sum = (sum ?? 0) + part;
  }
  return sum === null ? null : round2(sum);
}

export const mandiAuctionSlip: DocumentProfile = {
  id: 'mandi-auction-slip',
  title: 'Mandi Auction Slips',
  documentName: 'Mandi Auction Slip',
  description: 'Turn each APMC mandi slip into one row: crop, farmer, weight, bid price, deductions and net payable.',
  group: 'farm',
  sheetTab: 'Mandi_Slips',
  sheetTitle: 'DocSync — Mandi Auction Slips',
  sampleDocument: { href: '/samples/mandi-auction-slip.jpg', fileName: 'Sample_Mandi_Auction_Slip.jpg' },
  duplicateKey: 'slipNumber',
  translations: {
    hi: {
      title: 'मंडी नीलामी पर्चियाँ',
      documentName: 'मंडी नीलामी पर्ची',
      description: 'हर APMC मंडी पर्ची से फ़सल, किसान का नाम, वज़न, बोली भाव, कटौती और शुद्ध भुगतान पढ़कर शीट में जोड़ें।',
    },
  },
  extraction: {
    context: 'This is an Indian APMC mandi auction or sale slip (J-form / bikri parchi), usually a printed pad filled by hand, often with Hindi labels such as "किसान", "आढ़तिया", "खरीदार", "जिंस", "बोरी", "वज़न (क्विंटल)", "भाव", "मंडी शुल्क", "आढ़त", "हम्माली" and "शुद्ध भुगतान". Typical fields: slip or lot number, date, mandi name, farmer name and village, commission agent (arhtiya), buyer/trader, commodity and variety, number of bags or crates, weight in quintals, rate (usually per quintal; fruit and vegetable slips often quote per kg, crate or bag), gross amount, deductions (market fee, commission, labour) and net payable to the farmer. Record the weight with its unit, the rate with its basis when it is not per quintal (e.g. "₹24 per kg", "₹450 per crate"), and each deduction as its own field when itemised, as written (a percent such as "1.5%" too).',
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
    const worked = findField(out, GROSS) ? null : grossFromRate(out, null);
    if (worked) {
      out = [...out, { key: 'grossAmount', label: 'Gross Amount', value: derivedRupees(worked.amount), confidence: 100, category: 'financial' }];
    }
    const gross = amountValue(fieldValue(out, GROSS));
    const cut = deductions(out, gross);
    if (!findField(out, NET) && gross !== null && cut !== null) {
      out = [...out, { key: 'netPayable', label: 'Net Payable', value: derivedRupees(round2(gross - cut)), confidence: 100, category: 'financial' }];
    }
    return out;
  },
  validate(fields) {
    const warnings: RuleWarning[] = [];
    const gross = amountValue(fieldValue(fields, GROSS));
    const worked = grossFromRate(fields, gross);
    const cut = deductions(fields, gross);
    const net = amountValue(fieldValue(fields, NET));

    if (worked && gross !== null && Math.abs(worked.amount - gross) > Math.max(1, worked.amount * 0.01)) {
      const sums = { gross: rupees(gross), expected: rupees(worked.amount) };
      warnings.push(worked.quintals !== undefined
        ? { code: 'mandi.gross', field: fieldKey(fields, GROSS), params: { ...sums, weight: worked.quintals, rate: rupees(worked.rate) } }
        : { code: 'mandi.grossPer', field: fieldKey(fields, GROSS), params: { ...sums, quantity: worked.quantity, rate: `${rupees(worked.rate)}/${worked.per}` } });
    }
    if (gross !== null && net !== null) {
      if (net > gross) {
        warnings.push({ code: 'mandi.netOver', field: fieldKey(fields, NET), params: { net: rupees(net), gross: rupees(gross) } });
      } else if (cut !== null && Math.abs(gross - cut - net) > 1) {
        warnings.push({
          code: 'mandi.net',
          field: fieldKey(fields, NET),
          params: { net: rupees(net), gross: rupees(gross), deductions: rupees(cut), expected: rupees(round2(gross - cut)) },
        });
      }
    }
    return warnings;
  },
};

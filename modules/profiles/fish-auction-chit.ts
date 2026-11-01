import { parseNumber } from '@/core/text';
import { rupees, weightKg } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField } from './types';

const WEIGHT = ['weightKg', 'weight', 'netWeight', 'quantityKg'];
const RATE_KG = ['ratePerKg', 'rate', 'pricePerKg', 'bidRate'];
const BASKETS = ['baskets', 'basketCount', 'tubs', 'crates', 'boxes'];
const RATE_BASKET = ['ratePerBasket', 'basketRate', 'ratePerTub', 'ratePerCrate', 'ratePerBox'];
const AMOUNT = ['amount', 'grossAmount', 'saleAmount', 'auctionAmount'];
const COMMISSION = ['commission', 'auctioneerCommission', 'commissionAmount'];
const NET = ['netPayable', 'netAmount', 'amountPayable'];

/** Commission above this share of the sale is far beyond what auction halls usually charge. */
const HIGH_COMMISSION = 0.2;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Sale value from weight × ₹/kg, else baskets × ₹/basket; with a description for warnings. */
function expectedAmount(fields: RecordField[]): { value: number; how: string } | null {
  const weight = weightKg(fieldValue(fields, WEIGHT));
  const rateKg = parseNumber(fieldValue(fields, RATE_KG));
  if (weight !== null && rateKg !== null) {
    return { value: round2(weight * rateKg), how: `${weight} kg × ${rupees(rateKg)}` };
  }
  const baskets = parseNumber(fieldValue(fields, BASKETS));
  const rateBasket = parseNumber(fieldValue(fields, RATE_BASKET));
  if (baskets !== null && rateBasket !== null) {
    return { value: round2(baskets * rateBasket), how: `${baskets} baskets × ${rupees(rateBasket)}` };
  }
  return null;
}

export const fishAuctionChit: DocumentProfile = {
  id: 'fish-auction-chit',
  title: 'Fish Market Auction Chits',
  documentName: 'Fish Auction Chit',
  description: 'Turn each harbour auction chit into one row: boat, catch, weight, rate, commission and net payable.',
  group: 'farm',
  sheetTab: 'Fish_Auction_Chits',
  sheetTitle: 'DocSync — Fish Market Auction Chits',
  sampleDocument: { href: '/samples/fish-auction-chit.jpg', fileName: 'Sample_Fish_Auction_Chit.jpg' },
  duplicateKey: 'chitNumber',
  translations: {
    hi: {
      title: 'मछली बाज़ार नीलामी पर्चियाँ',
      documentName: 'मछली नीलामी पर्ची',
      description: 'हर नीलामी पर्ची से नाव, मछली, वज़न, भाव, कमीशन और शुद्ध भुगतान पढ़कर शीट में जोड़ें।',
    },
  },
  extraction: {
    context: 'This is an Indian fishing harbour or fish market auction chit, a small printed or carbon-copy slip filled by the auctioneer, often in English mixed with a regional language (Hindi "नाव", "मछली", "वज़न", "भाव", "कमीशन"; also Marathi, Gujarati, Malayalam, Tamil or Bengali). Typical fields: chit number, date, harbour or market name, boat name, boat registration number (e.g. IND-MH-…), owner or fisherman, species, weight in kg or number of baskets, rate per kg (or per basket), amount, auctioneer commission and net payable to the boat owner. Use the English species name with the local name in brackets when both are clear.',
    priorityFields: ['Chit Number', 'Date', 'Boat Name', 'Boat Registration No', 'Species', 'Weight (kg)', 'Rate per kg', 'Amount', 'Commission', 'Net Payable'],
  },
  mockFields: [
    { key: 'chitNumber', label: 'Chit Number', value: 'RB-26-0912', confidence: 92, category: 'identity' },
    { key: 'date', label: 'Date', value: '21-10-2026', confidence: 96, category: 'date' },
    { key: 'harbour', label: 'Harbour / Market', value: 'Rampur Bunder Fish Auction Hall', confidence: 88, category: 'metadata' },
    { key: 'boatName', label: 'Boat Name', value: 'Sagar Kanya', confidence: 91, category: 'identity' },
    { key: 'boatRegistrationNo', label: 'Boat Registration No', value: 'IND-MH-09-MM-4521', confidence: 83, category: 'identity' },
    { key: 'ownerName', label: 'Owner', value: 'Suresh Koli', confidence: 89, category: 'identity' },
    { key: 'species', label: 'Species', value: 'Indian Mackerel (Bangda)', confidence: 87, category: 'other' },
    { key: 'weightKg', label: 'Weight (kg)', value: '186 kg', confidence: 95, category: 'other' },
    { key: 'ratePerKg', label: 'Rate per kg', value: '₹210', confidence: 94, category: 'financial' },
    { key: 'amount', label: 'Amount', value: '₹39,060', confidence: 96, category: 'financial' },
    { key: 'commission', label: 'Commission', value: '₹1,953', confidence: 90, category: 'financial' },
    { key: 'netPayable', label: 'Net Payable', value: '₹37,107', confidence: 97, category: 'financial' },
  ],
  notion: {
    titleFrom: ['boatName', 'boat', 'vesselName'],
    dateFrom: ['date', 'auctionDate', 'chitDate'],
    properties: [
      { name: 'Amount', type: 'number', from: NET },
      { name: 'Weight (kg)', type: 'number', from: ['weightKg', 'quantityKg'] },
      { name: 'Fish Species', type: 'rich_text', from: ['species', 'fishType', 'catch'] },
    ],
  },
  derive(fields) {
    let out = fields;
    const expected = expectedAmount(out);
    if (!findField(out, AMOUNT) && expected) {
      out = [...out, { key: 'amount', label: 'Amount', value: String(expected.value), confidence: 100, category: 'financial' }];
    }
    const amount = parseNumber(fieldValue(out, AMOUNT));
    const commission = parseNumber(fieldValue(out, COMMISSION));
    if (!findField(out, NET) && amount !== null && commission !== null) {
      out = [...out, { key: 'netPayable', label: 'Net Payable', value: String(round2(amount - commission)), confidence: 100, category: 'financial' }];
    }
    return out;
  },
  validate(fields) {
    const warnings: string[] = [];
    const expected = expectedAmount(fields);
    const amount = parseNumber(fieldValue(fields, AMOUNT));
    const commission = parseNumber(fieldValue(fields, COMMISSION));
    const net = parseNumber(fieldValue(fields, NET));

    if (expected && amount !== null && Math.abs(expected.value - amount) > Math.max(1, expected.value * 0.01)) {
      warnings.push(`Amount (${rupees(amount)}) doesn't match ${expected.how} = ${rupees(expected.value)}. Check the weight and the bid rate.`);
    }
    if (amount !== null && commission !== null) {
      if (commission > amount * HIGH_COMMISSION) {
        warnings.push(`Commission (${rupees(commission)}) is ${Math.round((commission / amount) * 100)}% of the amount (${rupees(amount)}), unusually high. Please check it.`);
      }
      if (net !== null && Math.abs(amount - commission - net) > 1) {
        warnings.push(`Net payable (${rupees(net)}) doesn't equal amount − commission (${rupees(amount)} − ${rupees(commission)} = ${rupees(round2(amount - commission))}).`);
      }
    }
    return warnings;
  },
};

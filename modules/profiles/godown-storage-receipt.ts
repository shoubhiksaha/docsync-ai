import { parseNumber } from '@/core/text';
import { maskAadhaar, parseIndianDate, rupees, weightKg } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile } from './types';

const DEPOSIT_DATE = ['depositDate', 'dateOfDeposit', 'date', 'receiptDate'];
const VALID_UNTIL = ['validUntil', 'validTill', 'validUpto', 'expiryDate', 'dueDate'];
const BAGS = ['bags', 'noOfBags', 'numberOfBags', 'bagCount', 'bori'];
const WEIGHT = ['weight', 'netWeight', 'quantityWeight', 'totalWeight'];
const WEIGHT_KG = ['weightKg'];
const RATE = ['storageRate', 'rate', 'rent', 'storageRent'];
const PERIOD = ['storagePeriod', 'period', 'months', 'duration'];
const CHARGES = ['storageCharges', 'charges', 'rentAmount', 'totalCharges', 'amount'];

const BAG_KG = { min: 25, max: 100 };

const round2 = (n: number) => Math.round(n * 100) / 100;

type WeightUnit = 'kg' | 'qtl' | 'MT';
const UNIT_KG: Record<WeightUnit, number> = { kg: 1, qtl: 100, MT: 1000 };

/** Unit written next to a weight or in a rate's basis ("62.5 Qtl", "per MT"), or null. */
function weightUnit(text: string): WeightUnit | null {
  if (/(?<![a-z])(?:m\.?t|tonnes?|tons?)(?![a-z])|टन/i.test(text)) return 'MT';
  if (/(?<![a-z])q(?:tls?|uintals?)?(?![a-z])|क्विंटल|कुंतल/i.test(text)) return 'qtl';
  if (/(?<![a-z])kgs?(?![a-z])|किलो/i.test(text)) return 'kg';
  return null;
}

export const godownStorageReceipt: DocumentProfile = {
  id: 'godown-storage-receipt',
  title: 'Godown Storage Receipts',
  documentName: 'Godown Storage Receipt',
  description: 'Turn each godown receipt into one row: farmer, commodity, bags and storage period.',
  group: 'transport',
  sheetTab: 'Godown_Receipts',
  sheetTitle: 'DocSync — Godown Storage Receipts',
  sampleDocument: { href: '/samples/godown-storage-receipt.jpg', fileName: 'Sample_Godown_Receipt.jpg' },
  duplicateKey: 'receiptNumber',
  translations: {
    hi: {
      title: 'गोदाम भंडारण रसीदें',
      documentName: 'गोदाम भंडारण रसीद',
      description: 'हर गोदाम रसीद से किसान का नाम, जिंस, बोरियों की गिनती और भंडारण अवधि पढ़कर शीट में जोड़ें।',
    },
  },
  extraction: {
    context: 'This is an Indian godown / warehouse storage receipt (गोदाम रसीद), usually a printed form filled by hand, with labels like "जमाकर्ता / किसान का नाम", "जिंस", "बोरी", "वज़न (क्विंटल)", "किराया दर", "अवधि", "वैध तिथि". '
      + 'Record the receipt number, date of deposit, warehouse name, WDRA or registration number if printed, depositor/farmer name, commodity, number of bags, weight with its unit (Qtl, MT or kg), storage rate with its basis (e.g. "₹12 per qtl per month" or "₹5 per bag per month"), storage period, storage charges and valid-until date. '
      + 'If an Aadhaar number appears, record only its last 4 digits as "XXXX XXXX 1234".',
    priorityFields: ['Receipt Number', 'Date of Deposit', 'Depositor Name', 'Commodity', 'Bags', 'Weight', 'Storage Rate', 'Storage Period', 'Storage Charges', 'Valid Until'],
  },
  mockFields: [
    { key: 'receiptNumber', label: 'Receipt Number', value: 'GSR/26/0457', confidence: 90, category: 'identity' },
    { key: 'depositDate', label: 'Date of Deposit', value: '15-10-2026', confidence: 94, category: 'date' },
    { key: 'warehouseName', label: 'Warehouse Name', value: 'Kisan Seva Godown, Rampur', confidence: 92, category: 'identity' },
    { key: 'registrationNumber', label: 'WDRA / Registration No.', value: 'WDRA/REG/0042', confidence: 72, category: 'metadata' },
    { key: 'depositorName', label: 'Depositor / Farmer', value: 'Ramesh Yadav', confidence: 86, category: 'identity' },
    { key: 'commodity', label: 'Commodity', value: 'Wheat', confidence: 95, category: 'other' },
    { key: 'bags', label: 'Bags', value: '125', confidence: 93, category: 'other' },
    { key: 'weight', label: 'Weight', value: '62.50 Qtl', confidence: 91, category: 'other' },
    { key: 'storageRate', label: 'Storage Rate', value: '₹12 per qtl per month', confidence: 84, category: 'financial' },
    { key: 'storagePeriod', label: 'Storage Period', value: '6 months', confidence: 88, category: 'other' },
    { key: 'storageCharges', label: 'Storage Charges', value: '₹4,500', confidence: 90, category: 'financial' },
    { key: 'validUntil', label: 'Valid Until', value: '14-04-2027', confidence: 87, category: 'date' },
  ],
  notion: {
    titleFrom: ['depositorName', 'farmerName', 'depositor'],
    dateFrom: ['depositDate', 'dateOfDeposit', 'date'],
    properties: [
      { name: 'Quantity', type: 'number', from: BAGS },
      { name: 'Weight (kg)', type: 'number', from: WEIGHT_KG },
      { name: 'Amount', type: 'number', from: CHARGES },
    ],
  },
  /** Masks Aadhaar numbers and adds the weight in kg when the unit is written. */
  derive(fields) {
    const out = fields.map(maskAadhaar);
    const kg = weightKg(fieldValue(out, WEIGHT), null);
    if (kg === null || findField(out, WEIGHT_KG)) return out;
    return [...out, { key: 'weightKg', label: 'Weight (kg)', value: String(round2(kg)), confidence: 100, category: 'other' }];
  },
  validate(fields) {
    const warnings: string[] = [];
    const depositText = fieldValue(fields, DEPOSIT_DATE);
    const validText = fieldValue(fields, VALID_UNTIL);
    const deposited = parseIndianDate(depositText)?.time ?? null;
    const validUntil = parseIndianDate(validText)?.time ?? null;
    if (deposited !== null && validUntil !== null && validUntil <= deposited) {
      warnings.push(`Valid-until date (${validText}) is not after the deposit date (${depositText}). Please check the dates.`);
    }

    const bags = parseNumber(fieldValue(fields, BAGS));
    const weightText = fieldValue(fields, WEIGHT) ?? '';
    const unit = weightUnit(weightText);
    // In the unit written first, so "62 qtl 50 kg" is 62.5 qtl.
    const kg = unit ? weightKg(weightText, null) : null;
    const weight = unit && kg !== null ? kg / UNIT_KG[unit] : parseNumber(weightText);
    if (bags !== null && bags > 0 && weight !== null) {
      const perBag = (u: WeightUnit) => (weight * UNIT_KG[u]) / bags;
      const plausible = (u: WeightUnit) => perBag(u) >= BAG_KG.min && perBag(u) <= BAG_KG.max;
      if (unit ? !plausible(unit) : !(['kg', 'qtl', 'MT'] as const).some(plausible)) {
        const shown = unit ? `${round2(perBag(unit))} kg per bag` : `${weightText} for ${bags} bags`;
        warnings.push(`Weight looks wrong for the bag count: ${shown} (usually ${BAG_KG.min}–${BAG_KG.max} kg a bag). Please check the bags and weight.`);
      }
    }

    const rateText = fieldValue(fields, RATE) ?? '';
    const rate = parseNumber(rateText);
    const periodText = fieldValue(fields, PERIOD) ?? '';
    const period = parseNumber(periodText);
    const charges = parseNumber(fieldValue(fields, CHARGES));
    if (rate !== null && period !== null && charges !== null && !/season|सीज़न|सीजन|\bday|दिन/i.test(rateText)) {
      const months = /\bdays?\b|दिन/i.test(periodText) ? period / 30 : /\b(?:years?|yrs?)\b|साल|वर्ष/i.test(periodText) ? period * 12 : period;
      const perYear = /year|annum|\bp\.?a\b|वार्षिक|सालाना/i.test(rateText);
      const basis = weightUnit(rateText) ?? unit;
      let quantity: number | null = null;
      let quantityLabel = '';
      if (/bags?|bori|बोरी|कट्टा|katta/i.test(rateText)) {
        [quantity, quantityLabel] = [bags, ' bags'];
      } else if (weight !== null && basis) {
        [quantity, quantityLabel] = [round2((weight * UNIT_KG[unit ?? basis]) / UNIT_KG[basis]), ` ${basis}`];
      } else {
        quantity = weight;
      }
      if (quantity !== null) {
        const billedMonths = perYear ? months / 12 : months;
        const expected = round2(rate * quantity * billedMonths);
        if (Math.abs(expected - charges) > Math.max(1, expected * 0.01)) {
          const monthsText = perYear ? `${round2(months)} months ÷ 12` : `${round2(months)} months`;
          warnings.push(`Storage charges (${rupees(charges)}) don't match rate × quantity × period (${rate} × ${quantity}${quantityLabel} × ${monthsText} = ${rupees(expected)}). Please check.`);
        }
      }
    }
    return warnings;
  },
};

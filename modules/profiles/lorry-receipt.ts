import { parseNumber } from '@/core/text';
import { amountValue, derivedRupees, isGstin, isVehicleNumber, moneyClose, rupees, weightKg } from './checks';
import { fieldKey, fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField, RuleCode, RuleWarning } from './types';

const FREIGHT = ['freight', 'totalFreight', 'freightAmount', 'grandTotal', 'totalAmount', 'amount'];
const VEHICLE = ['vehicleNumber', 'vehicleNo', 'lorryNo', 'truckNo', 'vehicle'];
const EWAY = ['ewayBillNumber', 'ewayBillNo', 'ewayBill', 'ewbNo', 'ewbNumber'];
const INVOICE_VALUE = ['invoiceValue', 'goodsValue', 'declaredValue', 'valueOfGoods', 'invoiceAmount'];
const ACTUAL_WEIGHT = ['actualWeight', 'actualWt', 'weight'];
const CHARGED_WEIGHT = ['chargedWeight', 'chargedWt', 'chargeableWeight'];
/** The freight itself; a grand total may also carry loading or other charges. */
const FREIGHT_ONLY = ['freight', 'totalFreight', 'freightAmount', 'basicFreight'];
const RATE = ['rate', 'freightRate', 'ratePerMt', 'ratePerTon', 'ratePerTonne', 'ratePerQtl', 'ratePerQuintal', 'ratePerKg'];
/** The basis after "per", "/" or "प्रति": "₹3,000 per MT", "3000/Qtl", "Rate per MT". */
const RATE_BASIS = /(?:\bper\b|\/|प्रति)\s*([a-z][a-z.]*|[ऀ-ॿ]+)/i;
const GSTINS: { code: RuleCode; aliases: string[] }[] = [
  { code: 'lorry.consignorGstin', aliases: ['consignorGstin', 'consignorGst', 'consignorGstNo', 'fromGstin'] },
  { code: 'lorry.consigneeGstin', aliases: ['consigneeGstin', 'consigneeGst', 'consigneeGstNo', 'toGstin'] },
];

const EWAY_THRESHOLD = 50000;
/** A label copied in front of the number: "EWB No.", "E-way Bill:", "ई-वे बिल नं." */
const EWAY_LABEL = /^\s*(?:e-?\s?way\s*bill|ewb|ई-?\s?वे\s*बिल)\s*(?:no\.?|number|nos?\.?|नं\.?|नंबर)?\s*[:#.-]?\s*/i;

/**
 * A weight field in kg: as written ("3.2 MT"), else in the unit its label names (a bare "3.2"
 * under "Charged Wt (MT)"), else as `bareKg` kg per number (null: unknown). Null when unreadable.
 */
function weightOf(field: RecordField | undefined, bareKg: number | null = 1): number | null {
  const value = field?.value?.trim();
  if (!field || !value) return null;
  const written = weightKg(value, null);
  if (written !== null) return written;
  const n = parseNumber(value);
  const unit = String(field.label ?? '').match(/[a-z]{2,}|[ऀ-ॿ]+/gi)?.find(word => weightKg(`1 ${word}`, null) !== null);
  if (n !== null && unit) return weightKg(`${n} ${unit}`, null);
  return weightKg(value, bareKg);
}

/**
 * Freight worked out as charged (else actual) weight × a per-weight rate ("₹3,000 per MT" on
 * 3,200 kg = ₹9,600). A weight with no unit anywhere is taken in kg or in the rate's unit,
 * whichever gives the written `freight`. Null when the rate is per bag, per trip or fixed, a
 * figure is missing, or a bare weight fits neither.
 */
function freightFromRate(fields: RecordField[], freight: number | null): { amount: number; weightKg: number; rate: number; unit: string } | null {
  const rateField = findField(fields, RATE);
  const rate = amountValue(rateField?.value);
  if (!rateField || rate === null) return null;
  const basis = [rateField.value, rateField.label].map(t => String(t ?? '').match(RATE_BASIS)?.[1]).find(Boolean);
  const kgPerUnit = basis ? weightKg(`1 ${basis}`, null) : null;
  if (!basis || !kgPerUnit) return null;
  const weightField = [CHARGED_WEIGHT, ACTUAL_WEIGHT].map(aliases => findField(fields, aliases)).find(f => f?.value?.trim());
  let kg = weightOf(weightField, null);
  const bare = parseNumber(weightField?.value);
  if (kg === null && bare !== null && freight !== null) {
    kg = [bare, bare * kgPerUnit].find(w => moneyClose((w / kgPerUnit) * rate, freight)) ?? null;
  }
  if (kg === null) return null;
  return { amount: Math.round((kg / kgPerUnit) * rate * 100) / 100, weightKg: kg, rate, unit: basis };
}

export const lorryReceipt: DocumentProfile = {
  id: 'lorry-receipt',
  title: 'Transport Lorry Receipts (LR)',
  documentName: 'Lorry Receipt (LR)',
  description: 'Turn each lorry receipt (bilty) into one row: consignor, consignee, e-way bill and freight.',
  group: 'transport',
  sheetTab: 'Lorry_Receipts',
  sheetTitle: 'DocSync — Lorry Receipts',
  sampleDocument: { href: '/samples/lorry-receipt.jpg', fileName: 'Sample_Lorry_Receipt.jpg' },
  duplicateKey: 'lrNumber',
  translations: {
    hi: {
      title: 'ट्रांसपोर्ट लॉरी रसीदें (LR)',
      documentName: 'लॉरी रसीद (बिल्टी)',
      description: 'हर बिल्टी से भेजने वाला, पाने वाला, ई-वे बिल नंबर और भाड़ा पढ़कर शीट में जोड़ें।',
    },
  },
  extraction: {
    context: 'This is an Indian transport Lorry Receipt (LR, also called bilty or consignment note), usually a printed carbon-copy form filled by hand, with labels like "बिल्टी नं.", "से" (from), "तक" (to), "भेजने वाला", "पाने वाला", "नग" (packages), "वज़न", "भाड़ा". '
      + 'Record the LR number, date, transporter, from and to stations, consignor and consignee with their GSTINs, vehicle number, number of packages, description of goods, actual and charged weight (keep the unit: kg, Qtl or MT), invoice number, invoice value, e-way bill number, rate with its basis (e.g. "₹3,000 per MT", or per bag or per trip), freight amount and freight terms (Paid, To Pay or To Be Billed).',
    priorityFields: ['LR Number', 'Date', 'From', 'To', 'Consignor', 'Consignee', 'Vehicle Number', 'E-way Bill Number', 'Invoice Value', 'Freight'],
  },
  // The values on public/samples/lorry-receipt.jpg, so "Try a sample" without an AI key shows what's on it.
  mockFields: [
    { key: 'lrNumber', label: 'LR Number', value: '4517', confidence: 91, category: 'identity' },
    { key: 'date', label: 'Date', value: '17-10-2026', confidence: 94, category: 'date' },
    { key: 'fromCity', label: 'From', value: 'Sampleganj', confidence: 90, category: 'other' },
    { key: 'toCity', label: 'To', value: 'Rampur', confidence: 90, category: 'other' },
    { key: 'consignor', label: 'Consignor', value: 'Kalyani Agro Foods, MIDC Sampleganj', confidence: 86, category: 'identity' },
    { key: 'consignorGstin', label: 'Consignor GSTIN', value: '27AAKCK1234M1Z5', confidence: 85, category: 'identity' },
    { key: 'consignee', label: 'Consignee', value: 'Om Sai Traders, Station Road, Rampur', confidence: 84, category: 'identity' },
    { key: 'consigneeGstin', label: 'Consignee GSTIN', value: '24AAGFO5678K1Z2', confidence: 82, category: 'identity' },
    { key: 'vehicleNumber', label: 'Vehicle Number', value: 'GJ 05 BX 3391', confidence: 88, category: 'identity' },
    { key: 'packages', label: 'Packages', value: '120 Bags', confidence: 92, category: 'other' },
    { key: 'goodsDescription', label: 'Description of Goods', value: 'Rice (25 kg bags)', confidence: 90, category: 'other' },
    { key: 'actualWeight', label: 'Actual Weight', value: '3,000 kg', confidence: 89, category: 'other' },
    { key: 'chargedWeight', label: 'Charged Weight', value: '3,200 kg', confidence: 80, category: 'other' },
    { key: 'invoiceNumber', label: 'Invoice Number', value: 'KAF/26-27/0912', confidence: 86, category: 'identity' },
    { key: 'invoiceValue', label: 'Invoice Value', value: '₹2,64,000', confidence: 88, category: 'financial' },
    { key: 'ewayBillNumber', label: 'E-way Bill Number', value: '3612 4578 9012', confidence: 87, category: 'metadata' },
    { key: 'rate', label: 'Rate', value: '₹3,000 per MT', confidence: 84, category: 'financial' },
    { key: 'freight', label: 'Freight', value: '₹9,600', confidence: 93, category: 'financial' },
    { key: 'freightTerms', label: 'Freight Terms', value: 'To Pay', confidence: 90, category: 'other' },
    { key: 'driver', label: 'Driver', value: 'Manoj Kumar', confidence: 83, category: 'identity' },
  ],
  notion: {
    titleFrom: ['consignee', 'consigneeName'],
    dateFrom: ['date', 'lrDate'],
    properties: [
      { name: 'Amount', type: 'number', from: FREIGHT },
      { name: 'Vehicle Number', type: 'rich_text', from: VEHICLE },
      { name: 'E-way Bill', type: 'rich_text', from: EWAY },
    ],
  },
  derive(fields) {
    if (findField(fields, FREIGHT)) return fields;
    const worked = freightFromRate(fields, null);
    if (!worked) return fields;
    return [...fields, { key: 'freight', label: 'Freight', value: derivedRupees(worked.amount), confidence: 100, category: 'financial' }];
  },
  validate(fields) {
    const warnings: RuleWarning[] = [];
    const eway = fieldValue(fields, EWAY);
    const invoiceValue = amountValue(fieldValue(fields, INVOICE_VALUE));
    const vehicle = fieldValue(fields, VEHICLE);
    const actual = weightOf(findField(fields, ACTUAL_WEIGHT));
    const charged = weightOf(findField(fields, CHARGED_WEIGHT));

    if (eway) {
      const digits = eway.replace(EWAY_LABEL, '').replace(/[\s.-]/g, '');
      if (!/^\d{12}$/.test(digits)) {
        warnings.push({ code: 'lorry.ewayDigits', field: fieldKey(fields, EWAY), params: { eway } });
      }
    } else if (invoiceValue !== null && invoiceValue > EWAY_THRESHOLD) {
      warnings.push({ code: 'lorry.ewayMissing', field: fieldKey(fields, INVOICE_VALUE), params: { value: rupees(invoiceValue) } });
    }
    for (const { code, aliases } of GSTINS) {
      const gstin = fieldValue(fields, aliases)?.replace(/\s+/g, '').toUpperCase();
      if (gstin && !isGstin(gstin)) {
        warnings.push({ code, field: fieldKey(fields, aliases), params: { gstin } });
      }
    }
    if (vehicle) {
      if (!isVehicleNumber(vehicle)) {
        warnings.push({ code: 'vehicle', field: fieldKey(fields, VEHICLE), params: { vehicle } });
      }
    }
    if (actual !== null && charged !== null && charged < actual) {
      warnings.push({ code: 'lorry.chargedWeight', field: fieldKey(fields, CHARGED_WEIGHT), params: { charged, actual } });
    }
    const freight = amountValue(fieldValue(fields, FREIGHT_ONLY));
    const worked = freightFromRate(fields, freight);
    if (freight !== null && worked && !moneyClose(freight, worked.amount)) {
      warnings.push({
        code: 'lorry.freight',
        field: fieldKey(fields, FREIGHT_ONLY),
        params: {
          freight: rupees(freight), weight: worked.weightKg.toLocaleString('en-IN'), rate: rupees(worked.rate), unit: worked.unit, expected: rupees(worked.amount),
        },
      });
    }
    return warnings;
  },
};

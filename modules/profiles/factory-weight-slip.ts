import { toAsciiDigits } from '@/core/text';
import { weightKg } from './checks';
import { fieldKey, fieldValue, findField } from './fields';
import type { DocumentProfile, RuleWarning } from './types';

const GROSS = ['grossWeight', 'gross', 'grossWt'];
const TARE = ['tareWeight', 'tare', 'tareWt'];
const NET = ['netWeight', 'net', 'netWt'];

const round2 = (n: number) => Math.round(n * 100) / 100;
/** The unit written after a weight ("24.86 MT" → "MT", "24.86 टन" → "टन"), so a derived weight keeps it. */
const unitOf = (raw: string) => toAsciiDigits(raw).match(/\d\s*([a-z.]+|[ऀ-ॿ]+)\s*$/i)?.[1] ?? '';
const kg = (n: number) => `${n.toLocaleString('en-IN')} kg`;

export const factoryWeightSlip: DocumentProfile = {
  id: 'factory-weight-slip',
  title: 'Weighbridge (Dharam Kanta) Slips',
  documentName: 'Factory Weight-Slip',
  description: 'Turn each weighbridge slip (kachha bill) into one row: vehicle no., gross, tare and net weight, and time.',
  group: 'industry',
  sheetTab: 'Factory_Slips',
  sheetTitle: 'DocSync — Factory Weight Slips',
  sampleDocument: { href: '/samples/factory-weight-slip.jpg', fileName: 'Sample_Factory_Weight_Slip.jpg' },
  duplicateKey: 'slipNumber',
  translations: {
    hi: {
      title: 'धर्मकांटा तौल पर्चियाँ',
      documentName: 'फ़ैक्टरी तौल पर्ची',
      description: 'हर कच्चे बिल से गाड़ी नंबर, कुल, खाली और शुद्ध वज़न और समय पढ़कर शीट में जोड़ें।',
    },
  },
  extraction: {
    context: 'This is an Indian factory or scrap weighbridge slip (kachha bill). Typical fields: slip number, date and time, vehicle number, material, party name, gross weight, tare weight and net weight with units.',
    priorityFields: ['Slip Number', 'Date', 'Vehicle Number', 'Gross Weight', 'Tare Weight', 'Net Weight'],
  },
  // The values on public/samples/factory-weight-slip.jpg, so "Try a sample" without an AI key shows what's on it.
  mockFields: [
    { key: 'slipNumber', label: 'Slip Number', value: 'WB-26-11873', confidence: 92, category: 'identity' },
    { key: 'date', label: 'Date', value: '18-10-2026', confidence: 95, category: 'date' },
    { key: 'vehicleNumber', label: 'Vehicle Number', value: 'MH 14 KQ 7721', confidence: 93, category: 'identity' },
    { key: 'party', label: 'Party', value: 'Kalyani Scrap Traders', confidence: 90, category: 'identity' },
    { key: 'material', label: 'Material', value: 'MS Scrap (HMS 1)', confidence: 88, category: 'other' },
    { key: 'grossWeight', label: 'Gross Weight', value: '24860', confidence: 97, category: 'other' },
    { key: 'tareWeight', label: 'Tare Weight', value: '9340', confidence: 96, category: 'other' },
    { key: 'netWeight', label: 'Net Weight', value: '15520', confidence: 97, category: 'other' },
    { key: 'charges', label: 'Charges', value: '₹150', confidence: 90, category: 'financial' },
  ],
  notion: {
    titleFrom: ['vehicleNumber', 'vehicleNo', 'vehicle'],
    dateFrom: ['date', 'slipDate'],
    properties: [
      { name: 'Gross Weight', type: 'number', from: GROSS },
      { name: 'Tare Weight', type: 'number', from: TARE },
      { name: 'Net Weight', type: 'number', from: NET },
    ],
  },
  // Weights are compared in kg, so "24.86 MT" gross and "9340 kg" tare still add up.
  derive(fields) {
    if (findField(fields, NET)) return fields;
    const grossText = fieldValue(fields, GROSS) ?? '';
    const gross = weightKg(grossText);
    const tare = weightKg(fieldValue(fields, TARE));
    if (gross === null || tare === null) return fields;
    // Net weight in the gross weight's unit: "24.86 MT" − "9340 kg" → "15.52 MT".
    const unit = unitOf(grossText);
    const perUnit = unit ? (weightKg(`1 ${unit}`) ?? 1) : 1;
    const value = `${round2((gross - tare) / perUnit)}${unit ? ` ${unit}` : ''}`;
    return [...fields, { key: 'netWeight', label: 'Net Weight', value, confidence: 100, category: 'other' }];
  },
  validate(fields) {
    const warnings: RuleWarning[] = [];
    const gross = weightKg(fieldValue(fields, GROSS));
    const tare = weightKg(fieldValue(fields, TARE));
    const net = weightKg(fieldValue(fields, NET));

    if (gross !== null && tare !== null) {
      if (tare >= gross) {
        warnings.push({ code: 'factory.tare', field: fieldKey(fields, TARE), params: { tare: kg(tare), gross: kg(gross) } });
      } else if (net !== null && Math.abs(gross - tare - net) > 0.5) {
        warnings.push({ code: 'factory.net', field: fieldKey(fields, NET), params: { net: kg(net), expected: kg(round2(gross - tare)) } });
      }
    }
    return warnings;
  },
};

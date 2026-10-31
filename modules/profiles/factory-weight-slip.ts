import { parseNumber } from '@/core/text';
import { fieldValue, findField } from './fields';
import type { DocumentProfile } from './types';

const GROSS = ['grossWeight', 'gross', 'grossWt'];
const TARE = ['tareWeight', 'tare', 'tareWt'];
const NET = ['netWeight', 'net', 'netWt'];

export const factoryWeightSlip: DocumentProfile = {
  id: 'factory-weight-slip',
  title: 'Factory Scrap Weight-Slips',
  documentName: 'Factory Weight-Slip',
  description: 'Extract vehicle no, gross weight, tare weight, and timestamp from kachha bills.',
  group: 'industry',
  sheetTab: 'Factory_Slips',
  sheetTitle: 'DocSync — Factory Weight Slips',
  sampleDocument: { href: '/samples/factory-weight-slip.jpg', fileName: 'Sample_Factory_Weight_Slip.jpg' },
  duplicateKey: 'slipNumber',
  translations: {
    hi: {
      title: 'फ़ैक्टरी स्क्रैप तौल पर्चियाँ',
      documentName: 'फ़ैक्टरी तौल पर्ची',
      description: 'कच्चे बिलों से गाड़ी नंबर, कुल वज़न, खाली वज़न और समय निकालें।',
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
    { key: 'grossWeight', label: 'Gross Weight', value: '24860', confidence: 97, category: 'financial' },
    { key: 'tareWeight', label: 'Tare Weight', value: '9340', confidence: 96, category: 'financial' },
    { key: 'netWeight', label: 'Net Weight', value: '15520', confidence: 97, category: 'financial' },
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
  derive(fields) {
    if (findField(fields, NET)) return fields;
    const gross = parseNumber(fieldValue(fields, GROSS));
    const tare = parseNumber(fieldValue(fields, TARE));
    if (gross === null || tare === null) return fields;
    return [...fields, { key: 'netWeight', label: 'Net Weight', value: String(gross - tare), confidence: 100, category: 'financial' }];
  },
  validate(fields) {
    const warnings: string[] = [];
    const gross = parseNumber(fieldValue(fields, GROSS));
    const tare = parseNumber(fieldValue(fields, TARE));
    const net = parseNumber(fieldValue(fields, NET));

    if (gross !== null && tare !== null) {
      if (tare >= gross) {
        warnings.push(`Tare weight (${tare}) is not less than gross weight (${gross}). Please check the slip.`);
      } else if (net !== null && Math.abs(gross - tare - net) > 0.5) {
        warnings.push(`Net weight (${net}) doesn't equal gross − tare (${gross - tare}).`);
      }
    }
    return warnings;
  },
};

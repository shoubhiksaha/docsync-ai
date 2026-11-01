import { parseNumber } from '@/core/text';
import { isVehicleNumber, moneyClose, rupees } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile } from './types';

const QUANTITY = ['quantity', 'qty', 'quantityReceived'];
const UNIT = ['unit', 'uom', 'unitOfMeasure'];
const RATE = ['rate', 'ratePerUnit', 'unitRate'];
const AMOUNT = ['amount', 'totalAmount', 'challanAmount', 'value'];
const VEHICLE = ['vehicleNumber', 'vehicleNo', 'vehicle', 'truckNumber'];
const SUPPLIER = ['supplierName', 'supplier', 'vendor', 'party'];
const MATERIAL = ['material', 'materialName', 'item'];

export const constructionMaterialInward: DocumentProfile = {
  id: 'construction-material-inward',
  title: 'Construction Material Inward',
  documentName: 'Material Inward Challan',
  description: 'Add each sand, cement, steel or brick inward challan to your sheet to match site stock.',
  group: 'industry',
  sheetTab: 'Material_Inward',
  sheetTitle: 'DocSync — Material Inward Challans',
  sampleDocument: { href: '/samples/construction-material-inward.jpg', fileName: 'Sample_Material_Inward_Challan.jpg' },
  duplicateKey: 'challanNumber',
  translations: {
    hi: {
      title: 'निर्माण सामग्री आवक',
      documentName: 'माल आवक चालान',
      description: 'साइट के स्टॉक मिलान के लिए रेत, सीमेंट, सरिया और ईंट के आवक चालान पढ़कर शीट में जोड़ें।',
    },
  },
  extraction: {
    context: 'This is an Indian construction-site material inward challan (delivery challan, "चालान", "माल आवक") for sand (रेत/बालू), cement (सीमेंट), steel (सरिया), aggregate (गिट्टी/रोड़ी) or bricks (ईंट) arriving at a site. Capture challan number, date, site, supplier, vehicle (गाड़ी) number, material, quantity (मात्रा), unit (bags, brass, cft, MT, nos), rate (दर), amount (रकम) and who received it (प्राप्तकर्ता). Keep the unit in its own Unit field; if several materials are listed, put them in one "Items" field as "material – qty unit – ₹amount; …" and give the total as Amount.',
    priorityFields: ['Challan Number', 'Date', 'Site', 'Supplier', 'Vehicle Number', 'Material', 'Quantity', 'Unit', 'Rate', 'Amount'],
  },
  mockFields: [
    { key: 'challanNumber', label: 'Challan Number', value: 'SB-0457', confidence: 94, category: 'identity' },
    { key: 'date', label: 'Date', value: '27-10-2026', confidence: 96, category: 'date' },
    { key: 'siteName', label: 'Site', value: 'Green Valley Residency, Sampleganj', confidence: 88, category: 'metadata' },
    { key: 'supplierName', label: 'Supplier', value: 'Shree Balaji Building Material', confidence: 92, category: 'identity' },
    { key: 'vehicleNumber', label: 'Vehicle Number', value: 'MH 14 GU 3382', confidence: 90, category: 'identity' },
    { key: 'material', label: 'Material', value: 'River Sand (Coarse)', confidence: 89, category: 'other' },
    { key: 'quantity', label: 'Quantity', value: '4', confidence: 95, category: 'other' },
    { key: 'unit', label: 'Unit', value: 'Brass', confidence: 93, category: 'other' },
    { key: 'rate', label: 'Rate', value: '₹5,500', confidence: 94, category: 'financial' },
    { key: 'amount', label: 'Amount', value: '₹22,000', confidence: 97, category: 'financial' },
    { key: 'receivedBy', label: 'Received By', value: 'S. Jadhav', confidence: 78, category: 'identity' },
  ],
  notion: {
    titleFrom: MATERIAL,
    dateFrom: ['date', 'challanDate'],
    properties: [
      { name: 'Amount', type: 'number', from: AMOUNT },
      { name: 'Quantity', type: 'number', from: QUANTITY },
      { name: 'Party', type: 'rich_text', from: SUPPLIER },
    ],
  },
  derive(fields) {
    if (findField(fields, AMOUNT)) return fields;
    const quantity = parseNumber(fieldValue(fields, QUANTITY));
    const rate = parseNumber(fieldValue(fields, RATE));
    if (quantity === null || rate === null) return fields;
    const amount = Math.round(quantity * rate * 100) / 100;
    return [...fields, { key: 'amount', label: 'Amount', value: String(amount), confidence: 100, category: 'financial' }];
  },
  validate(fields) {
    const warnings: string[] = [];
    const quantityText = fieldValue(fields, QUANTITY);
    const quantity = parseNumber(quantityText);
    const rate = parseNumber(fieldValue(fields, RATE));
    const amount = parseNumber(fieldValue(fields, AMOUNT));
    const vehicle = fieldValue(fields, VEHICLE);

    if (quantity !== null && quantity <= 0) {
      warnings.push(`Quantity (${quantity}) should be more than zero. Please check the challan.`);
    }
    if (quantity !== null && rate !== null && amount !== null && !moneyClose(quantity * rate, amount)) {
      warnings.push(`Amount (${rupees(amount)}) doesn't match quantity × rate (${quantity} × ${rupees(rate)} = ${rupees(quantity * rate)}). Please check the challan.`);
    }
    if (quantity !== null && !fieldValue(fields, UNIT) && !/[a-z]/i.test(String(quantityText))) {
      warnings.push(`Quantity (${quantity}) has no unit (bags, brass, cft, MT or nos). Please add it so site stock adds up.`);
    }
    if (vehicle) {
      if (!isVehicleNumber(vehicle)) {
        warnings.push(`Vehicle number "${vehicle}" doesn't look like an Indian number plate (e.g. MH 12 AB 1234). Please check it.`);
      }
    }
    return warnings;
  },
};

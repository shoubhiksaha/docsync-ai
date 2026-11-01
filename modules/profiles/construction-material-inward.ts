import { parseNumber } from '@/core/text';
import { amountValue, isVehicleNumber, moneyClose, quantityInRateUnits, rateBasis, rupees } from './checks';
import { fieldKey, fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField, RuleWarning } from './types';

const QUANTITY = ['quantity', 'qty', 'quantityReceived'];
const UNIT = ['unit', 'uom', 'unitOfMeasure'];
const RATE = ['rate', 'ratePerUnit', 'unitRate'];
const AMOUNT = ['amount', 'totalAmount', 'challanAmount', 'value'];
const VEHICLE = ['vehicleNumber', 'vehicleNo', 'vehicle', 'truckNumber'];
const SUPPLIER = ['supplierName', 'supplier', 'vendor', 'party'];
const MATERIAL = ['material', 'materialName', 'item'];

/**
 * Amount worked out as quantity × rate in the rate's basis ("5000 nos" at "₹7,500 per 1000" =
 * ₹37,500; "2.5 MT" at "₹58/kg" = ₹1,45,000), with the sum as shown in a warning. Null when a
 * figure is missing or the quantity's unit doesn't match the basis (bags at "per kg").
 */
function amountFromRate(fields: RecordField[]): { amount: number; quantity: string; rate: string } | null {
  const rateField = findField(fields, RATE);
  const rate = amountValue(rateField?.value);
  const basis = rateBasis(rateField?.value, rateField?.label);
  const units = quantityInRateUnits(fieldValue(fields, QUANTITY), fieldValue(fields, UNIT), basis);
  if (rate === null || units === null) return null;
  const per = basis ? [basis.per === 1 ? '' : basis.per.toLocaleString('en-IN'), basis.unit ?? ''].filter(Boolean).join(' ') : '';
  // In the basis's unit, so "2.5 MT" at "₹58/kg" reads "2500 kg × ₹58/kg".
  const shown = Number((units * (basis?.per ?? 1)).toFixed(3));
  return {
    amount: Math.round(units * rate * 100) / 100,
    quantity: basis?.unit ? `${shown} ${basis.unit}` : String(shown),
    rate: per ? `${rupees(rate)}/${per}` : rupees(rate),
  };
}

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
    context: 'This is an Indian construction-site material inward challan (delivery challan, "चालान", "माल आवक") for sand (रेत/बालू), cement (सीमेंट), steel (सरिया), aggregate (गिट्टी/रोड़ी) or bricks (ईंट) arriving at a site. Capture challan number, date, site, supplier, vehicle (गाड़ी) number, material, quantity (मात्रा), unit (bags, brass, cft, MT, nos), rate (दर) with its basis as written (e.g. "₹5,500 per brass", "₹7,500 per 1000" for bricks, "₹58 per kg" for steel), amount (रकम) and who received it (प्राप्तकर्ता). Keep the unit in its own Unit field; if several materials are listed, put them in one "Items" field as "material – qty unit – ₹amount; …" and give the total as Amount.',
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
    const worked = amountFromRate(fields);
    if (!worked) return fields;
    return [...fields, { key: 'amount', label: 'Amount', value: String(worked.amount), confidence: 100, category: 'financial' }];
  },
  validate(fields) {
    const warnings: RuleWarning[] = [];
    const quantityText = fieldValue(fields, QUANTITY);
    const quantity = parseNumber(quantityText);
    const worked = amountFromRate(fields);
    const amount = amountValue(fieldValue(fields, AMOUNT));
    const vehicle = fieldValue(fields, VEHICLE);

    if (quantity !== null && quantity <= 0) {
      warnings.push({ code: 'construction.quantityZero', field: fieldKey(fields, QUANTITY), params: { quantity } });
    }
    if (worked && amount !== null && !moneyClose(worked.amount, amount)) {
      warnings.push({
        code: 'construction.amount',
        field: fieldKey(fields, AMOUNT),
        params: { amount: rupees(amount), quantity: worked.quantity, rate: worked.rate, expected: rupees(worked.amount) },
      });
    }
    // Any word after the number is a unit, in any script: "50 bags", "50 बोरी", "2 ब्रास".
    if (quantity !== null && !fieldValue(fields, UNIT) && !/\p{L}/u.test(String(quantityText))) {
      warnings.push({ code: 'construction.noUnit', field: fieldKey(fields, QUANTITY), params: { quantity } });
    }
    if (vehicle) {
      if (!isVehicleNumber(vehicle)) {
        warnings.push({ code: 'vehicle', field: fieldKey(fields, VEHICLE), params: { vehicle } });
      }
    }
    return warnings;
  },
};

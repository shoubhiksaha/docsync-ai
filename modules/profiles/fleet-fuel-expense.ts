import { parseNumber } from '@/core/text';
import { isVehicleNumber, rupees } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField } from './types';

const VEHICLE = ['vehicleNumber', 'vehicleNo', 'vehicle', 'gaadiNumber'];
const AMOUNT = ['amount', 'totalAmount', 'amountPaid', 'expenseAmount', 'saleAmount'];
const QUANTITY = ['quantity', 'quantityLitres', 'litres', 'liters', 'volume', 'fuelQuantity'];
const RATE = ['rate', 'ratePerLitre', 'ratePerLiter', 'fuelRate', 'pricePerLitre'];
const FUEL_TYPE = ['fuelType', 'fuel', 'product'];

/** Petrol and diesel as printed on pump slips (HSD = diesel, MS = petrol). */
const PETROL_OR_DIESEL = /petrol|diesel|\bhsd\b|\bms\b|पेट्रोल|डीज़ल|डीजल/i;
const RATE_RANGE = { min: 70, max: 130 };

const round2 = (n: number) => Math.round(n * 100) / 100;

export const fleetFuelExpense: DocumentProfile = {
  id: 'fleet-fuel-expense',
  title: 'Fleet Fuel & Petty Cash',
  documentName: 'Fuel / Expense Slip',
  description: 'Keep fuel slips, toll receipts and driver petty-cash notes together in one expense sheet.',
  group: 'transport',
  sheetTab: 'Fleet_Expenses',
  sheetTitle: 'DocSync — Fleet Fuel & Petty Cash',
  sampleDocument: { href: '/samples/fleet-fuel-expense.jpg', fileName: 'Sample_Fuel_Slip.jpg' },
  duplicateKey: 'billNumber',
  translations: {
    hi: {
      title: 'फ़्लीट ईंधन और छोटा खर्च',
      documentName: 'गाड़ी खर्च पर्ची',
      description: 'ईंधन पर्चियाँ, टोल रसीदें और ड्राइवर के छोटे खर्च के नोट पढ़कर एक ही शीट में जोड़ें।',
    },
  },
  extraction: {
    context: 'This is an Indian vehicle expense document: a printed petrol-pump fuel slip, a toll plaza receipt, or a driver\'s handwritten petty-cash note (labels like "गाड़ी नं.", "ड्राइवर", "डीज़ल", "टोल", "खाना", "मरम्मत", "रकम"). '
      + 'Record the bill/receipt number, date, vehicle number, driver, expense type (Fuel, Toll, Food, Repair or Other), vendor or fuel station, fuel type (HSD means diesel, MS means petrol), quantity in litres, rate per litre, amount, odometer reading and payment mode. '
      + 'Keep numbers exactly as printed; do not compute missing values.',
    priorityFields: ['Bill Number', 'Date', 'Vehicle Number', 'Driver Name', 'Expense Type', 'Fuel Type', 'Quantity (L)', 'Rate per Litre', 'Amount', 'Odometer (km)'],
  },
  mockFields: [
    { key: 'billNumber', label: 'Bill Number', value: '004518', confidence: 90, category: 'identity' },
    { key: 'date', label: 'Date', value: '19-10-2026', confidence: 95, category: 'date' },
    { key: 'vehicleNumber', label: 'Vehicle Number', value: 'MH 12 RT 4508', confidence: 93, category: 'identity' },
    { key: 'driverName', label: 'Driver Name', value: 'Santosh Jadhav', confidence: 78, category: 'identity' },
    { key: 'expenseType', label: 'Expense Type', value: 'Fuel', confidence: 92, category: 'other' },
    { key: 'vendor', label: 'Vendor / Fuel Station', value: 'Sai Krupa Fuels, Sampleganj', confidence: 88, category: 'identity' },
    { key: 'fuelType', label: 'Fuel Type', value: 'Diesel (HSD)', confidence: 94, category: 'other' },
    { key: 'quantity', label: 'Quantity (L)', value: '45.20', confidence: 96, category: 'financial' },
    { key: 'rate', label: 'Rate per Litre', value: '92.45', confidence: 96, category: 'financial' },
    { key: 'amount', label: 'Amount', value: '₹4,178.74', confidence: 98, category: 'financial' },
    { key: 'odometer', label: 'Odometer (km)', value: '84,215', confidence: 75, category: 'metadata' },
    { key: 'paymentMode', label: 'Payment Mode', value: 'Cash', confidence: 85, category: 'financial' },
  ],
  notion: {
    titleFrom: ['vehicleNumber', 'vehicleNo', 'vehicle'],
    dateFrom: ['date', 'billDate', 'receiptDate'],
    properties: [
      { name: 'Vehicle Number', type: 'rich_text', from: VEHICLE },
      { name: 'Amount', type: 'number', from: AMOUNT },
      { name: 'Quantity', type: 'number', from: QUANTITY },
    ],
  },
  /** Fills in the one missing value of quantity × rate = amount (e.g. a ₹2,000 preset sale). */
  derive(fields) {
    const quantity = parseNumber(fieldValue(fields, QUANTITY));
    const rate = parseNumber(fieldValue(fields, RATE));
    const amount = parseNumber(fieldValue(fields, AMOUNT));
    const add = (key: string, label: string, value: number): RecordField[] =>
      [...fields, { key, label, value: String(round2(value)), confidence: 100, category: 'financial' }];

    if (quantity === null && rate !== null && rate > 0 && amount !== null && !findField(fields, QUANTITY)) {
      return add('quantity', 'Quantity (L)', amount / rate);
    }
    if (rate === null && quantity !== null && quantity > 0 && amount !== null && !findField(fields, RATE)) {
      return add('rate', 'Rate per Litre', amount / quantity);
    }
    if (amount === null && quantity !== null && rate !== null && !findField(fields, AMOUNT)) {
      return add('amount', 'Amount', quantity * rate);
    }
    return fields;
  },
  validate(fields) {
    const warnings: string[] = [];
    const vehicle = fieldValue(fields, VEHICLE);
    const quantity = parseNumber(fieldValue(fields, QUANTITY));
    const rate = parseNumber(fieldValue(fields, RATE));
    const amount = parseNumber(fieldValue(fields, AMOUNT));
    const fuelType = fieldValue(fields, FUEL_TYPE);

    if (vehicle && !isVehicleNumber(vehicle)) {
      warnings.push(`Vehicle number "${vehicle}" doesn't look like an Indian registration (e.g. MH 12 AB 1234 or 22 BH 1234 AA). Please check it.`);
    }
    if (quantity !== null && rate !== null && amount !== null) {
      const expected = round2(quantity * rate);
      if (Math.abs(expected - amount) > Math.max(1, amount * 0.01)) {
        warnings.push(`Quantity × rate (${quantity} L × ${rupees(rate)} = ${rupees(expected)}) doesn't match the amount (${rupees(amount)}). Please check the slip.`);
      }
    }
    if (rate !== null && fuelType && PETROL_OR_DIESEL.test(fuelType) && (rate < RATE_RANGE.min || rate > RATE_RANGE.max)) {
      warnings.push(`Rate ${rupees(rate)} per litre is unusual for ${fuelType} (usually ₹${RATE_RANGE.min}–${RATE_RANGE.max}). Please check the rate.`);
    }
    return warnings;
  },
};

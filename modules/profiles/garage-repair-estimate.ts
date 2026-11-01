import { parseNumber } from '@/core/text';
import { isGstin, isMobileNumber, isVehicleNumber, rupees } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile } from './types';

const CUSTOMER = ['customerName', 'customer', 'name', 'ownerName'];
const PHONE = ['phone', 'mobile', 'phoneNumber', 'mobileNumber', 'mobileNo'];
const VEHICLE = ['vehicleNumber', 'vehicleNo', 'vehicle', 'registrationNumber', 'regNo'];
const GSTIN = ['gstin', 'gstNumber', 'gstNo', 'garageGstin'];
const PARTS_TOTAL = ['partsTotal', 'partsAmount', 'totalParts', 'spareParts'];
const LABOUR = ['labourTotal', 'labour', 'labor', 'labourCharges', 'laborCharges', 'labourAmount'];
const GST = ['gst', 'gstAmount', 'tax', 'cgstSgst'];
const GRAND_TOTAL = ['grandTotal', 'totalAmount', 'total', 'estimateTotal', 'netAmount'];

export const garageRepairEstimate: DocumentProfile = {
  id: 'garage-repair-estimate',
  title: 'Garage Repair Estimates',
  documentName: 'Garage Repair Estimate',
  description: "Turn a mechanic's handwritten estimate into one row: vehicle, spare parts, labour, GST and total.",
  group: 'shops',
  sheetTab: 'Garage_Estimates',
  sheetTitle: 'DocSync — Garage Repair Estimates',
  sampleDocument: { href: '/samples/garage-repair-estimate.jpg', fileName: 'Sample_Garage_Repair_Estimate.jpg' },
  duplicateKey: 'estimateNumber',
  translations: {
    hi: {
      title: 'गैराज मरम्मत अनुमान',
      documentName: 'गैराज मरम्मत एस्टिमेट',
      description: 'मिस्त्री के हाथ से लिखे एस्टिमेट से गाड़ी नंबर, पुर्ज़े, मज़दूरी, GST और कुल रकम पढ़कर शीट में जोड़ें।',
    },
  },
  extraction: {
    context: 'This is an Indian motor garage or workshop repair estimate (एस्टिमेट / job card), usually a printed pad filled in by hand. It shows the estimate or job number, date, customer name and phone, vehicle number (e.g. "MH 12 AB 1234" or a BH-series number), make and model, odometer reading in km, a list of spare parts (पार्ट्स / पुर्ज़े) with prices, labour charges (मज़दूरी / लेबर), GST and the garage GSTIN if registered, and the grand total. Put all parts into one "Parts" field as "part – qty – ₹amount" separated by semicolons, and record parts total, labour total, GST amount and grand total as separate fields.',
    priorityFields: ['Estimate Number', 'Date', 'Customer Name', 'Vehicle Number', 'Make Model', 'Odometer', 'Parts', 'Labour Total', 'GST', 'Grand Total'],
  },
  mockFields: [
    { key: 'estimateNumber', label: 'Estimate Number', value: 'EST-1184', confidence: 93, category: 'identity' },
    { key: 'date', label: 'Date', value: '22-10-2026', confidence: 94, category: 'date' },
    { key: 'customerName', label: 'Customer Name', value: 'Vikas Gupta', confidence: 92, category: 'identity' },
    { key: 'phone', label: 'Phone', value: '98765 43318', confidence: 89, category: 'contact' },
    { key: 'vehicleNumber', label: 'Vehicle Number', value: 'UP 32 KX 4471', confidence: 95, category: 'identity' },
    { key: 'makeModel', label: 'Make Model', value: 'Maruti Suzuki Swift VXi', confidence: 87, category: 'other' },
    { key: 'odometer', label: 'Odometer', value: '48,250 km', confidence: 84, category: 'other' },
    {
      key: 'parts',
      label: 'Parts',
      value: 'Brake pads (front) – 1 set – ₹1,450; Engine oil 5W-30 – 3.5 L – ₹1,680; Oil filter – 1 – ₹320; Air filter – 1 – ₹450',
      confidence: 80,
      category: 'other',
    },
    { key: 'partsTotal', label: 'Parts Total', value: '₹3,900', confidence: 93, category: 'financial' },
    { key: 'labourTotal', label: 'Labour Total', value: '₹1,200', confidence: 92, category: 'financial' },
    { key: 'gst', label: 'GST', value: '₹918', confidence: 88, category: 'financial' },
    { key: 'grandTotal', label: 'Grand Total', value: '₹6,018', confidence: 96, category: 'financial' },
  ],
  notion: {
    titleFrom: VEHICLE,
    dateFrom: ['date', 'estimateDate'],
    properties: [
      { name: 'Amount', type: 'number', from: GRAND_TOTAL },
      { name: 'Vehicle Number', type: 'rich_text', from: VEHICLE },
      { name: 'Party', type: 'rich_text', from: CUSTOMER },
    ],
  },
  derive(fields) {
    if (findField(fields, GRAND_TOTAL)) return fields;
    const parts = parseNumber(fieldValue(fields, PARTS_TOTAL));
    const labour = parseNumber(fieldValue(fields, LABOUR));
    if (parts === null || labour === null) return fields;
    const gst = parseNumber(fieldValue(fields, GST)) ?? 0;
    return [...fields, { key: 'grandTotal', label: 'Grand Total', value: String(parts + labour + gst), confidence: 100, category: 'financial' }];
  },
  validate(fields) {
    const warnings: string[] = [];
    const parts = parseNumber(fieldValue(fields, PARTS_TOTAL));
    const labour = parseNumber(fieldValue(fields, LABOUR));
    const total = parseNumber(fieldValue(fields, GRAND_TOTAL));
    if (parts !== null && labour !== null && total !== null) {
      const gst = parseNumber(fieldValue(fields, GST)) ?? 0;
      const expected = parts + labour + gst;
      if (Math.abs(total - expected) > Math.max(1, expected * 0.01)) {
        warnings.push(`Grand total (${rupees(total)}) doesn't equal parts ${rupees(parts)} + labour ${rupees(labour)} + GST ${rupees(gst)} = ${rupees(expected)}. Check the amounts.`);
      }
    }

    const vehicle = fieldValue(fields, VEHICLE);
    if (vehicle && !isVehicleNumber(vehicle)) {
      warnings.push(`Vehicle number "${vehicle}" doesn't look like an Indian number plate (e.g. MH 12 AB 1234 or 22 BH 1234 AA). Please check it.`);
    }

    const gstin = fieldValue(fields, GSTIN)?.replace(/\s+/g, '').toUpperCase();
    if (gstin && !isGstin(gstin)) {
      warnings.push(`GSTIN "${gstin}" doesn't match the 15-character format (e.g. 09ABCDE1234F1Z5). Please check it.`);
    }

    const phone = fieldValue(fields, PHONE);
    if (phone && !isMobileNumber(phone)) {
      warnings.push(`Phone "${phone}" doesn't look like a 10-digit Indian mobile number. Please check it.`);
    }
    return warnings;
  },
};

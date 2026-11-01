import { parseNumber } from '@/core/text';
import { isGstin, isVehicleNumber, rupees, weightKg } from './checks';
import { fieldValue } from './fields';
import type { DocumentProfile } from './types';

const FREIGHT = ['freight', 'totalFreight', 'freightAmount', 'grandTotal', 'totalAmount', 'amount'];
const VEHICLE = ['vehicleNumber', 'vehicleNo', 'lorryNo', 'truckNo', 'vehicle'];
const EWAY = ['ewayBillNumber', 'ewayBillNo', 'ewayBill', 'ewbNo', 'ewbNumber'];
const INVOICE_VALUE = ['invoiceValue', 'goodsValue', 'declaredValue', 'valueOfGoods', 'invoiceAmount'];
const ACTUAL_WEIGHT = ['actualWeight', 'actualWt', 'weight'];
const CHARGED_WEIGHT = ['chargedWeight', 'chargedWt', 'chargeableWeight'];
const GSTINS = [
  { label: 'Consignor', aliases: ['consignorGstin', 'consignorGst', 'consignorGstNo', 'fromGstin'] },
  { label: 'Consignee', aliases: ['consigneeGstin', 'consigneeGst', 'consigneeGstNo', 'toGstin'] },
];

const EWAY_THRESHOLD = 50000;

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
      + 'Record the LR number, date, transporter, from and to stations, consignor and consignee with their GSTINs, vehicle number, number of packages, description of goods, actual and charged weight (keep the unit: kg, Qtl or MT), invoice number, invoice value, e-way bill number, freight amount and freight terms (Paid, To Pay or To Be Billed).',
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
    { key: 'ewayBillNumber', label: 'E-way Bill Number', value: '3612 4578 9012', confidence: 87, category: 'identity' },
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
  validate(fields) {
    const warnings: string[] = [];
    const eway = fieldValue(fields, EWAY);
    const invoiceValue = parseNumber(fieldValue(fields, INVOICE_VALUE));
    const vehicle = fieldValue(fields, VEHICLE);
    const actual = weightKg(fieldValue(fields, ACTUAL_WEIGHT));
    const charged = weightKg(fieldValue(fields, CHARGED_WEIGHT));

    if (eway) {
      const digits = eway.replace(/[\s-]/g, '');
      if (!/^\d{12}$/.test(digits)) {
        warnings.push(`E-way bill number "${eway}" should be exactly 12 digits. Please check it.`);
      }
    } else if (invoiceValue !== null && invoiceValue > EWAY_THRESHOLD) {
      warnings.push(`Invoice value is ${rupees(invoiceValue)} but no e-way bill number was found. Goods above ₹50,000 normally need an e-way bill; please check.`);
    }
    for (const { label, aliases } of GSTINS) {
      const gstin = fieldValue(fields, aliases)?.replace(/\s+/g, '').toUpperCase();
      if (gstin && !isGstin(gstin)) {
        warnings.push(`${label} GSTIN "${gstin}" doesn't match the 15-character format (e.g. 27ABCDE1234F1Z5). Please check it.`);
      }
    }
    if (vehicle) {
      if (!isVehicleNumber(vehicle)) {
        warnings.push(`Vehicle number "${vehicle}" doesn't look like an Indian registration (e.g. MH 12 AB 1234 or 22 BH 1234 AA). Please check it.`);
      }
    }
    if (actual !== null && charged !== null && charged < actual) {
      warnings.push(`Charged weight (${charged} kg) is less than actual weight (${actual} kg). Freight is usually charged on at least the actual weight; please check.`);
    }
    return warnings;
  },
};

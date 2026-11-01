import { parseNumber } from '@/core/text';
import { maskAadhaar } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile } from './types';

const CARD_TYPE = ['cardType', 'rationCardType', 'category', 'cardCategory'];
const MEMBERS = ['members', 'familyMembers', 'units', 'noOfMembers', 'memberCount'];
const RICE = ['riceKg', 'rice', 'chawal'];
const WHEAT = ['wheatKg', 'wheat', 'gehun'];
const TOTAL_GRAIN = ['totalGrainKg', 'totalGrain', 'totalFoodgrainKg'];
const RATION_CARD = ['rationCardNumber', 'rationCardNo', 'cardNumber', 'rcNumber'];

/** PHH: 5 kg per member a month; AAY: 35 kg per card a month (National Food Security Act). */
const PHH_KG_PER_MEMBER = 5;
const AAY_KG_PER_CARD = 35;

/** Card types as written on registers, in English, Hinglish or Hindi. */
const NOT_NFSA = /NPHH|NON[\s-]*PRIORITY|\bAPL\b|सामान्य|अपात्र|गैर[\s-]*प्राथमिक|एपीएल/;
const AAY = /AAY|ANTY?ODAYA|त्योदय|तोदय/;
const PHH = /PHH|PRIORITY|PATRA\s*GR[IA]?H?ASTH|पात्र\s*गृहस्थ|प्राथमिक/;

function cardKind(value: string | undefined): 'AAY' | 'PHH' | null {
  const v = (value ?? '').toUpperCase();
  if (NOT_NFSA.test(v)) return null;
  if (AAY.test(v)) return 'AAY';
  if (PHH.test(v)) return 'PHH';
  return null;
}

export const pdsDistributionLog: DocumentProfile = {
  id: 'pds-distribution-log',
  title: 'Ration Shop (PDS) Distribution Logs',
  documentName: 'Ration Distribution Slip',
  description: "Keep a record of each family's ration card number and the grain given out.",
  group: 'community',
  sheetTab: 'PDS_Distribution',
  sheetTitle: 'DocSync — Ration Shop (PDS) Distribution Logs',
  sampleDocument: { href: '/samples/pds-distribution-log.jpg', fileName: 'Sample_PDS_Distribution_Slip.jpg' },
  duplicateKey: 'transactionNumber',
  translations: {
    hi: {
      title: 'राशन दुकान (PDS) वितरण रजिस्टर',
      documentName: 'राशन वितरण पर्ची',
      description: 'हर परिवार का राशन कार्ड नंबर और बाँटे गए अनाज की मात्रा पढ़कर शीट में जोड़ें।',
    },
  },
  extraction: {
    context: 'This is an Indian fair price shop (ration shop / PDS) distribution record: an ePoS printout or one line of the shop\'s handwritten distribution register, with labels like "उचित मूल्य दुकान", "राशन कार्ड नं.", "मुखिया", "सदस्य/यूनिट", "चावल", "गेहूँ", "चीनी" and "मिट्टी तेल". Record the FPS/shop number, dealer, date, ration card number, card type as written (AAY/अंत्योदय, PHH/पात्र गृहस्थी or the state category), head of family, number of members, rice and wheat in kg, other items (sugar, kerosene, dal) together in one "Other Items" field, amount paid and the transaction/ePoS receipt number; if several families are on one page, put each line into one "Entries" field and the page totals into Rice/Wheat. Never record a full Aadhaar number: if one is printed, write only the last 4 digits as "XXXX XXXX 1234".',
    priorityFields: ['FPS Number', 'Date', 'Ration Card Number', 'Card Type', 'Head of Family', 'Members', 'Rice (kg)', 'Wheat (kg)', 'Transaction Number'],
  },
  mockFields: [
    { key: 'fpsNumber', label: 'FPS Number', value: 'FPS 0417', confidence: 90, category: 'identity' },
    { key: 'dealerName', label: 'Dealer', value: 'Ramprasad Yadav', confidence: 86, category: 'identity' },
    { key: 'date', label: 'Date', value: '08-10-2026', confidence: 95, category: 'date' },
    { key: 'rationCardNumber', label: 'Ration Card Number', value: 'PHH/SG/0417/3321', confidence: 88, category: 'identity' },
    { key: 'cardType', label: 'Card Type', value: 'PHH', confidence: 94, category: 'metadata' },
    { key: 'headOfFamily', label: 'Head of Family', value: 'Shanti Devi', confidence: 92, category: 'identity' },
    { key: 'members', label: 'Members', value: '4', confidence: 93, category: 'other' },
    { key: 'riceKg', label: 'Rice (kg)', value: '12', confidence: 95, category: 'other' },
    { key: 'wheatKg', label: 'Wheat (kg)', value: '8', confidence: 95, category: 'other' },
    { key: 'otherItems', label: 'Other Items', value: 'Sugar – 1 kg', confidence: 84, category: 'other' },
    { key: 'amountPaid', label: 'Amount Paid', value: '₹18', confidence: 89, category: 'financial' },
    { key: 'transactionNumber', label: 'Transaction Number', value: '2610080417-0093', confidence: 87, category: 'identity' },
  ],
  notion: {
    titleFrom: ['headOfFamily', 'beneficiaryName', 'cardHolder', 'name'],
    dateFrom: ['date', 'distributionDate', 'transactionDate'],
    properties: [
      { name: 'Weight (kg)', type: 'number', from: TOTAL_GRAIN },
      { name: 'Ration Card No.', type: 'rich_text', from: RATION_CARD },
      { name: 'Ration Card Type', type: 'select', from: CARD_TYPE },
    ],
  },
  derive(fields) {
    const out = fields.map(maskAadhaar);
    let changed = out.some((f, i) => f !== fields[i]);
    if (!findField(out, TOTAL_GRAIN)) {
      const rice = parseNumber(fieldValue(out, RICE));
      const wheat = parseNumber(fieldValue(out, WHEAT));
      if (rice !== null || wheat !== null) {
        out.push({ key: 'totalGrainKg', label: 'Total Grain (kg)', value: String((rice ?? 0) + (wheat ?? 0)), confidence: 100, category: 'other' });
        changed = true;
      }
    }
    return changed ? out : fields;
  },
  validate(fields) {
    const warnings: string[] = [];
    const kind = cardKind(fieldValue(fields, CARD_TYPE));
    const rice = parseNumber(fieldValue(fields, RICE));
    const wheat = parseNumber(fieldValue(fields, WHEAT));
    if (!kind || (rice === null && wheat === null)) return warnings;
    const grain = (rice ?? 0) + (wheat ?? 0);

    if (kind === 'PHH') {
      const members = parseNumber(fieldValue(fields, MEMBERS));
      if (members !== null && members > 0 && grain > PHH_KG_PER_MEMBER * members) {
        warnings.push(`PHH cards normally get up to ${PHH_KG_PER_MEMBER} kg of grain per member a month (${members} members → ${PHH_KG_PER_MEMBER * members} kg), but rice + wheat here is ${grain} kg. Check the quantities, or note if two months were given together.`);
      }
    } else if (grain > AAY_KG_PER_CARD) {
      warnings.push(`AAY cards normally get up to ${AAY_KG_PER_CARD} kg of grain per card a month, but rice + wheat here is ${grain} kg. Check the quantities, or note if two months were given together.`);
    }
    return warnings;
  },
};

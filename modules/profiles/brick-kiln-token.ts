import { parseNumber } from '@/core/text';
import { amountValue, isVehicleNumber, moneyClose, rupees } from './checks';
import { fieldKey, fieldValue, findField } from './fields';
import type { DocumentProfile, RuleWarning } from './types';

const COUNT = ['brickCount', 'bricks', 'count', 'quantity', 'numberOfBricks'];
const RATE = ['ratePerThousand', 'ratePer1000', 'rate'];
const AMOUNT = ['amount', 'totalAmount', 'wages', 'payment'];
const STAGE = ['stage', 'work', 'workType'];
const VEHICLE = ['vehicleNumber', 'vehicleNo', 'vehicle', 'tractorNumber', 'truckNumber'];
const WORKER = ['workerName', 'worker', 'pathera', 'team', 'name'];

const DISPATCH = /dispatch|load|nikasi|nikaasi|sale|लदान|लोडिंग|निकासी|बिक्री/i;
/** More than this on one daily token is almost always a misread or an extra zero. */
const MAX_BRICKS_PER_TOKEN = 50000;

const bricks = (n: number) => n.toLocaleString('en-IN');

/** Brick count as a full number: "3,000" → 3000, and counts in thousands ("3 हज़ार", "3.5K", "4 thousand") × 1,000. */
function brickCount(text: string | undefined): number | null {
  const n = parseNumber(text);
  if (n === null || Math.abs(n) >= 1000) return n;
  return /\d\s*k\b|thousand|ha+za+r|ha+ja+r|हज़ार|हजार/i.test(text ?? '') ? Math.round(n * 1000) : n;
}

export const brickKilnToken: DocumentProfile = {
  id: 'brick-kiln-token',
  title: 'Brick Kiln Token Slips',
  documentName: 'Brick Kiln Token',
  description: 'Count bricks moulded, fired and dispatched, and the amount due, from daily worker tokens.',
  group: 'industry',
  sheetTab: 'Brick_Kiln_Tokens',
  sheetTitle: 'DocSync — Brick Kiln Token Slips',
  sampleDocument: { href: '/samples/brick-kiln-token.jpg', fileName: 'Sample_Brick_Kiln_Token.jpg' },
  duplicateKey: 'tokenNumber',
  translations: {
    hi: {
      title: 'ईंट भट्ठा टोकन पर्चियाँ',
      documentName: 'ईंट भट्ठा टोकन',
      description: 'रोज़ के मज़दूर टोकन से बनी, पकी और भेजी गई ईंटें और बनती रकम गिनें।',
    },
  },
  extraction: {
    context: 'This is a small Indian brick kiln (ईंट भट्ठा) token slip given daily to a worker or team (पथेरा, जोड़ी) for bricks moulded (पथाई/कच्ची), fired (भराई/जलाई/पकाई) or dispatched (निकासी/लदान). Capture token number, date, kiln name, worker or team, stage, brick count (ईंटें, often in हज़ार), brick class (अव्वल = 1st, दोयम = 2nd, सोयम = 3rd), rate per 1,000 bricks (प्रति हज़ार), amount, vehicle number (dispatch only) and supervisor or munshi (मुंशी). Write the brick count as a full number (e.g. 3 हज़ार = 3000) and the rate per 1,000 bricks.',
    priorityFields: ['Token Number', 'Date', 'Kiln Name', 'Worker / Team', 'Stage', 'Brick Count', 'Brick Class', 'Rate per 1,000', 'Amount', 'Vehicle Number'],
  },
  mockFields: [
    { key: 'tokenNumber', label: 'Token Number', value: '2241', confidence: 93, category: 'identity' },
    { key: 'date', label: 'Date', value: '27-10-2026', confidence: 95, category: 'date' },
    { key: 'kilnName', label: 'Kiln Name', value: 'Maa Durga Brick Field, Rampur', confidence: 90, category: 'identity' },
    { key: 'workerName', label: 'Worker / Team', value: 'Lalu & team (4)', confidence: 82, category: 'identity' },
    { key: 'stage', label: 'Stage', value: 'Dispatch (Loading)', confidence: 88, category: 'other' },
    { key: 'brickCount', label: 'Brick Count', value: '3,000', confidence: 96, category: 'other' },
    { key: 'brickClass', label: 'Brick Class', value: '1st (Awwal)', confidence: 86, category: 'other' },
    { key: 'ratePerThousand', label: 'Rate per 1,000', value: '₹180', confidence: 92, category: 'financial' },
    { key: 'amount', label: 'Amount', value: '₹540', confidence: 95, category: 'financial' },
    { key: 'vehicleNumber', label: 'Vehicle Number', value: 'UP 32 HT 4417', confidence: 89, category: 'identity' },
    { key: 'supervisor', label: 'Supervisor', value: 'R. Yadav (Munshi)', confidence: 76, category: 'identity' },
  ],
  notion: {
    titleFrom: WORKER,
    dateFrom: ['date', 'tokenDate'],
    properties: [
      { name: 'Quantity', type: 'number', from: COUNT },
      { name: 'Amount', type: 'number', from: AMOUNT },
      { name: 'Kiln Stage', type: 'select', from: STAGE },
    ],
  },
  derive(fields) {
    if (findField(fields, AMOUNT)) return fields;
    const count = brickCount(fieldValue(fields, COUNT));
    const rate = amountValue(fieldValue(fields, RATE));
    if (count === null || rate === null) return fields;
    const amount = Math.round((count / 1000) * rate * 100) / 100;
    return [...fields, { key: 'amount', label: 'Amount', value: String(amount), confidence: 100, category: 'financial' }];
  },
  validate(fields) {
    const warnings: RuleWarning[] = [];
    const count = brickCount(fieldValue(fields, COUNT));
    const rate = amountValue(fieldValue(fields, RATE));
    const amount = amountValue(fieldValue(fields, AMOUNT));
    const stage = fieldValue(fields, STAGE);
    const vehicle = fieldValue(fields, VEHICLE);

    if (count !== null) {
      if (count <= 0 || !Number.isInteger(count)) {
        warnings.push({ code: 'brick.countWhole', field: fieldKey(fields, COUNT), params: { count } });
      } else if (count > MAX_BRICKS_PER_TOKEN) {
        warnings.push({ code: 'brick.countHigh', field: fieldKey(fields, COUNT), params: { count: bricks(count) } });
      }
    }
    if (count !== null && rate !== null && amount !== null) {
      const expected = (count / 1000) * rate;
      if (!moneyClose(expected, amount)) {
        warnings.push({
          code: 'brick.amount',
          field: fieldKey(fields, AMOUNT),
          params: { amount: rupees(amount), count: bricks(count), rate: rupees(rate), expected: rupees(expected) },
        });
      }
    }
    if (vehicle) {
      if (!isVehicleNumber(vehicle)) {
        warnings.push({ code: 'vehicle', field: fieldKey(fields, VEHICLE), params: { vehicle } });
      }
    } else if (stage && DISPATCH.test(stage)) {
      warnings.push({ code: 'brick.noVehicle', field: fieldKey(fields, STAGE), params: { stage } });
    }
    return warnings;
  },
};

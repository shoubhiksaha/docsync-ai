import { normalizeKey, parseNumber } from '@/core/text';
import { isAadhaarField, maskAadhaar, maskAadhaarInText, moneyClose, rupees } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile, RecordField } from './types';

const WORKERS = ['workers', 'workerDetails', 'entries', 'attendance'];
const WORKER_COUNT = ['workerCount', 'numberOfWorkers', 'totalWorkers', 'noOfWorkers'];
const PERSON_DAYS = ['personDays', 'totalPersonDays', 'totalDays', 'mandays', 'manDays'];
const DAILY_WAGE = ['dailyWage', 'dailyWageRate', 'wageRate', 'rate', 'ratePerDay'];
const TOTAL_WAGES = ['totalWages', 'totalAmount', 'grossWages', 'total', 'amount'];
const ADVANCES = ['advances', 'advance', 'totalAdvance', 'peshgi'];
const NET = ['netPayable', 'netAmount', 'balancePayable', 'netPaid'];
const FROM = ['periodFrom', 'fromDate', 'weekStarting', 'startDate'];
const TO = ['periodTo', 'toDate', 'weekEnding', 'endDate'];
const PERIOD = ['period', 'week', 'dates'];

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

interface Worker { name: string; days: number; amount: number | null }

const WORKER_LINE = /^(.+?)\s*[–—-]\s*(\d+(?:\.\d+)?)\s*(?:days?|din|दिन)?(?:\s*[–—-]\s*(?:₹|rs\.?)?\s*(\d+(?:\.\d+)?))?/i;

/** "Ramesh – 6 – ₹3,000; Sita – 5½ – ₹2,750" → workers; null when any line can't be read. */
function parseWorkers(text: string): Worker[] | null {
  const lines = text
    .replace(/(\d),(?=\d)/g, '$1')
    .replace(/(\d)\s*½/g, '$1.5')
    .replace(/½/g, '0.5')
    .split(/[;\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const workers: Worker[] = [];
  for (const line of lines) {
    const m = line.match(WORKER_LINE);
    if (!m) return null;
    workers.push({ name: m[1].trim(), days: Number(m[2]), amount: m[3] === undefined ? null : Number(m[3]) });
  }
  return workers.length ? workers : null;
}

/** Day-first dates (20-10-2026, 20/10/26) as UTC milliseconds; null when not a real date. */
function dayFirst(raw: string | undefined): number | null {
  const m = raw?.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/);
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const t = Date.UTC(year, Number(m[2]) - 1, Number(m[1]));
  const d = new Date(t);
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[1]) ? t : null;
}

/** The period's first and last day, from separate fields or one "20-10-2026 to 25-10-2026" field. */
function periodDates(fields: RecordField[]): [number | null, number | null] {
  const from = fieldValue(fields, FROM);
  const to = fieldValue(fields, TO);
  if (from || to) return [dayFirst(from), dayFirst(to)];
  const both = fieldValue(fields, PERIOD)?.match(/\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/g) ?? [];
  return [dayFirst(both[0]), dayFirst(both[1])];
}

/** Keeps only the last 4 digits of anything that looks like an Aadhaar number in an Aadhaar or Workers field. */
function maskAadhaarNumbers(field: RecordField): RecordField {
  const inWorkers = WORKERS.map(normalizeKey).includes(normalizeKey(field.key));
  if (!isAadhaarField(field) && !inWorkers) return field;
  const masked = maskAadhaarInText(maskAadhaar(field).value);
  return masked === field.value ? field : { ...field, value: masked };
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

export const musterRoll: DocumentProfile = {
  id: 'muster-roll',
  title: 'Daily Wage Muster Rolls',
  documentName: 'Muster Roll Page',
  description: 'Extract worker attendance, half-days, wages, advances and net payable from muster register photos.',
  group: 'industry',
  sheetTab: 'Muster_Rolls',
  sheetTitle: 'DocSync — Daily Wage Muster Rolls',
  sampleDocument: { href: '/samples/muster-roll.jpg', fileName: 'Sample_Muster_Roll.jpg' },
  translations: {
    hi: {
      title: 'दैनिक मज़दूरी हाज़िरी रजिस्टर',
      documentName: 'हाज़िरी रजिस्टर का पन्ना',
      description: 'रजिस्टर की फ़ोटो से हाज़िरी, आधे दिन, मज़दूरी, एडवांस और देय रकम निकालें।',
    },
  },
  extraction: {
    context: 'This is one page of an Indian daily-wage muster roll or attendance register (हाज़िरी रजिस्टर, मस्टर रोल) from a site or contractor, with a row per worker and daily marks (P/A, ✓, "½" or "H" for a half day). Treat the whole page as one record: site/project, contractor (ठेकेदार), period from and to dates, number of workers, total person-days (half-days count as 0.5), daily wage rate (रोज़ की मज़दूरी) if the same for everyone, total wages, advances (एडवांस/पेशगी), net payable (देय/बाकी) and supervisor or munshi (मुंशी). Put every worker in ONE "Workers" field as "Name – days – ₹amount; …". If an Aadhaar number appears, record only its last 4 digits as "XXXX XXXX 1234".',
    priorityFields: ['Site', 'Contractor', 'Period From', 'Period To', 'Number of Workers', 'Person-Days', 'Daily Wage', 'Total Wages', 'Advances', 'Net Payable'],
  },
  mockFields: [
    { key: 'siteName', label: 'Site', value: 'Shiv Nagar Water Tank, Rampur', confidence: 89, category: 'metadata' },
    { key: 'contractorName', label: 'Contractor', value: 'Verma Construction Co.', confidence: 91, category: 'identity' },
    { key: 'periodFrom', label: 'Period From', value: '19-10-2026', confidence: 94, category: 'date' },
    { key: 'periodTo', label: 'Period To', value: '24-10-2026', confidence: 94, category: 'date' },
    { key: 'workerCount', label: 'Number of Workers', value: '6', confidence: 96, category: 'other' },
    { key: 'personDays', label: 'Person-Days', value: '33', confidence: 90, category: 'other' },
    { key: 'dailyWage', label: 'Daily Wage', value: '₹500', confidence: 93, category: 'financial' },
    { key: 'totalWages', label: 'Total Wages', value: '₹16,500', confidence: 95, category: 'financial' },
    { key: 'advances', label: 'Advances', value: '₹2,000', confidence: 88, category: 'financial' },
    { key: 'netPayable', label: 'Net Payable', value: '₹14,500', confidence: 95, category: 'financial' },
    { key: 'supervisor', label: 'Supervisor', value: 'K. Pal (Munshi)', confidence: 77, category: 'identity' },
    {
      key: 'workers',
      label: 'Workers',
      value: 'Ramesh Kumar – 6 – ₹3,000; Sita Devi – 5½ – ₹2,750; Mohan Lal – 6 – ₹3,000; Geeta Bai – 4½ – ₹2,250; Raju Yadav – 5 – ₹2,500; Babloo – 6 – ₹3,000',
      confidence: 80,
      category: 'other',
    },
  ],
  notion: {
    titleFrom: ['siteName', 'site', 'project', 'contractorName'],
    dateFrom: ['periodFrom', 'fromDate', 'weekStarting', 'date'],
    properties: [
      { name: 'Amount', type: 'number', from: TOTAL_WAGES },
      { name: 'Person-Days', type: 'number', from: PERSON_DAYS },
      { name: 'Net Payable', type: 'number', from: NET },
    ],
  },
  derive(input) {
    const masked = input.map(maskAadhaarNumbers);
    const fields = masked.some((f, i) => f !== input[i]) ? masked : input;
    const added: RecordField[] = [];
    const workersText = fieldValue(fields, WORKERS);
    const workers = workersText ? parseWorkers(workersText) : null;

    let personDays = parseNumber(fieldValue(fields, PERSON_DAYS));
    if (!findField(fields, PERSON_DAYS) && workers) {
      personDays = sum(workers.map(w => w.days));
      added.push({ key: 'personDays', label: 'Person-Days', value: String(personDays), confidence: 100, category: 'other' });
    }

    let total = parseNumber(fieldValue(fields, TOTAL_WAGES));
    if (!findField(fields, TOTAL_WAGES)) {
      const rate = parseNumber(fieldValue(fields, DAILY_WAGE));
      const amounts = workers?.map(w => w.amount);
      if (personDays !== null && rate !== null) total = personDays * rate;
      else if (amounts?.every(a => a !== null)) total = sum(amounts as number[]);
      if (total !== null) added.push({ key: 'totalWages', label: 'Total Wages', value: String(total), confidence: 100, category: 'financial' });
    }

    const advances = parseNumber(fieldValue(fields, ADVANCES));
    if (!findField(fields, NET) && total !== null && advances !== null) {
      added.push({ key: 'netPayable', label: 'Net Payable', value: String(total - advances), confidence: 100, category: 'financial' });
    }
    return added.length ? [...fields, ...added] : fields;
  },
  validate(fields) {
    const warnings: string[] = [];
    const personDays = parseNumber(fieldValue(fields, PERSON_DAYS));
    const rate = parseNumber(fieldValue(fields, DAILY_WAGE));
    const total = parseNumber(fieldValue(fields, TOTAL_WAGES));
    const advances = parseNumber(fieldValue(fields, ADVANCES)) ?? 0;
    const net = parseNumber(fieldValue(fields, NET));
    const workerCount = parseNumber(fieldValue(fields, WORKER_COUNT));
    const workersText = fieldValue(fields, WORKERS);
    const workers = workersText ? parseWorkers(workersText) : null;
    const [from, to] = periodDates(fields);

    if (personDays !== null && rate !== null && total !== null && !moneyClose(personDays * rate, total)) {
      warnings.push(`Total wages (${rupees(total)}) don't match ${personDays} person-days × ${rupees(rate)} (= ${rupees(personDays * rate)}). Please check the register.`);
    }
    if (total !== null && net !== null && !moneyClose(total - advances, net)) {
      warnings.push(`Net payable (${rupees(net)}) doesn't equal total wages ${rupees(total)} − advances ${rupees(advances)} (= ${rupees(total - advances)}). Please check the advances.`);
    }
    if (from !== null && to !== null && from > to) {
      warnings.push('The period ends before it starts. Please check the from and to dates.');
    }

    if (workers) {
      if (workerCount !== null && workerCount !== workers.length) {
        warnings.push(`Number of workers (${workerCount}) doesn't match the ${workers.length} workers listed.`);
      }
      const listedDays = sum(workers.map(w => w.days));
      if (personDays !== null && Math.abs(listedDays - personDays) > 0.01) {
        warnings.push(`Person-days (${personDays}) don't match the workers listed (${listedDays}). Count each half-day as 0.5.`);
      }
      const amounts = workers.map(w => w.amount);
      if (total !== null && amounts.every(a => a !== null) && !moneyClose(sum(amounts as number[]), total)) {
        warnings.push(`Total wages (${rupees(total)}) don't match the workers listed (${rupees(sum(amounts as number[]))}).`);
      }
      if (rate !== null) {
        for (const w of workers) {
          if (w.amount !== null && !moneyClose(w.days * rate, w.amount)) {
            warnings.push(`${w.name}: ${days(w.days)} × ${rupees(rate)} = ${rupees(w.days * rate)}, but ${rupees(w.amount)} is written.`);
          }
        }
      }
      if (from !== null && to !== null && from <= to) {
        const periodDays = Math.round((to - from) / 86_400_000) + 1;
        const over = workers.filter(w => w.days > periodDays);
        if (over.length) {
          warnings.push(`${over.map(w => `${w.name} (${days(w.days)})`).join(', ')} worked more days than the ${days(periodDays)} in the period. Please check the attendance.`);
        }
      }
    }
    return warnings;
  },
};

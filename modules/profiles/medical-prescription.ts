import { parseNumber } from '@/core/text';
import { maskAadhaar } from './checks';
import { fieldValue, findField } from './fields';
import type { DocumentProfile } from './types';

const PATIENT = ['patientName', 'patient', 'name'];
const DOCTOR = ['doctorName', 'doctor', 'consultant'];
const REG_NO = ['doctorRegNo', 'registrationNumber', 'regNo', 'doctorRegistrationNumber', 'registrationNo', 'mciRegNo'];
const DATE = ['date', 'prescriptionDate'];
const AGE = ['age', 'patientAge'];
const MEDICINES = ['medicines', 'medicineList', 'rx', 'drugs'];
const TOTAL_ITEMS = ['totalItems', 'itemCount', 'numberOfMedicines'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_MS = 24 * 60 * 60 * 1000;
/** About six months; older prescriptions are usually not re-dispensed without a fresh one. */
const MAX_AGE_DAYS = 183;

/** Day-first dates ("18-10-2026", "18/10/26", "18 Oct 2026") or ISO "2026-10-18" → UTC ms; null when unreadable. */
function dateMs(value: string | undefined): number | null {
  const v = (value ?? '').trim().toLowerCase();
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dmy = v.match(/^(\d{1,2})[-/. ]+(\d{1,2}|[a-z]{3,9})[-/., ]+(\d{4}|\d{2})$/);
  let day: number, month: number, year: number;
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (dmy) {
    day = Number(dmy[1]);
    month = /^\d/.test(dmy[2]) ? Number(dmy[2]) : MONTHS.indexOf(dmy[2].slice(0, 3)) + 1;
    year = Number(dmy[3]) + (dmy[3].length === 2 ? 2000 : 0);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.getTime() : null;
}

/** Today as "dd-mm-yyyy", so the mock prescription never ages past the six-month check. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
}

/** Medicines are listed one per semicolon (or line); blank pieces don't count. */
const medicineCount = (list: string) => list.split(/[;\n]/).filter(item => item.trim()).length;

export const medicalPrescription: DocumentProfile = {
  id: 'medical-prescription',
  title: 'Medical Store Prescriptions',
  documentName: 'Doctor Prescription',
  description: "Turn a doctor's handwritten prescription into a medicine order: patient, doctor, registration no. and medicines.",
  group: 'shops',
  sheetTab: 'Medical_Prescriptions',
  sheetTitle: 'DocSync — Medical Store Prescriptions',
  sampleDocument: { href: '/samples/medical-prescription.jpg', fileName: 'Sample_Medical_Prescription.jpg' },
  translations: {
    hi: {
      title: 'मेडिकल स्टोर पर्चे',
      documentName: 'डॉक्टर का पर्चा',
      description: 'डॉक्टर के हाथ से लिखे पर्चे से मरीज़, डॉक्टर, रजिस्ट्रेशन नंबर और दवाओं की सूची निकालें।',
    },
  },
  extraction: {
    context: 'This is a doctor\'s prescription (पर्चा) from an Indian clinic or hospital OPD, brought to a chemist to buy medicines; the letterhead shows the doctor\'s name, degree, clinic and registration number ("Reg. No."), and medicines are handwritten after "Rx" with dose shorthand such as 1-0-1, OD, BD, TDS, SOS, HS and days ("x 5 days"). Record only what the chemist needs: patient name, age, sex, doctor name, registration number, clinic, date and the medicines; do not record diagnoses, symptoms, test results or vitals. Put all medicines into one "Medicines" field as "name strength – dose – days – quantity" separated by semicolons, and their count in "Total Items". If an Aadhaar number appears, record only its last 4 digits as "XXXX XXXX 1234".',
    priorityFields: ['Patient Name', 'Age', 'Sex', 'Doctor Name', 'Doctor Reg No', 'Clinic Name', 'Date', 'Medicines', 'Total Items'],
  },
  mockFields: [
    { key: 'clinicName', label: 'Clinic Name', value: 'Sampleganj Family Clinic', confidence: 93, category: 'metadata' },
    { key: 'doctorName', label: 'Doctor Name', value: 'Dr. Anil Verma (MBBS, MD)', confidence: 95, category: 'identity' },
    { key: 'doctorRegNo', label: 'Doctor Reg No', value: 'UPMC-48213', confidence: 88, category: 'identity' },
    { key: 'date', label: 'Date', value: today(), confidence: 90, category: 'date' },
    { key: 'patientName', label: 'Patient Name', value: 'Sunita Devi', confidence: 91, category: 'identity' },
    { key: 'age', label: 'Age', value: '42 yrs', confidence: 89, category: 'other' },
    { key: 'sex', label: 'Sex', value: 'F', confidence: 92, category: 'other' },
    {
      key: 'medicines',
      label: 'Medicines',
      value: 'Tab Amoxicillin 500 mg – 1-0-1 – 5 days – 10; Tab Paracetamol 650 mg – SOS – 3 days – 6; Cap Omeprazole 20 mg – 1-0-0 before food – 5 days – 5',
      confidence: 76,
      category: 'other',
    },
    { key: 'totalItems', label: 'Total Items', value: '3', confidence: 90, category: 'other' },
  ],
  notion: {
    titleFrom: PATIENT,
    dateFrom: DATE,
    properties: [
      { name: 'Doctor', type: 'rich_text', from: DOCTOR },
      { name: 'Doctor Reg No', type: 'rich_text', from: REG_NO },
      { name: 'Quantity', type: 'number', from: TOTAL_ITEMS },
    ],
  },
  derive(fields) {
    // Privacy: keep only the last 4 digits of a full Aadhaar number.
    const masked = fields.map(maskAadhaar);
    let out = masked.some((f, i) => f !== fields[i]) ? masked : fields;

    const medicines = fieldValue(out, MEDICINES);
    if (medicines && !findField(out, TOTAL_ITEMS)) {
      out = [...out, { key: 'totalItems', label: 'Total Items', value: String(medicineCount(medicines)), confidence: 100, category: 'other' }];
    }
    return out;
  },
  validate(fields) {
    const warnings: string[] = [];
    if (!fieldValue(fields, REG_NO)) {
      warnings.push("No doctor registration number found. Chemists normally need it to dispense Schedule H medicines — check the letterhead or stamp.");
    }

    const dateRaw = fieldValue(fields, DATE);
    const date = dateMs(dateRaw);
    if (!dateRaw) {
      warnings.push('No prescription date found. Chemists normally need a dated prescription to dispense Schedule H medicines.');
    } else if (date === null) {
      warnings.push(`Prescription date "${dateRaw}" could not be read. Please check it.`);
    } else {
      const ageDays = (Date.now() - date) / DAY_MS;
      if (ageDays > MAX_AGE_DAYS) {
        warnings.push(`Prescription is dated ${dateRaw}, more than 6 months ago. Check it is still valid before dispensing.`);
      } else if (ageDays < -1) {
        warnings.push(`Prescription date ${dateRaw} is in the future. Please check the date.`);
      }
    }

    const age = parseNumber(fieldValue(fields, AGE));
    if (age !== null && (age < 0 || age > 120)) {
      warnings.push(`Patient age "${age}" looks wrong. Please check it.`);
    }

    const medicines = fieldValue(fields, MEDICINES);
    const items = parseNumber(fieldValue(fields, TOTAL_ITEMS));
    if (medicines && items !== null && items !== medicineCount(medicines)) {
      warnings.push(`Total Items (${items}) doesn't match the ${medicineCount(medicines)} medicines listed. Check for a missed or extra medicine.`);
    }
    return warnings;
  },
};

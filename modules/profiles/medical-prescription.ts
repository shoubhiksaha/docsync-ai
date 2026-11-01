import { parseNumber } from '@/core/text';
import { maskAadhaar, parseIndianDate } from './checks';
import { fieldKey, fieldValue, findField } from './fields';
import type { DocumentProfile, RuleWarning } from './types';

const PATIENT = ['patientName', 'patient', 'name'];
const DOCTOR = ['doctorName', 'doctor', 'consultant'];
const REG_NO = ['doctorRegNo', 'registrationNumber', 'regNo', 'doctorRegistrationNumber', 'registrationNo', 'mciRegNo'];
const DATE = ['date', 'prescriptionDate'];
const AGE = ['age', 'patientAge'];
const MEDICINES = ['medicines', 'medicineList', 'rx', 'drugs'];
const TOTAL_ITEMS = ['totalItems', 'itemCount', 'numberOfMedicines'];
const DAY_MS = 24 * 60 * 60 * 1000;
/** About six months; older prescriptions are usually not re-dispensed without a fresh one. */
const MAX_AGE_DAYS = 183;

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
    // As printed on the sample photo; once it is six months old, the sample also shows the age check.
    { key: 'date', label: 'Date', value: '26/10/2026', confidence: 90, category: 'date' },
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
    const warnings: RuleWarning[] = [];
    if (!fieldValue(fields, REG_NO)) {
      warnings.push({ code: 'medical.noRegNo' });
    }

    const dateRaw = fieldValue(fields, DATE);
    const date = parseIndianDate(dateRaw)?.time ?? null;
    const dateKey = fieldKey(fields, DATE);
    if (!dateRaw) {
      warnings.push({ code: 'medical.noDate' });
    } else if (date === null) {
      warnings.push({ code: 'medical.dateUnreadable', field: dateKey, params: { date: dateRaw } });
    } else {
      const ageDays = (Date.now() - date) / DAY_MS;
      if (ageDays > MAX_AGE_DAYS) {
        warnings.push({ code: 'medical.dateOld', field: dateKey, params: { date: dateRaw } });
      } else if (ageDays < -1) {
        warnings.push({ code: 'medical.dateFuture', field: dateKey, params: { date: dateRaw } });
      }
    }

    const age = parseNumber(fieldValue(fields, AGE));
    if (age !== null && (age < 0 || age > 120)) {
      warnings.push({ code: 'medical.age', field: fieldKey(fields, AGE), params: { age } });
    }

    const medicines = fieldValue(fields, MEDICINES);
    const items = parseNumber(fieldValue(fields, TOTAL_ITEMS));
    if (medicines && items !== null && items !== medicineCount(medicines)) {
      warnings.push({ code: 'medical.items', field: fieldKey(fields, TOTAL_ITEMS), params: { items, count: medicineCount(medicines) } });
    }
    return warnings;
  },
};

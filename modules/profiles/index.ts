/**
 * Profiles module — the registry of document "utility apps".
 * Pure data and functions with no server dependencies, so it is safe to import from client
 * components. To add a document type, create a profile file and add it to PROFILES.
 */
import { brickKilnToken } from './brick-kiln-token';
import { cableWifiReceipt } from './cable-wifi-receipt';
import { catererMaterialBill } from './caterer-material-bill';
import { constructionMaterialInward } from './construction-material-inward';
import { courierRunSheet } from './courier-run-sheet';
import { dairyCollectionSlip } from './dairy-collection-slip';
import { decoratorChallan } from './decorator-challan';
import { factoryWeightSlip } from './factory-weight-slip';
import { fishAuctionChit } from './fish-auction-chit';
import { fleetFuelExpense } from './fleet-fuel-expense';
import { garageRepairEstimate } from './garage-repair-estimate';
import { godownStorageReceipt } from './godown-storage-receipt';
import { handicraftPieceRate } from './handicraft-piece-rate';
import { handloomWeaverLog } from './handloom-weaver-log';
import { jewelryKarigarLog } from './jewelry-karigar-log';
import { kiranaKhata } from './kirana-khata';
import { lorryReceipt } from './lorry-receipt';
import { mandiAuctionSlip } from './mandi-auction-slip';
import { medicalPrescription } from './medical-prescription';
import { mobileRepairJobCard } from './mobile-repair-job-card';
import { musterRoll } from './muster-roll';
import { ngoReceipt } from './ngo-receipt';
import { pdsDistributionLog } from './pds-distribution-log';
import { pesticideBill } from './pesticide-bill';
import { scrapDealerReceipt } from './scrap-dealer-receipt';
import { streetVendorDailyFinance } from './street-vendor-daily-finance';
import { tailoringMeasurement } from './tailoring-measurement';
import { timberMeasurementSlip } from './timber-measurement-slip';
import { maskAadhaarFields } from './checks';
import type { ComingSoonProfile, DocumentProfile, Lang, LocalizedProfileText, RecordField } from './types';

export type {
  ComingSoonProfile, DocumentProfile, FieldCategory, Lang, LocalizedProfileText, NotionPropertySpec, NotionPropertyType, ProfileGroup, RecordField,
} from './types';
export { PROFILE_GROUPS } from './types';
export { comingSoonProfiles } from './catalog';
export { fieldValue, findField } from './fields';
export { isAadhaarField, maskAadhaar, maskAadhaarFields, maskAadhaarInText } from './checks';

// Listed in home-page order; the home page groups them by `group`.
const PROFILES: readonly DocumentProfile[] = [
  // shops
  kiranaKhata, medicalPrescription, garageRepairEstimate, mobileRepairJobCard, tailoringMeasurement, decoratorChallan,
  // farm
  mandiAuctionSlip, dairyCollectionSlip, pesticideBill, fishAuctionChit, catererMaterialBill,
  // transport
  fleetFuelExpense, lorryReceipt, courierRunSheet, godownStorageReceipt,
  // industry
  factoryWeightSlip, constructionMaterialInward, brickKilnToken, scrapDealerReceipt, timberMeasurementSlip, musterRoll,
  // crafts
  handloomWeaverLog, jewelryKarigarLog, handicraftPieceRate,
  // community
  ngoReceipt, cableWifiReceipt, pdsDistributionLog, streetVendorDailyFinance,
];

export function activeProfiles(): readonly DocumentProfile[] {
  return PROFILES;
}

export function getProfile(id: string | null | undefined): DocumentProfile | undefined {
  return PROFILES.find(p => p.id === id);
}

/** Title, document name and description in `lang`, falling back to English. */
export function localizedProfile(profile: DocumentProfile, lang: Lang): LocalizedProfileText {
  const english = { title: profile.title, documentName: profile.documentName, description: profile.description };
  return lang === 'en' ? english : { ...english, ...profile.translations?.[lang] };
}

export function localizedComingSoon(item: ComingSoonProfile, lang: Lang): { title: string; description: string } {
  return lang === 'hi' && item.hi ? item.hi : { title: item.title, description: item.description };
}

/**
 * Masks any Aadhaar field to its last 4 digits (for every profile), then runs the profile's
 * derive(); if derive() throws, the masked input comes back unchanged.
 */
export function deriveFields(profile: DocumentProfile, fields: RecordField[]): RecordField[] {
  const masked = maskAadhaarFields(fields);
  if (!profile.derive) return masked;
  try {
    return maskAadhaarFields(profile.derive(masked));
  } catch (err) {
    console.error(`[profiles:${profile.id}] derive failed:`, err);
    return masked;
  }
}

/** Runs the profile's validate(); a buggy validator becomes a warning, never an error. */
export function validateFields(profile: DocumentProfile, fields: RecordField[]): string[] {
  if (!profile.validate) return [];
  try {
    return profile.validate(fields);
  } catch (err) {
    console.error(`[profiles:${profile.id}] validate failed:`, err);
    return ['Automatic checks for this document type are unavailable right now. Please review the values manually.'];
  }
}

/** Every Notion property any profile writes — used when creating a database during Notion OAuth. */
export function notionPropertyUnion(): { name: string; type: string }[] {
  const seen = new Map<string, string>();
  for (const profile of PROFILES) {
    for (const prop of profile.notion.properties) seen.set(prop.name, prop.type);
  }
  return [...seen].map(([name, type]) => ({ name, type }));
}

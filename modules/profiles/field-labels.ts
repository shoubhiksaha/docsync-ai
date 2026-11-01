import { normalizeKey } from '@/core/text';
import type { Lang } from './types';

/**
 * Hindi names for the field labels the profiles ask for (priority fields), show in their samples
 * and add when deriving, keyed by the English label. Only for display: the field's key and its
 * English label stay as they are, so sheet columns still line up.
 */
const HINDI: Record<string, string> = {
  // Shared
  'Date': 'तारीख',
  'Amount': 'रकम',
  'Total': 'कुल',
  'Total Amount': 'कुल रकम',
  'Grand Total': 'कुल जोड़',
  'Subtotal': 'उप-जोड़',
  'GST': 'GST',
  'Balance': 'बाकी',
  'Balance Due': 'बाकी रकम',
  'Advance': 'एडवांस',
  'Advances': 'एडवांस',
  'Paid': 'चुकाया',
  'Total Paid': 'कुल जमा',
  'Amount Paid': 'चुकाई रकम',
  'Net Paid': 'कुल भुगतान (एडवांस काटकर)',
  'Net Payable': 'कुल देय (एडवांस काटकर)',
  'Payment Mode': 'भुगतान का तरीका',
  'Rate': 'दर',
  'Phone': 'फ़ोन',
  'Customer': 'ग्राहक',
  'Customer Name': 'ग्राहक का नाम',
  'Items': 'सामान',
  'Item Count': 'सामान की गिनती',
  'Total Items': 'कुल सामान',
  'Entries': 'एंट्री',
  'Notes': 'नोट',
  'Vehicle Number': 'गाड़ी नंबर',
  'Receipt Number': 'रसीद नंबर',
  'Bill Number': 'बिल नंबर',
  'Slip Number': 'पर्ची नंबर',
  'Challan Number': 'चालान नंबर',
  'Card Number': 'कार्ड नंबर',
  'Delivery Date': 'डिलीवरी की तारीख',
  'Supervisor': 'सुपरवाइज़र',
  'Collector': 'वसूली करने वाले',
  'Dealer': 'डीलर',
  'Dealer Name': 'डीलर का नाम',
  'Commodity': 'जिंस',
  'Material': 'माल',
  'Weight': 'वज़न',
  'Weight (kg)': 'वज़न (किलो)',
  'Total Weight': 'कुल वज़न',
  'Quantity': 'मात्रा',
  'Unit': 'इकाई',
  'Party': 'पार्टी',
  'Charges': 'शुल्क',
  'Site': 'साइट',
  'Supplier': 'सप्लायर',
  'Area': 'इलाक़ा',
  'Rate per Piece': 'प्रति नग दर',

  // Kirana khata
  'Shop Name': 'दुकान का नाम',
  'From Date': 'पहली एंट्री की तारीख',
  'To Date': 'आख़िरी एंट्री की तारीख',
  'Opening Balance': 'पिछला बाकी',
  'Total Credit': 'कुल उधार',

  // Medical prescription
  'Patient Name': 'मरीज़ का नाम',
  'Age': 'उम्र',
  'Sex': 'लिंग',
  'Doctor Name': 'डॉक्टर का नाम',
  'Doctor Reg No': 'डॉक्टर का रजिस्ट्रेशन नंबर',
  'Clinic Name': 'क्लिनिक का नाम',
  'Medicines': 'दवाइयाँ',

  // Garage and mobile repair
  'Estimate Number': 'एस्टिमेट नंबर',
  'Make Model': 'कंपनी और मॉडल',
  'Odometer': 'ओडोमीटर',
  'Parts': 'पार्ट्स',
  'Parts Total': 'पार्ट्स का जोड़',
  'Labour Total': 'मज़दूरी का जोड़',
  'Job Card Number': 'जॉब कार्ड नंबर',
  'Brand Model': 'ब्रांड और मॉडल',
  'IMEI': 'IMEI',
  'Problem': 'ख़राबी',
  'Spare Part': 'स्पेयर पार्ट',

  // Tailoring
  'Order Number': 'ऑर्डर नंबर',
  'Garment Type': 'कपड़े का प्रकार',
  'Measurements': 'नाप',
  'Chest': 'छाती',
  'Waist': 'कमर',
  'Hip': 'हिप',
  'Shoulder': 'कंधा',
  'Sleeve': 'आस्तीन',
  'Length': 'लंबाई',
  'Neck': 'गला',
  'Fabric': 'कपड़ा',
  'Trial Date': 'ट्रायल की तारीख',

  // Decorator challan
  'Event': 'कार्यक्रम',
  'Venue': 'जगह',
  'Total Pieces': 'कुल नग',
  'Total Returned': 'कुल वापस',
  'Return Date': 'वापसी की तारीख',
  'Rent': 'किराया',
  'Security Deposit': 'ज़मानत राशि',
  'Items Short/Damaged': 'कम या टूटा सामान',

  // Mandi
  'Mandi Name': 'मंडी का नाम',
  'Farmer Name': 'किसान का नाम',
  'Commission Agent (Arhtiya)': 'आढ़तिया',
  'Buyer': 'ख़रीदार',
  'Weight (Quintals)': 'वज़न (क्विंटल)',
  'Rate per Quintal': 'प्रति क्विंटल दर',
  'Gross Amount': 'कुल रकम (कटौती से पहले)',
  'Total Deductions': 'कुल कटौती',

  // Dairy
  'Society Name': 'समिति का नाम',
  'Member Code': 'सदस्य कोड',
  'Member Name': 'सदस्य का नाम',
  'Shift': 'पाली',
  'Milk Type': 'दूध का प्रकार',
  'Quantity (Litres)': 'मात्रा (लीटर)',
  'Fat %': 'फ़ैट %',
  'SNF %': 'SNF %',
  'CLR': 'CLR',
  'Rate per Litre': 'प्रति लीटर दर',

  // Pesticide bill
  'Village': 'गाँव',
  'Dealer Licence No': 'डीलर लाइसेंस नंबर',
  'Dealer GSTIN': 'डीलर का GSTIN',

  // Fish auction
  'Chit Number': 'चिट नंबर',
  'Harbour / Market': 'बंदरगाह / बाज़ार',
  'Boat Name': 'नाव का नाम',
  'Boat Registration No': 'नाव का रजिस्ट्रेशन नंबर',
  'Owner': 'मालिक',
  'Species': 'मछली की किस्म',
  'Rate per kg': 'प्रति किलो दर',
  'Commission': 'कमीशन',

  // Caterer bill
  'Supplier Name': 'सप्लायर का नाम',
  'Supplier Phone': 'सप्लायर का फ़ोन',
  'Function / Event': 'समारोह',

  // Fleet fuel
  'Driver Name': 'ड्राइवर का नाम',
  'Expense Type': 'ख़र्च का प्रकार',
  'Fuel Type': 'ईंधन का प्रकार',
  'Quantity (L)': 'मात्रा (लीटर)',
  'Odometer (km)': 'ओडोमीटर (किमी)',
  'Vendor / Fuel Station': 'पेट्रोल पंप / दुकान',

  // Lorry receipt
  'LR Number': 'बिल्टी नंबर',
  'From': 'कहाँ से',
  'To': 'कहाँ तक',
  'Consignor': 'भेजने वाला',
  'Consignor GSTIN': 'भेजने वाले का GSTIN',
  'Consignee': 'पाने वाला',
  'Consignee GSTIN': 'पाने वाले का GSTIN',
  'Packages': 'नग',
  'Description of Goods': 'माल का विवरण',
  'Actual Weight': 'असल वज़न',
  'Charged Weight': 'भाड़े का वज़न',
  'Invoice Number': 'इनवॉइस नंबर',
  'Invoice Value': 'माल की क़ीमत (इनवॉइस)',
  'E-way Bill Number': 'ई-वे बिल नंबर',
  'Freight': 'भाड़ा',
  'Freight Terms': 'भाड़ा कौन देगा',
  'Driver': 'ड्राइवर',

  // Courier run-sheet
  'Run-sheet Number': 'रन-शीट नंबर',
  'Delivery Person': 'डिलीवरी करने वाले',
  'Area / Route': 'इलाक़ा / रूट',
  'Shipments': 'पार्सल',
  'Total Shipments': 'कुल पार्सल',
  'Delivered': 'डिलीवर हुए',
  'Undelivered / Returned': 'डिलीवर नहीं हुए / वापस',
  'COD Expected': 'COD लेना था',
  'COD Collected': 'COD मिला',

  // Godown receipt
  'Warehouse Name': 'गोदाम का नाम',
  'WDRA / Registration No.': 'WDRA / रजिस्ट्रेशन नंबर',
  'Date of Deposit': 'जमा करने की तारीख',
  'Depositor Name': 'जमा करने वाले का नाम',
  'Depositor / Farmer': 'जमा करने वाले / किसान',
  'Bags': 'बोरियाँ',
  'Storage Rate': 'भंडारण दर',
  'Storage Period': 'भंडारण की अवधि',
  'Storage Charges': 'भंडारण शुल्क',
  'Valid Until': 'कब तक मान्य',

  // Weighbridge slip
  'Gross Weight': 'भरा वज़न (ग्रॉस)',
  'Tare Weight': 'ख़ाली वज़न (टेयर)',
  'Net Weight': 'शुद्ध वज़न (नेट)',

  // Construction material
  'Received By': 'किसने लिया',

  // Brick kiln
  'Token Number': 'टोकन नंबर',
  'Kiln Name': 'भट्ठे का नाम',
  'Worker / Team': 'मज़दूर / टोली',
  'Stage': 'काम',
  'Brick Count': 'ईंटों की गिनती',
  'Brick Class': 'ईंट का दर्जा',
  'Rate per 1,000': 'प्रति हज़ार दर',

  // Scrap receipt
  'Seller Name': 'बेचने वाले का नाम',

  // Timber slip
  'Timber Mart': 'लकड़ी टाल',
  'Wood Species': 'लकड़ी की किस्म',
  'Number of Logs': 'लट्ठों की गिनती',
  'Logs': 'लट्ठे',
  'Total Volume (cft)': 'कुल घन फ़ुट (cft)',
  'Rate per cft': 'प्रति घन फ़ुट दर',

  // Muster roll
  'Contractor': 'ठेकेदार',
  'Period From': 'अवधि की शुरुआत',
  'Period To': 'अवधि का अंत',
  'Workers': 'मज़दूर',
  'Number of Workers': 'मज़दूरों की गिनती',
  'Person-Days': 'कुल हाज़िरी (दिन)',
  'Daily Wage': 'रोज़ की मज़दूरी',
  'Total Wages': 'कुल मज़दूरी',

  // Handloom weaver
  'Weaver Name': 'बुनकर का नाम',
  'Weaver / Loom No.': 'बुनकर / करघा नंबर',
  'Date Issued': 'देने की तारीख',
  'Date Received': 'वापस मिलने की तारीख',
  'Yarn Type / Count': 'धागे का प्रकार / काउंट',
  'Yarn Issued (kg)': 'दिया धागा (किलो)',
  'Yarn Consumed (kg)': 'लगा धागा (किलो)',
  'Pieces Woven': 'बुने नग',
  'Wages': 'मज़दूरी',

  // Jewellery karigar
  'Job Number': 'जॉब नंबर',
  'Karigar Name': 'कारीगर का नाम',
  'Ornament': 'गहना',
  'Metal': 'धातु',
  'Purity': 'शुद्धता',
  'Metal Issued (g)': 'दी गई धातु (ग्राम)',
  'Finished Weight (g)': 'तैयार गहने का वज़न (ग्राम)',
  'Stone Weight (g)': 'नग/स्टोन का वज़न (ग्राम)',
  'Wastage (g)': 'घटत (ग्राम)',
  'Wastage %': 'घटत %',
  'Making Charges': 'बनवाई',
  'Date Returned': 'लौटाने की तारीख',

  // Handicraft piece-rate
  'Artisan Name': 'कारीगर का नाम',
  'Artisan ID': 'कारीगर ID',
  'Product / Design': 'माल / डिज़ाइन',
  'Pieces Issued': 'दिए नग',
  'Pieces Completed': 'बने नग',
  'Pieces Rejected': 'रिजेक्ट नग',
  'Amount Due': 'देय रकम',

  // NGO receipt
  'NGO Name': 'संस्था का नाम',
  'NGO Reg. No.': 'संस्था का रजिस्ट्रेशन नंबर',
  'Donor Name': 'दानदाता का नाम',
  'Donor Address': 'दानदाता का पता',
  'PAN Number': 'PAN नंबर',

  // Cable / Wi-Fi receipt
  'Subscriber Name': 'ग्राहक का नाम',
  'Customer ID / STB No.': 'ग्राहक ID / STB नंबर',
  'Plan / Pack': 'प्लान / पैक',
  'Billing Month': 'बिल का महीना',
  'Late Fee': 'लेट फ़ीस',

  // PDS ration log
  'FPS Number': 'राशन दुकान (FPS) नंबर',
  'Ration Card Number': 'राशन कार्ड नंबर',
  'Card Type': 'कार्ड का प्रकार',
  'Head of Family': 'परिवार के मुखिया',
  'Members': 'सदस्य',
  'Rice (kg)': 'चावल (किलो)',
  'Wheat (kg)': 'गेहूँ (किलो)',
  'Other Items': 'दूसरा सामान',
  'Total Grain (kg)': 'कुल अनाज (किलो)',
  'Transaction Number': 'ट्रांज़ैक्शन नंबर',

  // Street vendor daily finance
  'Scheme': 'योजना',
  'Loan Amount': 'कर्ज़ की रकम',
  'Daily Instalment': 'रोज़ की किस्त',
  'Amount Paid Today': 'आज जमा',
  'Days Paid': 'कितने दिन जमा',
};

const HINDI_BY_KEY = new Map(Object.entries(HINDI).map(([english, hindi]) => [normalizeKey(english), hindi]));

/**
 * A field label in `lang` for display: "Member Name" (or the model's "member_name") → "सदस्य का
 * नाम" in Hindi. A label we have no Hindi for, such as one the user typed, is shown as written.
 */
export function localizedFieldLabel(label: string, lang: Lang): string {
  if (lang === 'en') return label;
  return HINDI_BY_KEY.get(normalizeKey(label)) ?? label;
}

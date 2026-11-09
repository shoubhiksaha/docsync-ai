import type { Lang } from '@/client/i18n';

/**
 * The privacy policy, written to match what the code does (app/login/google-scopes.ts,
 * modules/sheets, modules/media, modules/ai, modules/settings, core/telemetry). Google's OAuth
 * verification and Play's Data safety form are checked against it, so change it with the code.
 * A block is a paragraph, or a list when it is an array. The English text is the binding one.
 */
export type PolicyBlock = string | readonly string[];

export interface PolicySection {
  id: string;
  title: string;
  blocks: readonly PolicyBlock[];
}

export interface Policy {
  updated: string;
  sections: readonly PolicySection[];
}

/** When the policy last changed, as an ISO date (shown in each language below). */
export const POLICY_UPDATED = '2026-11-07';

/** Where people reach ADT about privacy. */
export const PRIVACY_CONTACT_EMAIL = 'support@analogdigital.tech';
export const PRIVACY_CONTACT_URL = 'https://analogdigital.tech';

const LIMITED_USE_EN =
  "DocSync AI's use and transfer to any other app of information received from Google APIs will adhere to the " +
  'Google API Services User Data Policy (https://developers.google.com/terms/api-services-user-data-policy), ' +
  'including the Limited Use requirements.';

const en: Policy = {
  updated: 'Last updated: 7 November 2026',
  sections: [
    {
      id: 'who',
      title: 'Who we are',
      blocks: [
        'DocSync AI ("DocSync", "we", "us") turns photos of paper documents (slips, receipts, registers, challans) into rows in your own Google Sheet, and optionally into records in your own Notion. DocSync AI is an offering by ADT (Analog Digital Technologies).',
        'This policy covers the DocSync AI web app at https://docsync.analogdigital.tech and the DocSync AI app for Android, which opens the same web app. It explains what we collect, how we use it, who we share it with, how long we keep it, and the choices you have.',
      ],
    },
    {
      id: 'summary',
      title: 'In short',
      blocks: [[
        'Your records go to your own Google Sheet and Google Drive (and Notion, if you connect it). We do not keep a copy of your documents on our servers.',
        'DocSync asks Google only for what it needs: who you are, your Google Sheets, and the Drive files DocSync itself creates.',
        'Photos and voice notes are sent to an AI service only to read them. We do not use your documents or your Google data to train AI models.',
        'We never sell your data and never use it for advertising.',
        'You can disconnect DocSync from your Google account at any time.',
      ]],
    },
    {
      id: 'collect',
      title: 'Information we collect',
      blocks: [
        'We collect only what DocSync needs to work:',
        [
          'Google account information: your name, email address and profile picture, when you sign in with Google.',
          'Documents you scan: the photos and PDFs you take, upload or share into DocSync, any voice note you record, the details read from them, and the changes you make before saving.',
          'Your settings: your own AI service key (if you add one), your Notion connection (if you connect it), and preferences such as remembered fields, the duplicate-check field, where photos are kept and your language.',
          "Information kept on your phone: photos taken without a signal, photos shared into DocSync, and your recent scans stay in your browser's storage on your device until they are saved, deleted or you sign out.",
          'Usage and diagnostic information: which steps of a scan were used, how long they took, error codes and the document type. These events never contain document contents or email addresses, and long numbers (phone, ID) are removed before they are recorded. Our hosting providers also keep standard request logs (such as IP address, browser and time) for security and reliability.',
        ],
        'We do not collect your location, contacts, call logs or payment information, and DocSync shows no advertising.',
      ],
    },
    {
      id: 'google',
      title: 'How DocSync uses your Google data',
      blocks: [
        'When you sign in, Google asks you to allow DocSync the following access. Each one is used only for the purpose shown:',
        [
          'Your name, email address and profile picture (openid, email, profile): to sign you in, show which account is signed in, and keep each account\'s data separate on shared phones.',
          'Google Sheets (https://www.googleapis.com/auth/spreadsheets): to create a spreadsheet named "DocSync AI Data" in your Drive, add a row for each document you save, add a column when a new field appears, read the duplicate-check column and the matching row so DocSync can warn you before saving the same document twice, and update a row when you choose Replace or retry a save. DocSync works only in the spreadsheet it creates for you. It does not read, change or delete your other spreadsheets.',
          'Google Drive files created by DocSync (https://www.googleapis.com/auth/drive.file): to create a "DocSync AI" folder, store the photo and voice note of each saved document in it, and move an earlier photo to your Drive trash when you replace that record. This permission covers only files DocSync creates; DocSync cannot see your other Drive files.',
        ],
        'DocSync does not:',
        [
          'sell Google user data, or use or transfer it for advertising, including personalised or retargeted ads;',
          'use Google user data to determine credit-worthiness or for lending;',
          'use Google user data to develop, improve or train generalised or non-personalised AI or machine-learning models;',
          'send the contents of your Google Sheets or Drive to AI services;',
          'transfer Google user data to anyone except as needed to provide DocSync to you, to comply with the law, or as part of a merger or acquisition with your notice;',
          'allow people to read your Google user data, unless you ask us to for support, it is needed to investigate security issues or abuse, or the law requires it.',
        ],
        LIMITED_USE_EN,
        'Google gives DocSync access tokens to act for you. They are kept in an encrypted session cookie on your device and used only while you use DocSync. Our servers do not store the contents of your sheets or Drive files.',
      ],
    },
    {
      id: 'ai',
      title: 'How documents are read by AI',
      blocks: [
        'To read a photo, PDF or voice note, DocSync sends it to one AI service at a time: Groq, OpenAI, Google (Gemini) or Anthropic, or the service whose key you added in Settings. If one is busy, the next one is tried.',
        [
          'Only the document you are scanning is sent (and, with it, the names of fields you asked DocSync to look for). Your Google Sheets, Drive files and contacts are never sent.',
          'We use these services through their business APIs, whose terms do not allow them to use what we send to train their models. They may keep it for a limited time to detect abuse, as their terms describe.',
          'When you use your own AI key, your agreement with that provider applies to what it receives.',
          'DocSync reads the result in memory and keeps no copy of your document or the result on its servers.',
          'AI can misread a document. DocSync shows you every value to check before anything is saved, and flags values it is unsure of.',
        ],
      ],
    },
    {
      id: 'use',
      title: 'How we use information',
      blocks: [[
        'To provide DocSync: sign you in, read your documents, save them where you choose, warn you about duplicates and remember your preferences.',
        'To keep DocSync secure: prevent abuse, detect and fix security problems, and keep each account\'s data separate.',
        'To fix and improve DocSync: understand where scans fail or are slow, using the usage events described above (never document contents).',
        'To respond to you when you contact us, and to meet legal obligations.',
      ]],
    },
    {
      id: 'share',
      title: 'Who we share information with',
      blocks: [
        'We share information only with these services, only for the purposes above, and we never sell it:',
        [
          'Google: your records are written to your own Google Sheets and Drive under your account, and DocSync runs on Google Cloud in Mumbai, India.',
          'Cloudflare: carries traffic to DocSync and protects it from attacks.',
          'AI services (Groq, OpenAI, Google, Anthropic, or your own): receive the documents you scan, to read them, as described above.',
          'Notion: if you connect it, your records and, if you choose, their photos go to the Notion database you pick.',
          'Authorities: when the law requires it, or to protect the rights and safety of our users or the public.',
        ],
        'If ADT is involved in a merger or acquisition, your information stays protected by this policy, and we will tell you before it becomes subject to a different one.',
      ],
    },
    {
      id: 'keep',
      title: 'How long we keep information',
      blocks: [[
        'Your records stay in your Google Sheet, Google Drive and Notion until you delete them there. Removing DocSync does not delete them.',
        'Settings are kept in encrypted cookies on your device until you sign out or they expire. If you turn on "Use my settings on all my devices", they are also kept in our database under your account until you turn it off, which deletes that copy.',
        'Photos waiting on your phone are deleted once saved or deleted, and when you sign out. Photos shared into DocSync are deleted once used, or after 24 hours.',
        'Usage events and request logs are kept for up to 30 days.',
      ]],
    },
    {
      id: 'security',
      title: 'Security',
      blocks: [[
        'All traffic to DocSync uses HTTPS.',
        'Your AI key and Notion connection are encrypted with AES-256-GCM before they are stored, in a cookie or in our database.',
        'DocSync asks Google for as little access as it can, and each user\'s rows go only to their own sheet.',
        'Aadhaar numbers read from a document are masked, so only the last four digits are saved.',
        'No system is perfectly secure, but we work to protect your information and will tell you of a breach that affects you as the law requires.',
      ]],
    },
    {
      id: 'choices',
      title: 'Your choices and rights',
      blocks: [
        [
          'See and correct your records directly in your Google Sheet, Drive or Notion.',
          'Remove your AI key or disconnect Notion in Settings at any time.',
          'Turn off "Use my settings on all my devices" in Settings to delete the copy in our database.',
          'Sign out to clear what DocSync keeps on your phone.',
          "Remove DocSync's access to your Google account at https://myaccount.google.com/permissions. DocSync then can no longer read or write your sheets or Drive files.",
          'Ask us to access, correct or delete the information we hold about you, or raise a concern, using the contact below. We reply within 30 days.',
        ],
        "These rights include those under India's Digital Personal Data Protection Act, 2023. If you are not satisfied with our answer, you can complain to the Data Protection Board of India.",
      ],
    },
    {
      id: 'children',
      title: 'Children',
      blocks: ['DocSync is made for businesses and working adults. It is not meant for anyone under 18, and we do not knowingly collect information from children. If you believe a child has used DocSync, contact us and we will delete their information.'],
    },
    {
      id: 'android',
      title: 'The Android app',
      blocks: ['The DocSync AI app for Android opens this same web app in Chrome, so this policy applies to it in full. The app uses your camera only when you take a photo of a document, and receives photos only when you share them to DocSync from another app.'],
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      blocks: ['When we change this policy, we update the date at the top. If a change affects how we use your Google data or your documents, we will tell you in DocSync before it applies.'],
    },
    {
      id: 'contact',
      title: 'Contact',
      blocks: [`For privacy questions, requests to access, correct or delete your information, or complaints, email ADT (Analog Digital Technologies) at ${PRIVACY_CONTACT_EMAIL}. You can also reach us through ${PRIVACY_CONTACT_URL}.`],
    },
  ],
};

const hi: Policy = {
  updated: 'अंतिम बदलाव: 7 नवंबर 2026',
  sections: [
    {
      id: 'who',
      title: 'हम कौन हैं',
      blocks: [
        'DocSync AI ("DocSync", "हम") काग़ज़ के दस्तावेज़ों (पर्ची, रसीद, रजिस्टर, चालान) की फ़ोटो को आपकी अपनी Google Sheet की पंक्तियों में, और चाहें तो आपके अपने Notion के रिकॉर्ड में बदलता है। DocSync AI, ADT (Analog Digital Technologies) की पेशकश है।',
        'यह नीति https://docsync.analogdigital.tech पर DocSync AI वेब ऐप और Android के लिए DocSync AI ऐप पर लागू होती है, जो यही वेब ऐप खोलता है। इसमें बताया गया है कि हम क्या जानकारी लेते हैं, उसका कैसे उपयोग करते हैं, किसके साथ साझा करते हैं, कितने समय रखते हैं, और आपके पास क्या विकल्प हैं।',
        'इस नीति का अंग्रेज़ी रूप मान्य है; यह हिंदी रूप आपकी सुविधा के लिए है।',
      ],
    },
    {
      id: 'summary',
      title: 'संक्षेप में',
      blocks: [[
        'आपके रिकॉर्ड आपकी अपनी Google Sheet और Google Drive में जाते हैं (और Notion में, अगर आप उसे जोड़ें)। हम अपने सर्वर पर आपके दस्तावेज़ों की कॉपी नहीं रखते।',
        'DocSync, Google से केवल उतना माँगता है जितना ज़रूरी है: आप कौन हैं, आपकी Google Sheets, और Drive की वे फ़ाइलें जो DocSync ख़ुद बनाता है।',
        'फ़ोटो और वॉइस नोट केवल पढ़ने के लिए किसी AI सेवा को भेजे जाते हैं। हम आपके दस्तावेज़ों या Google डेटा से AI मॉडल को प्रशिक्षित नहीं करते।',
        'हम आपका डेटा कभी नहीं बेचते और विज्ञापन के लिए कभी उपयोग नहीं करते।',
        'आप कभी भी DocSync को अपने Google खाते से हटा सकते हैं।',
      ]],
    },
    {
      id: 'collect',
      title: 'हम कौन-सी जानकारी लेते हैं',
      blocks: [
        'हम केवल वही जानकारी लेते हैं जो DocSync के काम करने के लिए ज़रूरी है:',
        [
          'Google खाते की जानकारी: Google से साइन इन करने पर आपका नाम, ईमेल पता और प्रोफ़ाइल फ़ोटो।',
          'आप जो दस्तावेज़ स्कैन करते हैं: DocSync में ली, अपलोड की या शेयर की गई फ़ोटो और PDF, आपका रिकॉर्ड किया वॉइस नोट, उनसे पढ़ी गई जानकारी, और सेव करने से पहले आपके किए बदलाव।',
          'आपकी सेटिंग: आपकी अपनी AI सेवा की key (अगर आप जोड़ें), आपका Notion कनेक्शन (अगर आप जोड़ें), और याद रखे गए फ़ील्ड, डुप्लिकेट जाँच का फ़ील्ड, फ़ोटो कहाँ रखी जाएँ और आपकी भाषा जैसी पसंद।',
          'आपके फ़ोन पर रखी जानकारी: बिना सिग्नल के ली गई फ़ोटो, DocSync में शेयर की गई फ़ोटो और आपके हाल के स्कैन, सेव होने, हटाए जाने या साइन आउट करने तक आपके फ़ोन के ब्राउज़र में रहते हैं।',
          'उपयोग और जाँच की जानकारी: स्कैन के कौन-से चरण उपयोग हुए, उनमें कितना समय लगा, त्रुटि कोड और दस्तावेज़ का प्रकार। इनमें कभी दस्तावेज़ की सामग्री या ईमेल पता नहीं होता, और लंबे नंबर (फ़ोन, ID) दर्ज होने से पहले हटा दिए जाते हैं। हमारे होस्टिंग प्रदाता सुरक्षा और भरोसेमंद सेवा के लिए सामान्य अनुरोध लॉग (जैसे IP पता, ब्राउज़र और समय) भी रखते हैं।',
        ],
        'हम आपकी लोकेशन, संपर्क, कॉल लॉग या भुगतान की जानकारी नहीं लेते, और DocSync में कोई विज्ञापन नहीं है।',
      ],
    },
    {
      id: 'google',
      title: 'DocSync आपके Google डेटा का उपयोग कैसे करता है',
      blocks: [
        'साइन इन करते समय Google आपसे DocSync को यह अनुमति देने को कहता है। हर अनुमति केवल बताए गए काम के लिए उपयोग होती है:',
        [
          'आपका नाम, ईमेल पता और प्रोफ़ाइल फ़ोटो (openid, email, profile): आपको साइन इन करने, यह दिखाने कि कौन-सा खाता साइन इन है, और साझा फ़ोन पर हर खाते का डेटा अलग रखने के लिए।',
          'Google Sheets (https://www.googleapis.com/auth/spreadsheets): आपकी Drive में "DocSync AI Data" नाम की स्प्रेडशीट बनाने, हर सेव किए दस्तावेज़ की एक पंक्ति जोड़ने, नया फ़ील्ड आने पर कॉलम जोड़ने, डुप्लिकेट जाँच का कॉलम और मिलती पंक्ति पढ़ने ताकि एक ही दस्तावेज़ दो बार सेव करने से पहले चेतावनी दी जा सके, और "बदलें" चुनने या दोबारा सेव करने पर पंक्ति अपडेट करने के लिए। DocSync केवल अपनी बनाई स्प्रेडशीट में काम करता है। यह आपकी दूसरी स्प्रेडशीट न पढ़ता है, न बदलता है, न हटाता है।',
          'DocSync की बनाई Google Drive फ़ाइलें (https://www.googleapis.com/auth/drive.file): "DocSync AI" फ़ोल्डर बनाने, हर सेव किए दस्तावेज़ की फ़ोटो और वॉइस नोट उसमें रखने, और रिकॉर्ड बदलने पर पुरानी फ़ोटो को आपकी Drive के ट्रैश में डालने के लिए। यह अनुमति केवल DocSync की बनाई फ़ाइलों पर लागू है; DocSync आपकी दूसरी Drive फ़ाइलें नहीं देख सकता।',
        ],
        'DocSync यह नहीं करता:',
        [
          'Google उपयोगकर्ता डेटा बेचना, या उसे विज्ञापन के लिए (व्यक्तिगत या रीटार्गेटेड विज्ञापन समेत) उपयोग या ट्रांसफ़र करना;',
          'Google उपयोगकर्ता डेटा से साख (क्रेडिट) तय करना या कर्ज़ देने के लिए उसका उपयोग करना;',
          'Google उपयोगकर्ता डेटा से सामान्य AI या मशीन-लर्निंग मॉडल बनाना, सुधारना या प्रशिक्षित करना;',
          'आपकी Google Sheets या Drive की सामग्री AI सेवाओं को भेजना;',
          'DocSync की सेवा देने, कानून का पालन करने, या आपको सूचना देकर विलय या अधिग्रहण के अलावा किसी को Google उपयोगकर्ता डेटा ट्रांसफ़र करना;',
          'लोगों को आपका Google उपयोगकर्ता डेटा पढ़ने देना, जब तक आप सहायता के लिए न कहें, सुरक्षा समस्या या दुरुपयोग की जाँच के लिए ज़रूरी न हो, या कानून ऐसा न माँगे।',
        ],
        'Google API से मिली जानकारी का DocSync AI द्वारा उपयोग और किसी दूसरे ऐप को ट्रांसफ़र, Google API Services User Data Policy (https://developers.google.com/terms/api-services-user-data-policy) और उसकी Limited Use शर्तों का पालन करेगा।',
        'Google, DocSync को आपकी ओर से काम करने के लिए एक्सेस टोकन देता है। वे आपके फ़ोन पर एन्क्रिप्ट की गई सेशन कुकी में रहते हैं और केवल DocSync उपयोग करते समय काम आते हैं। हमारे सर्वर आपकी शीट या Drive फ़ाइलों की सामग्री नहीं रखते।',
      ],
    },
    {
      id: 'ai',
      title: 'AI दस्तावेज़ कैसे पढ़ता है',
      blocks: [
        'फ़ोटो, PDF या वॉइस नोट पढ़ने के लिए DocSync उसे एक बार में एक AI सेवा को भेजता है: Groq, OpenAI, Google (Gemini) या Anthropic, या वह सेवा जिसकी key आपने सेटिंग में जोड़ी है। एक व्यस्त हो तो अगली आज़माई जाती है।',
        [
          'केवल वही दस्तावेज़ भेजा जाता है जिसे आप स्कैन कर रहे हैं (और साथ में उन फ़ील्ड के नाम जिन्हें ढूँढने को आपने कहा)। आपकी Google Sheets, Drive फ़ाइलें और संपर्क कभी नहीं भेजे जाते।',
          'हम इन सेवाओं को उनके व्यावसायिक API से उपयोग करते हैं, जिनकी शर्तें भेजी गई सामग्री से उनके मॉडल प्रशिक्षित करने की अनुमति नहीं देतीं। दुरुपयोग पकड़ने के लिए वे उसे सीमित समय तक रख सकती हैं, जैसा उनकी शर्तों में लिखा है।',
          'जब आप अपनी AI key उपयोग करते हैं, तो उस सेवा को मिली सामग्री पर आपका उस सेवा से हुआ अनुबंध लागू होता है।',
          'DocSync नतीजा मेमोरी में पढ़ता है और आपके दस्तावेज़ या नतीजे की कोई कॉपी अपने सर्वर पर नहीं रखता।',
          'AI दस्तावेज़ ग़लत पढ़ सकता है। सेव करने से पहले DocSync हर मान जाँचने के लिए दिखाता है, और जिन मानों पर उसे भरोसा कम है उन्हें चिह्नित करता है।',
        ],
      ],
    },
    {
      id: 'use',
      title: 'हम जानकारी का उपयोग कैसे करते हैं',
      blocks: [[
        'DocSync की सेवा देने के लिए: आपको साइन इन करना, दस्तावेज़ पढ़ना, उन्हें आपकी चुनी जगह सेव करना, डुप्लिकेट की चेतावनी देना और आपकी पसंद याद रखना।',
        'DocSync को सुरक्षित रखने के लिए: दुरुपयोग रोकना, सुरक्षा समस्याएँ पकड़ना और ठीक करना, और हर खाते का डेटा अलग रखना।',
        'DocSync को ठीक करने और बेहतर बनाने के लिए: ऊपर बताई उपयोग की जानकारी से (दस्तावेज़ की सामग्री के बिना) समझना कि स्कैन कहाँ विफल या धीमे होते हैं।',
        'आपके संपर्क करने पर जवाब देने और कानूनी दायित्व पूरे करने के लिए।',
      ]],
    },
    {
      id: 'share',
      title: 'हम जानकारी किसके साथ साझा करते हैं',
      blocks: [
        'हम जानकारी केवल इन सेवाओं के साथ, केवल ऊपर बताए कामों के लिए साझा करते हैं, और उसे कभी नहीं बेचते:',
        [
          'Google: आपके रिकॉर्ड आपके खाते से आपकी अपनी Google Sheets और Drive में लिखे जाते हैं, और DocSync, मुंबई (भारत) में Google Cloud पर चलता है।',
          'Cloudflare: DocSync तक ट्रैफ़िक पहुँचाता है और उसे हमलों से बचाता है।',
          'AI सेवाएँ (Groq, OpenAI, Google, Anthropic, या आपकी अपनी): ऊपर बताए अनुसार, पढ़ने के लिए आपके स्कैन किए दस्तावेज़ पाती हैं।',
          'Notion: अगर आप उसे जोड़ें, तो आपके रिकॉर्ड और, आप चाहें तो, उनकी फ़ोटो आपके चुने Notion डेटाबेस में जाती हैं।',
          'सरकारी संस्थाएँ: जब कानून ऐसा माँगे, या हमारे उपयोगकर्ताओं या जनता के अधिकार और सुरक्षा बचाने के लिए।',
        ],
        'अगर ADT किसी विलय या अधिग्रहण में शामिल हो, तो आपकी जानकारी इसी नीति से सुरक्षित रहेगी, और किसी दूसरी नीति के लागू होने से पहले हम आपको बताएँगे।',
      ],
    },
    {
      id: 'keep',
      title: 'हम जानकारी कितने समय रखते हैं',
      blocks: [[
        'आपके रिकॉर्ड आपकी Google Sheet, Google Drive और Notion में तब तक रहते हैं जब तक आप उन्हें वहाँ से न हटाएँ। DocSync हटाने से वे नहीं हटते।',
        'सेटिंग आपके फ़ोन पर एन्क्रिप्ट की गई कुकी में साइन आउट करने या उनकी अवधि ख़त्म होने तक रहती हैं। अगर आप "मेरी सेटिंग मेरे सभी डिवाइस पर" चालू करें, तो वे आपके खाते के नाम से हमारे डेटाबेस में भी रहती हैं, जब तक आप इसे बंद न करें; बंद करने पर वह कॉपी हट जाती है।',
        'फ़ोन पर रुकी फ़ोटो सेव होने या हटाने पर, और साइन आउट करने पर हट जाती हैं। DocSync में शेयर की गई फ़ोटो उपयोग होते ही, या 24 घंटे बाद हट जाती हैं।',
        'उपयोग की जानकारी और अनुरोध लॉग अधिकतम 30 दिन रखे जाते हैं।',
      ]],
    },
    {
      id: 'security',
      title: 'सुरक्षा',
      blocks: [[
        'DocSync का सारा ट्रैफ़िक HTTPS से जाता है।',
        'आपकी AI key और Notion कनेक्शन रखे जाने से पहले, कुकी में हों या हमारे डेटाबेस में, AES-256-GCM से एन्क्रिप्ट किए जाते हैं।',
        'DocSync, Google से जितनी कम हो सके उतनी अनुमति माँगता है, और हर उपयोगकर्ता की पंक्तियाँ केवल उसकी अपनी शीट में जाती हैं।',
        'दस्तावेज़ से पढ़े गए आधार नंबर छिपाए जाते हैं, ताकि केवल आख़िरी चार अंक सेव हों।',
        'कोई भी सिस्टम पूरी तरह सुरक्षित नहीं होता, पर हम आपकी जानकारी बचाने के लिए काम करते हैं, और आप पर असर डालने वाले किसी उल्लंघन की सूचना कानून के अनुसार देंगे।',
      ]],
    },
    {
      id: 'choices',
      title: 'आपके विकल्प और अधिकार',
      blocks: [
        [
          'अपने रिकॉर्ड सीधे अपनी Google Sheet, Drive या Notion में देखें और ठीक करें।',
          'सेटिंग में कभी भी अपनी AI key हटाएँ या Notion अलग करें।',
          'हमारे डेटाबेस की कॉपी हटाने के लिए सेटिंग में "मेरी सेटिंग मेरे सभी डिवाइस पर" बंद करें।',
          'DocSync की फ़ोन पर रखी जानकारी हटाने के लिए साइन आउट करें।',
          'https://myaccount.google.com/permissions पर अपने Google खाते से DocSync की अनुमति हटाएँ। इसके बाद DocSync आपकी शीट या Drive फ़ाइलें न पढ़ सकता है, न लिख सकता है।',
          'हमारे पास आपकी जानकारी देखने, ठीक करने या हटाने के लिए, या कोई शिकायत करने के लिए नीचे दिए संपर्क से हमें लिखें। हम 30 दिन के अंदर जवाब देते हैं।',
        ],
        'इनमें भारत के डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम, 2023 के तहत आपके अधिकार भी शामिल हैं। अगर आप हमारे जवाब से संतुष्ट नहीं हैं, तो आप भारतीय डेटा संरक्षण बोर्ड से शिकायत कर सकते हैं।',
      ],
    },
    {
      id: 'children',
      title: 'बच्चे',
      blocks: ['DocSync व्यवसायों और काम करने वाले वयस्कों के लिए बना है। यह 18 साल से कम उम्र के किसी के लिए नहीं है, और हम जान-बूझकर बच्चों की जानकारी नहीं लेते। अगर आपको लगता है कि किसी बच्चे ने DocSync उपयोग किया है, तो हमसे संपर्क करें, हम उसकी जानकारी हटा देंगे।'],
    },
    {
      id: 'android',
      title: 'Android ऐप',
      blocks: ['Android के लिए DocSync AI ऐप यही वेब ऐप Chrome में खोलता है, इसलिए यह पूरी नीति उस पर लागू होती है। ऐप आपका कैमरा केवल दस्तावेज़ की फ़ोटो लेते समय उपयोग करता है, और फ़ोटो केवल तब पाता है जब आप उन्हें किसी दूसरे ऐप से DocSync में शेयर करें।'],
    },
    {
      id: 'changes',
      title: 'इस नीति में बदलाव',
      blocks: ['जब हम यह नीति बदलते हैं, तो ऊपर की तारीख़ बदल देते हैं। अगर कोई बदलाव आपके Google डेटा या दस्तावेज़ों के उपयोग पर असर डाले, तो लागू होने से पहले हम आपको DocSync में बताएँगे।'],
    },
    {
      id: 'contact',
      title: 'संपर्क',
      blocks: [`गोपनीयता से जुड़े सवाल, अपनी जानकारी देखने, ठीक करने या हटाने के अनुरोध, या शिकायत के लिए ADT (Analog Digital Technologies) को ${PRIVACY_CONTACT_EMAIL} पर ईमेल करें। आप ${PRIVACY_CONTACT_URL} से भी संपर्क कर सकते हैं।`],
    },
  ],
};

export const POLICY: Record<Lang, Policy> = { en, hi };

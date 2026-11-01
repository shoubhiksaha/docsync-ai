import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import Link from 'next/link';
import {
  ArrowRight, BadgeCheck, Calculator, Camera, Check, CopyCheck, Factory, HandHeart, Languages, ListChecks,
  Lock, Mic, Repeat, ScanLine, Scissors, Sheet, ShieldCheck, Store, Truck, Wheat, WifiOff, type LucideIcon,
} from 'lucide-react';
import { limitFor } from '@/core/rate-limit';
import { PROFILE_GROUPS, activeProfiles, comingSoonProfiles, getProfile, localizedProfile, type ProfileGroup } from '@/modules/profiles';
import { serverI18n } from '@/client/i18n/server';
import type { Lang } from '@/client/i18n';
import type { MessageKey } from '@/client/i18n/en';
import { AdtEndorsement } from '@/app/components/AdtEndorsement';
import { Notice } from '@/app/components/ui';
import { DocGroup, HeaderActions, OpenInBrowser, SignInButton, StartLink } from './actions';
import { loginCallbackUrl, loginHref, privacyHref, scanProfileId } from './callback-url';
import { IN_APP_NOTICE_ID, isAndroid, isInAppBrowser } from './in-app-browser';
import { loginErrorMessage } from './login-error';
import { KEEP_EARLY_TAPS, SIGN_IN_STALLED_ID } from './sign-in-gate';
import styles from './login.module.css';

// The page signed-out visitors land on: what DocSync does, shown on a real (fictional) sample
// slip, then the details people need before they hand over a Google sign-in. One action,
// "Sign in with Google", at the top and again at the end.

const GROUP_ICONS: Record<ProfileGroup, LucideIcon> = {
  shops: Store,
  farm: Wheat,
  transport: Truck,
  industry: Factory,
  crafts: Scissors,
  community: HandHeart,
};

const STEPS: { icon: LucideIcon; key: 'step1' | 'step2' | 'step3' }[] = [
  { icon: Camera, key: 'step1' },
  { icon: ListChecks, key: 'step2' },
  { icon: Sheet, key: 'step3' },
];

const FEATURES: { icon: LucideIcon; key: string }[] = [
  { icon: Calculator, key: 'checks' },
  { icon: Mic, key: 'voice' },
  { icon: CopyCheck, key: 'duplicates' },
  { icon: Repeat, key: 'remember' },
  { icon: WifiOff, key: 'offline' },
  { icon: Languages, key: 'language' },
];

const PRIVACY: { icon: LucideIcon; key: string }[] = [
  { icon: Sheet, key: 'sheet' },
  { icon: ShieldCheck, key: 'memory' },
  { icon: Lock, key: 'google' },
];

const FAQ = ['cost', 'limit', 'install', 'wrong', 'handwriting', 'key', 'notion'];

// The sample dairy slip in the hero (public/samples/dairy-collection-slip.jpg) and the row it
// becomes. The two rows above it are earlier, made-up entries in the same sheet. The names stay in
// Latin letters in Hindi too, because that is how the slip writes them and how the row is saved.
const DEMO_ROWS = [
  { name: 'Ramvati', litres: '5.20', fat: '6.2', amount: '₹247.52' },
  { name: 'Mohan Lal', litres: '3.80', fat: '4.1', amount: '₹131.10' },
];
const DEMO_NEW = { name: 'Savitri Devi Yadav', litres: '6.40', fat: '6.8', amount: '₹304.64' };

/**
 * Under each Sign in with Google: Google's next screen has a Sheets and a Drive box, and leaving
 * either unticked means the whole sign-in again. The details are in "What Google will ask".
 */
function ConsentHint({ text, why }: { text: string; why: string }) {
  return (
    <p className={styles.consent}>
      {text} <a href="#privacy">{why}</a>
    </p>
  );
}

/** Marks the words written in the other language's script, so screen readers say them right. */
function MixedScript({ text, lang }: { text: string; lang: Lang }) {
  const other = lang === 'en' ? /([ऀ-ॿ]+)/ : /([A-Za-z]+)/;
  return text.split(other).map((part, i) => (i % 2 ? <span key={i} lang={lang === 'en' ? 'hi' : 'en'}>{part}</span> : part));
}

/** Title and link preview (WhatsApp, social) for the page most shared links end up on. */
export async function generateMetadata(): Promise<Metadata> {
  const { lang, t } = await serverI18n();
  const title = `DocSync AI: ${t('login.title')}`;
  const description = t('login.lead');
  let metadataBase: URL | undefined;
  try {
    metadataBase = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL) : undefined;
  } catch {
    metadataBase = undefined;
  }
  return {
    title,
    description,
    metadataBase,
    // The image is app/login/opengraph-image.png.
    openGraph: { title, description, siteName: 'DocSync AI', type: 'website', locale: lang === 'hi' ? 'hi_IN' : 'en_IN' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string | string[]; callbackUrl?: string | string[] }> }) {
  const [{ lang, t }, query, jar, head] = await Promise.all([serverI18n(), searchParams, cookies(), headers()]);
  const k = (key: string, vars?: Parameters<typeof t>[1]) => t(key as MessageKey, vars);
  const profiles = activeProfiles();
  const callbackUrl = loginCallbackUrl(query, name => jar.get(name)?.value);
  const error = [query.error].flat()[0];
  const userAgent = head.get('user-agent');
  const inAppBrowser = isInAppBrowser(userAgent);

  // Sent here by a shared /scan link, a home-screen shortcut or an ended session: say where the
  // button leads, so the page reads as a step on the way there rather than an advert.
  const resumeProfile = getProfile(scanProfileId(callbackUrl));
  const resume = resumeProfile
    ? t('login.resume.document', { name: localizedProfile(resumeProfile, lang).documentName })
    : callbackUrl !== '/' ? t('login.resume.elsewhere') : null;

  const groups = PROFILE_GROUPS.map(id => {
    const members = profiles.filter(p => p.group === id);
    // Prefer the light, stamped samples in public/samples over older full-size photos.
    const withSample = members.find(p => p.sampleDocument?.href.startsWith('/samples/')) ?? members.find(p => p.sampleDocument);
    return {
      id,
      label: t(`group.${id}`),
      docs: members.map(p => ({ id: p.id, name: localizedProfile(p, lang).documentName })),
      sample: withSample?.sampleDocument?.href,
    };
  });

  return (
    <>
      {/* Before every sign-in control, so a tap on 2G is kept while the page's JavaScript loads. */}
      <script dangerouslySetInnerHTML={{ __html: KEEP_EARLY_TAPS }} />
      <header className={styles.header}>
        <div className={`container ${styles.headerInner}`}>
          <span className={styles.brand}>
            {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG logo */}
            <img src="/icon.svg" alt="" width={32} height={32} />
            DocSync AI
          </span>
          <nav className={styles.sections} aria-label={t('login.nav.label')}>
            <a href="#how">{t('login.nav.how')}</a>
            <a href="#documents">{t('login.nav.documents')}</a>
            <a href="#privacy">{t('login.nav.privacy')}</a>
            <a href="#faq">{t('login.nav.faq')}</a>
          </nav>
          <HeaderActions signInLabel={t('login.signIn')} callbackUrl={callbackUrl} />
        </div>
      </header>

      <main id="main" className={styles.main}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={`container ${styles.heroInner}`}>
            <div className={styles.heroText}>
              {error && (
                <Notice tone="warning" title={t('login.error.title')} urgent>
                  <p>{t(loginErrorMessage(error))}</p>
                </Notice>
              )}
              <p className={styles.eyebrow}>{t('login.eyebrow')}</p>
              <h1 id="hero-title" className={styles.title}>{t('login.title')}</h1>
              <p className={styles.lead}>{t('login.lead')}</p>
              {inAppBrowser && (
                // Every sign-in control points here instead of opening Google (useSignIn).
                <div id={IN_APP_NOTICE_ID} tabIndex={-1} className={styles.inApp}>
                  <Notice tone="warning" title={t('login.inApp.title')}>
                    <p>{t('login.inApp.body')}</p>
                    <OpenInBrowser path={callbackUrl} android={isAndroid(userAgent)} />
                  </Notice>
                </div>
              )}
              <div className={styles.ctaRow}>
                <div className={styles.ctaMain}>
                  {resume && <p className={styles.resume}>{resume}</p>}
                  <SignInButton variant="google" label={t('login.google')} callbackUrl={callbackUrl} />
                  <ConsentHint text={t('login.consent')} why={t('login.consentWhy')} />
                </div>
                <a href="#how" className={styles.secondary}>
                  {t('login.seeHow')}
                  <ArrowRight size={18} aria-hidden />
                </a>
              </div>
              <ul className={styles.points}>
                <li><Check size={18} aria-hidden />{t('login.point.free')}</li>
                <li><Check size={18} aria-hidden />{t('login.point.sheet')}</li>
                <li><Check size={18} aria-hidden />{t('login.point.types', { count: profiles.length })}</li>
                <li><Check size={18} aria-hidden /><span><MixedScript text={t('login.point.languages')} lang={lang} /></span></li>
              </ul>
            </div>

            <figure className={styles.demo}>
              <div className={styles.stage}>
                <div className={styles.photo}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- static sample, shown at its own size */}
                  <img src="/samples/dairy-collection-slip.jpg" alt="" width={535} height={667} fetchPriority="high" />
                  <span className={styles.scanLine} aria-hidden />
                </div>
                <span className={styles.chip}><ScanLine size={16} aria-hidden />{t('login.demo.read', { count: 12 })}</span>
                <div className={styles.sheet}>
                  <p id="demo-sheet" className={styles.sheetBar}><Sheet size={16} aria-hidden />{t('login.demo.sheet')}</p>
                  <table className={styles.table} aria-labelledby="demo-sheet">
                    <thead>
                      <tr>
                        <th scope="col">{t('login.demo.member')}</th>
                        <th scope="col">{t('login.demo.litres')}</th>
                        <th scope="col">{t('login.demo.fat')}</th>
                        <th scope="col">{t('login.demo.amount')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...DEMO_ROWS, DEMO_NEW].map(row => (
                        <tr key={row.name} className={row === DEMO_NEW ? styles.newRow : undefined}>
                          <td>
                            {row.name}
                            {row === DEMO_NEW && <span className="sr-only"> ({t('login.demo.newRow')})</span>}
                          </td>
                          <td>{row.litres}</td>
                          <td>{row.fat}</td>
                          <td>{row.amount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className={styles.checked}><BadgeCheck size={16} aria-hidden />{t('login.demo.checked')}</p>
                </div>
              </div>
              <figcaption className={styles.caption}>{t('login.demo.caption')}</figcaption>
            </figure>
          </div>
        </section>

        <section id="how" className={styles.section} aria-labelledby="how-title">
          <div className="container">
            <h2 id="how-title" className={styles.sectionTitle}>{t('login.how.title')}</h2>
            <p className={styles.sectionLead}>{t('login.how.lead')}</p>
            <ol className={styles.steps}>
              {STEPS.map(({ icon: Icon, key }, i) => (
                <li key={key} className={styles.step}>
                  <span className={styles.stepNumber} aria-hidden>{i + 1}</span>
                  <Icon size={28} className={styles.stepIcon} aria-hidden />
                  <h3>{k(`login.how.${key}.title`)}</h3>
                  <p>{k(`login.how.${key}.body`)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="documents" className={`${styles.section} ${styles.tinted}`} aria-labelledby="documents-title">
          <div className="container">
            <h2 id="documents-title" className={styles.sectionTitle}>{t('login.types.title')}</h2>
            <p className={styles.sectionLead}>{t('login.types.lead', { count: profiles.length })}</p>
            <ul className={styles.groups}>
              {groups.map(({ id, label, docs, sample }) => {
                const Icon = GROUP_ICONS[id];
                return (
                  <li key={id} className={styles.group}>
                    {sample && (
                      /* eslint-disable-next-line @next/next/no-img-element -- static sample thumbnail */
                      <img src={sample} alt="" className={styles.groupImage} width={400} height={160} loading="lazy" />
                    )}
                    <DocGroup
                      title={<><Icon size={20} aria-hidden />{label}</>}
                      count={t('login.types.count', { count: docs.length })}
                    >
                      <ul className={styles.docNames}>
                        {docs.map(doc => (
                          <li key={doc.id}>
                            <StartLink name={doc.name} label={t('login.types.start', { name: doc.name })} callbackUrl={`/scan/${doc.id}`} />
                          </li>
                        ))}
                      </ul>
                    </DocGroup>
                  </li>
                );
              })}
            </ul>
            {comingSoonProfiles.length > 0 && (
              <p className={styles.more}>{t('login.types.more', { count: comingSoonProfiles.length })}</p>
            )}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="features-title">
          <div className="container">
            <h2 id="features-title" className={styles.sectionTitle}>{t('login.features.title')}</h2>
            <p className={styles.sectionLead}>{t('login.features.lead')}</p>
            <ul className={styles.features}>
              {FEATURES.map(({ icon: Icon, key }) => (
                <li key={key} className={styles.feature}>
                  <span className={styles.featureIcon}><Icon size={22} aria-hidden /></span>
                  <h3>{k(`login.features.${key}.title`)}</h3>
                  <p>{k(`login.features.${key}.body`)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="privacy" className={`${styles.section} ${styles.tinted}`} aria-labelledby="privacy-title">
          <div className="container">
            <h2 id="privacy-title" className={styles.sectionTitle}>{t('login.privacy.title')}</h2>
            <p className={styles.sectionLead}>{t('login.privacy.lead')}</p>
            <ul className={styles.privacy}>
              {PRIVACY.map(({ icon: Icon, key }) => (
                <li key={key} className={styles.privacyItem}>
                  <Icon size={24} className={styles.privacyIcon} aria-hidden />
                  <div>
                    <h3>{k(`login.privacy.${key}.title`)}</h3>
                    <p>{k(`login.privacy.${key}.body`)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="faq" className={styles.section} aria-labelledby="faq-title">
          <div className={`container ${styles.narrow}`}>
            <h2 id="faq-title" className={styles.sectionTitle}>{t('login.faq.title')}</h2>
            <div className={styles.faq}>
              {FAQ.map(key => (
                <details key={key} className={styles.question}>
                  <summary>{k(`login.faq.${key}.q`)}</summary>
                  <p>{k(`login.faq.${key}.a`, { count: limitFor('ai'), voice: limitFor('voice') })}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.final} aria-labelledby="final-title">
          <div className={`container ${styles.finalInner}`}>
            <h2 id="final-title" className={styles.sectionTitle}>{t('login.final.title')}</h2>
            <p className={styles.sectionLead}>{t('login.final.body')}</p>
            <SignInButton variant="google" label={t('login.continue')} callbackUrl={callbackUrl} />
            <ConsentHint text={t('login.consent')} why={t('login.consentWhy')} />
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <AdtEndorsement variant="stacked" />
        <Link href={privacyHref(callbackUrl)} className={styles.footerLink}>{t('login.footer.privacy')}</Link>
      </footer>

      {/* Shown by KEEP_EARLY_TAPS when a sign-in tap waited too long for the page's JavaScript. */}
      <p id={SIGN_IN_STALLED_ID} className={styles.stalled} role="alert" hidden suppressHydrationWarning>
        {t('login.stalled')} <a href={loginHref(callbackUrl)}>{t('login.reload')}</a>
      </p>
    </>
  );
}

import { PROFILE_GROUPS, activeProfiles, localizedProfile } from '@/modules/profiles';
import { translate, type Lang, type Translate } from '@/client/i18n';
import type { MessageKey } from '@/client/i18n/en';
import { searchTextFor } from './AppPicker.search';
import type { PickerApp, PickerGroup } from './AppPicker';

const LANGS = ['en', 'hi'] as const;

/**
 * The document types AppPicker lists, in the interface language (Home, and the page a shared photo
 * opens). Built on the server: the profiles stay out of the page's download.
 */
export function pickerApps(lang: Lang, t: Translate): { apps: PickerApp[]; groups: PickerGroup[] } {
  const apps: PickerApp[] = activeProfiles().map(p => {
    const shown = localizedProfile(p, lang);
    const card = `card.${p.id}` as MessageKey;
    // Search both languages, whichever the UI is in: people type "LR" or "दूध" either way.
    const texts = LANGS.map(l => localizedProfile(p, l));
    const search = searchTextFor(
      p.id,
      texts.flatMap(text => [text.title, text.documentName]),
      [...texts.map(text => text.description), ...LANGS.flatMap(l => [translate(l, card), translate(l, `group.${p.group}`)])],
    );
    return { id: p.id, group: p.group, title: shown.title, description: t(card), search };
  });
  const groups: PickerGroup[] = PROFILE_GROUPS.map(id => ({ id, label: t(`group.${id}`) }));
  return { apps, groups };
}

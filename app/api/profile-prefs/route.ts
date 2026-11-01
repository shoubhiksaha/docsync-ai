import { NextRequest, NextResponse } from 'next/server';
import { errorText, resolveCaller, unauthorized } from '@/core/http';
import { getProfile, type DocumentProfile } from '@/modules/profiles';
import { loadAllProfilePrefs, loadProfilePrefs, saveProfilePrefs, type ProfilePrefs } from '@/modules/settings';

/** Per-profile preferences: remembered fields and the duplicate-check field. */

function body(profile: DocumentProfile, prefs: ProfilePrefs) {
  return { profileId: profile.id, ...prefs, defaultPrimaryKey: profile.duplicateKey ?? null };
}

const unknownProfile = () => NextResponse.json({ error: 'Unknown document profile' }, { status: 400 });

/** `?profile=<id>` returns one profile's prefs; no parameter returns `{ profiles: { <id>: … } }` for all of them (Settings). */
export async function GET(req: NextRequest) {
  if (!(await resolveCaller(req))) return unauthorized();
  if (!req.nextUrl.searchParams.has('profile')) {
    const all = await loadAllProfilePrefs(req);
    const profiles = Object.fromEntries(Object.entries(all).flatMap(([id, prefs]) => {
      const profile = getProfile(id);
      return profile ? [[id, body(profile, prefs)]] : [];
    }));
    return NextResponse.json({ profiles });
  }
  const profile = getProfile(req.nextUrl.searchParams.get('profile'));
  if (!profile) return unknownProfile();
  return NextResponse.json(body(profile, await loadProfilePrefs(req, profile.id)));
}

export async function POST(req: NextRequest) {
  if (!(await resolveCaller(req))) return unauthorized();
  const input = await req.json().catch(() => null);
  const profile = getProfile(input?.profileId);
  if (!profile) return unknownProfile();

  const update: Partial<ProfilePrefs> = {};
  if (input.fields === null || Array.isArray(input.fields)) update.fields = input.fields;
  if (input.primaryKey === null || typeof input.primaryKey === 'string') update.primaryKey = input.primaryKey;

  try {
    const response = NextResponse.json({});
    const prefs = await saveProfilePrefs(req, response, profile.id, update);
    const result = NextResponse.json(body(profile, prefs));
    response.cookies.getAll().forEach(c => result.cookies.set(c));
    return result;
  } catch (error) {
    console.error('[profile-prefs] save failed:', errorText(error));
    return NextResponse.json({ error: 'Could not save these preferences. Please try again.' }, { status: 500 });
  }
}

const TTL_MS = 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 500;
const MAX_BYTES = 512 * 1024;

/** GitHub logins: letters, digits and single hyphens, at most 39 characters */
export const isAvatarLogin = (login) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login);

/**
 * Serves GitHub avatars from our own origin. `github.com/<login>.png` answers with a redirect marked `no-cache`, so
 * linking it directly made the browser revalidate and repaint the avatar on every page change (it flickered). Here the
 * image is fetched once, kept in memory and sent with a long cache lifetime.
 *
 * @returns {{ get(login: string): Promise<{ data: Buffer, type: string } | null> }}
 */
export function createAvatarCache(fetchImpl, now = Date.now) {
  const entries = new Map(); // login (lower case) -> { value, expires }; Map order = insertion order
  const pending = new Map();

  async function load(login) {
    try {
      const res = await fetchImpl(`https://github.com/${login}.png?size=64`, { redirect: 'follow', signal: AbortSignal.timeout(5000) });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.startsWith('image/')) return null;
      const data = Buffer.from(await res.arrayBuffer());
      return data.length > MAX_BYTES ? null : { data, type };
    } catch {
      return null;
    }
  }

  return {
    async get(login) {
      const key = login.toLowerCase();
      const hit = entries.get(key);
      if (hit && hit.expires > now()) return hit.value;
      if (!pending.has(key)) {
        pending.set(
          key,
          load(login)
            .then((value) => {
              entries.delete(key);
              entries.set(key, { value, expires: now() + (value ? TTL_MS : MISSING_TTL_MS) });
              if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
              return value;
            })
            .finally(() => pending.delete(key)),
        );
      }
      return pending.get(key);
    },
  };
}

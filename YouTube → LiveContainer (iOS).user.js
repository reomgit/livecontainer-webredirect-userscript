// ==UserScript==
// @name         YouTube → LiveContainer (iOS)
// @namespace    sharmanhall
// @version      0.6
// @description  Redirect YouTube links to LiveContainer so they open directly in the containerized YouTube app.
// @author       sharmanhall
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://youtu.be/*
// @match        *://*/*
// @grant        none
// @license      MIT
// @run-at       document-start
// @noframes
// @downloadURL https://update.greasyfork.org/scripts/550407/YouTube%20%E2%86%92%20LiveContainer%20%28iOS%29.user.js
// @updateURL https://update.greasyfork.org/scripts/550407/YouTube%20%E2%86%92%20LiveContainer%20%28iOS%29.meta.js
// ==/UserScript==

(function () {
  'use strict';

  // ---- prefs ----
  const VERBOSE = true; // set false to quiet logs
  const AUTO_REDIRECT_ON_YOUTUBE_PAGES = true;  // when you're *on* a YouTube page
  const REWRITE_LINKS_ON_ALL_PAGES = true;      // rewrite <a> that point to YouTube anywhere
  const ADD_LC_FLAG = true;                     // append lc=1 to avoid bounce loops
  // Route via the `youtube://` URL scheme so LiveContainer launches the
  // containerized YouTube app directly. Sending the https URL instead would
  // land in LiveContainer's in-app web view, whose WKWebView session is
  // independent of the YouTube app's keychain auth — on cold launch that web
  // view has no Google session and prompts for sign-in. Set this to false to
  // fall back to the old web-view behavior.
  const USE_NATIVE_APP_SCHEME = true;

  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Include root so subdomains (www, m, music, etc.) count; include youtu.be shortlinks.
  const ytHosts = new Set([
    'youtube.com',
    'youtu.be'
  ]);

  function log(...args){ if (VERBOSE) console.log('[LC-YouTube]', ...args); }

  function isYouTubeURL(u) {
    try {
      const url = (u instanceof URL) ? u : new URL(u, location.href);
      return [...ytHosts].some(h => url.hostname === h || url.hostname.endsWith('.' + h));
    } catch { return false; }
  }

  function isYouTubeMusicURL(u) {
    try {
      const url = (u instanceof URL) ? u : new URL(u, location.href);
      return url.hostname === 'music.youtube.com' || url.hostname.endsWith('.music.youtube.com');
    } catch { return false; }
  }

  // Encode for LiveContainer's open-web-page scheme (expects Base64)
  function toBase64(str) {
    try {
      return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
    } catch {
      return btoa(unescape(encodeURIComponent(str)));
    }
  }

  // Normalize to the form the YouTube iOS app accepts: www.youtube.com paths.
  // youtu.be/<id> → www.youtube.com/watch?v=<id>; m./bare youtube.com → www.
  function canonicalizeYouTube(originalUrl) {
    const url = new URL(originalUrl, location.href);
    const host = url.hostname.toLowerCase();

    if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
      const id = url.pathname.replace(/^\/+/, '').split('/')[0];
      if (id) {
        const out = new URL('https://www.youtube.com/watch');
        for (const [k, v] of url.searchParams) {
          if (k !== 'v') out.searchParams.set(k, v);
        }
        out.searchParams.set('v', id);
        out.hash = url.hash;
        return out;
      }
      url.hostname = 'www.youtube.com';
      return url;
    }

    if (host === 'youtube.com' || host === 'm.youtube.com') {
      url.hostname = 'www.youtube.com';
    }
    return url;
  }

  function buildLcUrl(originalUrl) {
    const canon = canonicalizeYouTube(originalUrl);
    if (ADD_LC_FLAG && !canon.searchParams.has('lc')) canon.searchParams.set('lc', '1');

    // Music URLs belong to the YouTube Music app, not YouTube — don't force
    // them through youtube:// (the YouTube app won't route music.youtube.com
    // paths correctly). Fall back to the web-view delivery for those.
    const useAppScheme = USE_NATIVE_APP_SCHEME && !isYouTubeMusicURL(canon);
    const target = useAppScheme
      ? `youtube://${canon.host}${canon.pathname}${canon.search}${canon.hash}`
      : canon.toString();

    return `livecontainer://open-web-page?url=${toBase64(target)}`;
  }

  function redirectToLC(u) {
    const lc = buildLcUrl(u);
    log('Redirecting to LiveContainer:', lc);
    location.replace(lc); // avoid extra history entries
  }

  // 1) If we're on a YouTube page already, bounce to LiveContainer (iOS only)
  if (isIOS && AUTO_REDIRECT_ON_YOUTUBE_PAGES && isYouTubeURL(location.href)) {
    const cur = new URL(location.href);
    if (!cur.searchParams.get('lc')) {
      redirectToLC(location.href);
      return; // stop executing further on this page
    } else {
      log('lc=1 present; skipping auto-redirect to avoid loop.');
    }
  }

  if (!isIOS) return; // iOS-only behavior below

  // Helper to decide which URL to send (some pages expose expanded URLs)
  function resolveTargetHref(a) {
    const expanded = a?.dataset?.expandedUrl || a?.getAttribute?.('data-expanded-url');
    if (expanded && isYouTubeURL(expanded)) return expanded;
    return a?.href || '';
  }

  // 2) Global capture fallback for delegated clicks (robust vs dynamic UIs)
  if (REWRITE_LINKS_ON_ALL_PAGES) {
    document.addEventListener('click', (e) => {
      const a = e.target?.closest?.('a[href]');
      if (!a) return;
      const targetHref = resolveTargetHref(a);
      if (!isYouTubeURL(targetHref)) return;
      try {
        e.preventDefault();
        e.stopPropagation();
        redirectToLC(targetHref);
      } catch (err) {
        log('Error redirecting (global):', err);
      }
    }, { capture: true, passive: false });
  }

  // 3) Per-anchor hook + dynamic observer (helps when sites block global handlers)
  if (REWRITE_LINKS_ON_ALL_PAGES) {
    const processAnchor = (a) => {
      if (!a || !a.href) return;
      if (a.dataset.lcYoutube === '1') return; // double-hook guard
      const targetHref = resolveTargetHref(a);
      if (!isYouTubeURL(targetHref)) return;

      const handler = (e) => {
        try {
          e.preventDefault();
          e.stopPropagation();
          redirectToLC(targetHref);
        } catch (err) {
          log('Error redirecting (anchor):', err);
        }
      };
      a.addEventListener('click', handler, { capture: true, passive: false });
      a.dataset.lcYoutube = '1';
      log('Hooked YouTube link:', targetHref);
    };

    // Initial pass
    document.querySelectorAll('a[href]:not([data-lc-youtube])').forEach(processAnchor);

    // Observe dynamically-added links (SPAs, infinite scroll, etc.)
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'A' && node.href) processAnchor(node);
          else node.querySelectorAll?.('a[href]:not([data-lc-youtube])').forEach(processAnchor);
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
})();

// ==UserScript==
// @name         Twitter/X → LiveContainer (iOS)
// @namespace    sharmanhall
// @version      0.6
// @description  Redirect Twitter/X links (incl. fxtwitter, vxtwitter, fixupx) to LiveContainer so they open in the containerized Twitter app.
// @author       sharmanhall
// @match        https://twitter.com/*
// @match        https://x.com/*
// @match        https://t.co/*
// @match        https://fxtwitter.com/*
// @match        https://fixupx.com/*
// @match        https://vxtwitter.com/*
// @match        https://fixvx.com/*
// @match        *://*/*
// @grant        none
// @license      MIT
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ---- prefs ----
  const VERBOSE = true; // set false to quiet logs
  const AUTO_REDIRECT_ON_TWITTER_PAGES = true;  // when you're *on* a Twitter/X page
  const REWRITE_LINKS_ON_ALL_PAGES = true;      // rewrite <a> that point to Twitter anywhere
  const ADD_LC_FLAG = true;                     // append lc=1 to avoid bounce loops

  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Canonical Twitter hosts
  const twitterHosts = new Set([
    'twitter.com',
    'x.com',
    't.co'
  ]);

  // Third-party embed/proxy frontends — their paths mirror twitter.com/x.com
  const thirdPartyTwitterHosts = new Set([
    'fxtwitter.com',
    'fixupx.com',
    'vxtwitter.com',
    'fixvx.com'
  ]);

  function log(...args) { if (VERBOSE) console.log('[LC-Twitter]', ...args); }

  function isTwitterURL(u) {
    try {
      const url = (u instanceof URL) ? u : new URL(u, location.href);
      const h = url.hostname;
      return [...twitterHosts, ...thirdPartyTwitterHosts].some(
        host => h === host || h.endsWith('.' + host)
      );
    } catch { return false; }
  }

  // Normalize third-party mirrors to canonical x.com URLs so the app sees real links
  function normalizeToTwitter(u) {
    try {
      const url = new URL(u, location.href);
      if (thirdPartyTwitterHosts.has(url.hostname) ||
          [...thirdPartyTwitterHosts].some(h => url.hostname.endsWith('.' + h))) {
        url.hostname = 'x.com';
      }
      return url.toString();
    } catch { return u; }
  }

  // Encode for LiveContainer's open-web-page scheme (expects Base64)
  function toBase64(str) {
    try {
      return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
    } catch {
      return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p) => String.fromCharCode(parseInt(p, 16))));
    }
  }

  function buildLcUrl(originalUrl) {
    const canonical = normalizeToTwitter(originalUrl);
    const url = new URL(canonical, location.href);
    if (ADD_LC_FLAG && !url.searchParams.has('lc')) url.searchParams.set('lc', '1');
    // Route through LiveContainer's open-web-page; Twitter app inside LC will intercept
    return `livecontainer://open-web-page?url=${toBase64(url.toString())}`;
  }

  function redirectToLC(u) {
    const lc = buildLcUrl(u);
    log('Redirecting to LiveContainer:', lc);
    location.replace(lc); // avoid extra history entries
  }

  // 1) If we're on a Twitter/X or third-party mirror page, bounce to LiveContainer (iOS only)
  if (isIOS && AUTO_REDIRECT_ON_TWITTER_PAGES && isTwitterURL(location.href)) {
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
    if (expanded && isTwitterURL(expanded)) return expanded;
    return a?.href || '';
  }

  // 2) Global capture fallback for delegated clicks (robust vs dynamic UIs)
  if (REWRITE_LINKS_ON_ALL_PAGES) {
    document.addEventListener('click', (e) => {
      const a = e.target?.closest?.('a[href]');
      if (!a) return;
      const targetHref = resolveTargetHref(a);
      if (!isTwitterURL(targetHref)) return;
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
      if (a.dataset.lcTwitter === '1') return; // double-hook guard
      const targetHref = resolveTargetHref(a);
      if (!isTwitterURL(targetHref)) return;

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
      a.dataset.lcTwitter = '1';
      log('Hooked Twitter link:', targetHref);
    };

    // Initial pass
    document.querySelectorAll('a[href]:not([data-lc-twitter])').forEach(processAnchor);

    // Observe dynamically-added links (SPAs, infinite scroll, etc.)
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'A' && node.href) processAnchor(node);
          else node.querySelectorAll?.('a[href]:not([data-lc-twitter])').forEach(processAnchor);
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
})();

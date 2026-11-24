# Search Console and Bing

The site build writes `robots.txt` with `Allow: /` and a sitemap covering every HTML page, including forms. `SITE_ORIGIN` sets the public HTTPS origin; the default is the server's existing `https://vowkey.com`. That default does not settle the owner's domain choice. Use the chosen origin consistently in the build, DNS and verification consoles.

From `vowkey-growth`:

```sh
SITE_ORIGIN=https://vowkey.com SECURITY_CONTACT=security@vowkey.com node scripts/build-site.mjs
node scripts/check-site.mjs
scripts/check-security-txt.sh
```

The build needs Node 18+ and Swift/AppKit on macOS for the shared-template social PNGs. It rewrites generated trust pages, metadata, previews, the sitemap, Markdown twins and `llms.txt`. Source copy is `site/trust-*.js`; trust layout is `scripts/trust-catalog.mjs`. Keep the expiry check on the daily operations check rather than relying on rebuilding to renew the contact.

Verification starts after the owner serves the chosen domain and controls its DNS. No Search Console or Bing account, domain or verification has been created by this work.

## Google Search Console

1. Open [Search Console](https://search.google.com/search-console) with the account that should own the property.
2. Add a Domain property for the chosen domain. Domain properties use a DNS TXT record and cover subdomains and protocols. If DNS cannot be changed, use a URL-prefix property for the exact HTTPS origin instead.
3. Publish the TXT value Google supplies, including `google-site-verification=`. Do not invent a token or replace other TXT records. For a URL-prefix property, Google's supplied HTML verification file can instead be placed at the site root. The build preserves files it does not generate.
4. Choose Verify after the record is visible. Retain the proof after verification; Google checks it again.
5. Under Sitemaps submit `<SITE_ORIGIN>/sitemap.xml`. A successful fetch means Google read the sitemap, not that all pages have been indexed.
6. Use URL inspection on the home page, a form page and a trust page. Read indexing exclusions in the Pages report before changing URLs or requesting another crawl.

## Bing Webmaster Tools

1. Open [Bing Webmaster Tools](https://www.bing.com/webmasters) with the owner's Microsoft account.
2. If the same property is already verified in Search Console, choose Import from Google Search Console and review which properties Bing will import.
3. Otherwise add the chosen HTTPS origin. Use the XML file, HTML meta tag or DNS record shown by Bing. For DNS, copy the exact type, name and value from the dashboard; do not assume a TXT `msvalidate.01` record. The XML file is convenient here because the build preserves owner-provided root files. HTML meta verification uses the `msvalidate.01` name and would need to be retained in the page template.
4. Verify, then submit `<SITE_ORIGIN>/sitemap.xml` under Sitemaps. Inspect the same three URLs in Bing's URL inspection tool.

Both properties belong to the owner's accounts. Remove access and its verification proof when an account should no longer control a property.

References: [Google verification](https://support.google.com/webmasters/answer/9008080), [Google properties](https://support.google.com/webmasters/answer/34592), [Bing add and verify](https://www.bing.com/webmasters/help/add-and-verify-site-12184f8b).

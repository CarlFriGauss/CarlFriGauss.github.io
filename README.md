# Carl Friedrich Gauss

Independent essays and mathematics education under a pen name.

The public website is **https://carlfriedrichgauss.com/**. It includes the essay collection, the planned academy and course outlines, and the working browser-based Gaussian Process Explorer. The academy does not yet accept registrations or payments.

## Publish writing and media

Invited authors use the visual writing desk at **https://carlfriedrichgauss.com/write/**. No GitHub account, Markdown file or HTML editing is required. The owner invites authors through Blogger's Settings → Permissions. Authors can edit and publish their own posts; only administrators manage the publication.

Only anonymous, published Atom-feed entries are imported. Draft text and account/profile metadata are excluded. Uploaded media is for public release, not confidential or paid academy materials. Imported raster images are converted to local WebP with metadata removed; allowed video players load only after a reader chooses to load them.

The free GitHub Actions workflow checks for published changes about every ten minutes. Provider delays can occur. It rebuilds the collection, individual essays, RSS and sitemap, then deploys only when content changes. Failed imports or checks preserve the existing deployment. Imported article bodies are delivered as Pages artifacts and are not committed into the public repository.

## Edit and build

Use Node.js 22 or later and the committed lockfile:

```sh
npm ci --ignore-scripts
npm run build
npm run check
```

The homepage and shared layout are in `scripts/build.mjs`; informational pages are in `content/pages.mjs`, and writing pages are in `content/publishing-pages.mjs`. Shared presentation and interactions are in `assets/site.css` and `assets/site.mjs`. The build writes the deployable website to ignored `dist/`; ignored `_publishing/` holds the sanitized working snapshot. The older committed root HTML is the prior static snapshot, not the Actions deployment output. Do not edit generated pages.

Content-security, import behavior and numerical-engine tests:

```sh
npm test
```

To preview, serve `dist/` as the HTTP server root. Links intentionally begin at `/` so the same files work on the custom domain and in a local preview served at its root.

## Privacy and deployment

The public owner/author name is **Carl Friedrich Gauss**. Use the account's GitHub no-reply email for commits. Do not commit personal identifiers, private working reports, backups, credentials, or student information.

The public site has no tracking scripts, payment collection, or on-site account backend. Blogger separately handles invited-author sign-in and editing. The optional colour preference stays in browser local storage; GP observations stay in page memory. Future paid courses, student accounts, private media and discussions require a separately implemented and verified service.

`CNAME` preserves the custom domain. Pages uses the Actions workflow's checked `dist/` artifact. A source change should pass tests, build and local-link checks, then be verified on the live domain. Actions are pinned to reviewed commit IDs; the build has read-only source access, the deployment has Pages/OIDC access, and the separate daily maintenance job can only re-enable scheduled Actions. No source-write credential is required.

Production requires the `PUBLISHING_PRIVACY_HASHES` Actions secret. It holds SHA-256 digests of normalized identifiers and their lengths. Keep the digest list in the repository secret store. The importer logs counts and generic failures. It accepts up to 250 entries, 20 feed pages, 8 MiB per feed response, 200 images, 8 MiB per source image and 64 MiB of source images in one refresh. A failed refresh keeps the current site live.

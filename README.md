# Carl Friedrich Gauss

Independent essays and mathematics education under a pen name.

The public website is **https://carlfriedrichgauss.com/**. It includes the essay collection, the planned academy and course outlines, and the working browser-based Gaussian Process Explorer. The academy does not yet accept registrations or payments.

## Edit and build

No packages need to be installed. Use Node.js 22 or later:

```sh
npm run build
npm run check
```

The homepage and shared layout are in `scripts/build.mjs`; secondary page content is in `content/pages.mjs`. Shared presentation and interactions are in `assets/site.css` and `assets/site.mjs`. The generated HTML is committed so GitHub Pages can serve it directly.

The explorer's numerical module has independent tests:

```sh
npm test
```

To preview, serve this directory as the HTTP server root. Links intentionally begin at `/` so the same files work on the custom domain and in a local preview served at its root.

## Privacy and deployment

The public owner/author name is **Carl Friedrich Gauss**. Use the account's GitHub no-reply email for commits. Do not commit personal identifiers, private working reports, backups, credentials, or student information.

The site has no tracking scripts, payment collection, or account backend. The optional colour preference stays in browser local storage; GP observations stay in page memory. Future paid courses, accounts, private media and discussions require a separately implemented and verified service.

`CNAME` preserves the custom domain. `.nojekyll` makes Pages serve the committed static files. A publishing change should pass the build and local-link checks, then be verified on the live domain.

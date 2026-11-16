# Carl Friedrich Gauss

Independent essays and mathematics education under a pen name.

The public website is **https://carlfriedrichgauss.com/**. It includes the essay collection, the planned academy and course outlines, and the working browser-based Gaussian Process Explorer. The academy does not yet accept registrations or payments.

## Edit and build

Use Node.js 22 or later and the pinned dependencies:

```sh
npm ci
npm run build
npm run build:app
npm run check
npm test
```

The homepage and shared layout are in `scripts/build.mjs`; secondary page content is in `content/pages.mjs`. Shared presentation and interactions are in `assets/site.css` and `assets/site.mjs`. The generated static HTML is committed. `build:app` creates an explicit public asset bundle in `dist/`, including the contributor editor, while excluding credentials and server source.

The explorer's numerical module has independent tests:

```sh
npm test
```

For a static-only preview, serve this directory as the HTTP server root. For the writing desk and API, use `npm run dev` with private local service configuration. Links intentionally begin at `/`.

## Contributor writing desk

`writing/` contains the Tiptap editor. `server/` contains the Cloudflare Worker for authenticated drafts, invitations, publication and resumable R2 media uploads. `supabase/migrations/` contains the reviewed database schema and access policies. Accounts belong to the website; articles are stored in its database and media bucket.

There is no public signup. An active contributor can edit their own drafts; an owner must complete authenticator verification before publishing or managing contributors. Published articles are explicit snapshots, so editing a draft does not silently replace a public article. Video uploads support up to 1 GiB in 8 MiB parts.

Supabase URL, publishable key, server secret, Resend sending key and sender address are server settings. Use `.dev.vars` locally and Worker secrets when deploying. Never put a server key in browser code. Disable public signup in the Supabase project and verify the sending domain before sending invitations. The first owner membership must be established through a trusted project administrator; the website has no public owner-creation endpoint.

## Privacy and deployment

The public owner/author name is **Carl Friedrich Gauss**. Use the account's GitHub no-reply email for commits. Do not commit personal identifiers, private working reports, backups, credentials, or student information.

The site has no advertising or audience-tracking scripts and no payment collection. Contributor sessions use secure HTTP-only cookies. The optional colour preference and unfinished draft recovery copies stay in browser local storage; GP observations stay in page memory. Paid courses, student enrollment and discussions remain future work.

`wrangler.jsonc` defines the full website Worker and private R2 binding. `wrangler-www.jsonc` defines a small canonical-host redirect. Deploy with `npm run deploy` and `npm run deploy:www` after configuring the services and resolving any pre-existing hostname DNS records. The source configuration does not contain service credentials. `CNAME` and `.nojekyll` retain the static GitHub Pages configuration as a separate fallback; that static host cannot run the writing desk API.

Before a release, check the outgoing diff for private identity and secrets, run the relevant tests, build the assets, and verify the preview. Keep original manuscripts and media, and maintain confidential exports outside this repository. A content export does not by itself back up authentication credentials or replace a tested recovery process.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { syncPublished } from './publishing.mjs';

try {
  const configuration = JSON.parse(await readFile('publishing.config.json', 'utf8'));
  const privacyTerms = JSON.parse(process.env.PUBLISHING_PRIVACY_TERMS || '[]');
  const privacyHashes = JSON.parse(process.env.PUBLISHING_PRIVACY_HASHES || '[]');
  const articles = await syncPublished({ feedUrl: configuration.feedUrl, outputDir: path.resolve('_publishing'), privacyTerms, privacyHashes });
  console.log(`Published articles synchronized: ${articles.length}.`);
} catch {
  console.error('Publishing synchronization failed. The current deployment has not been replaced.');
  process.exitCode = 1;
}

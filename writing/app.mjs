import { Editor, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import QRCode from 'qrcode';
import { escapeHtml, renderDocument, safeLink } from '../server/content.mjs';

const element = id => document.getElementById(id);
let session;
let current;
let media = [];
let editor;
let generation = 0;
let savedGeneration = 0;
let savePromise;
let saveTimer;
let uploadController;
let filePurpose = 'image';
let resumeUpload;
let factorId;
let previewing = false;
let settingPassword = false;

function notice(message = '') {
  element('notice').textContent = message;
  element('notice').hidden = !message;
}
function show(panel) {
  for (const id of ['sign-in-panel','password-panel','mfa-panel','dashboard','contributors-panel']) element(id).hidden = id !== panel;
}
async function api(path, method = 'GET', data, options = {}) {
  const headers = {};
  let body;
  if (data instanceof Blob || data instanceof ArrayBuffer) body = data;
  else if (data !== undefined) { body = JSON.stringify(data); headers['Content-Type'] = 'application/json'; }
  const response = await fetch(`/api${path}`, { method, body, headers, credentials: 'same-origin', ...options });
  const result = await response.json().catch(() => ({ error: 'The server could not complete this request.' }));
  if (!response.ok) {
    const error = new Error(result.error || 'The request failed.');
    error.status = response.status;
    throw error;
  }
  return result;
}
function task(callback) {
  return async event => {
    event?.preventDefault();
    notice();
    const button = event?.submitter || (event?.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null);
    if (button) button.disabled = true;
    try { await callback(event); }
    catch (error) { notice(error.message); }
    finally { if (button) button.disabled = false; }
  };
}
function draftKey() { return `gauss-draft:${session.member.id}:${current.id}`; }
function draftInput() {
  return { title: element('article-title').value, summary: element('article-summary').value, document: editor.getJSON(), revision: current.revision };
}
function persistRecovery() {
  try { localStorage.setItem(draftKey(), JSON.stringify({ ...draftInput(), at: Date.now() })); }
  catch { notice('This browser could not keep a recovery copy. Keep the tab open until the server confirms Saved.'); }
}
function changed() {
  generation++;
  element('save-status').textContent = 'Unsaved changes';
  persistRecovery();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveDraft().catch(error => {
    element('save-status').textContent = 'Save needs attention';
    notice(error.message);
  }), 1100);
}
async function saveDraft() {
  if (!current || generation === savedGeneration) return;
  if (savePromise) { await savePromise; return saveDraft(); }
  const savingGeneration = generation;
  const input = draftInput();
  element('save-status').textContent = 'Saving…';
  savePromise = api(`/articles/${current.id}`, 'PUT', input);
  try {
    const result = await savePromise;
    current = result.article;
    savedGeneration = savingGeneration;
    if (generation === savedGeneration) {
      try { localStorage.removeItem(draftKey()); } catch { /* Server save succeeded. */ }
      element('save-status').textContent = 'Saved';
    } else persistRecovery();
  } catch (error) {
    element('save-status').textContent = 'Saved copy needs updating';
    if (error.status === 409) error.message = 'This draft was changed in another tab. Your text remains here and in this browser’s recovery copy. Copy your changes before reopening the latest draft.';
    throw error;
  } finally { savePromise = null; }
  if (generation !== savedGeneration) return saveDraft();
}
function confirmAction(title, text) {
  const dialog = element('confirmation-dialog');
  element('confirmation-title').textContent = title;
  element('confirmation-text').textContent = text;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}

const MediaNode = Node.create({
  name: 'media', group: 'block', atom: true, draggable: true,
  addAttributes() { return { id: { default: null }, articleId: { default: null }, kind: { default: null }, alt: { default: '' }, caption: { default: '' } }; },
  parseHTML() { return [{ tag: 'figure[data-media-id]' }]; },
  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs;
    const src = `/media/${attrs.articleId}/${attrs.id}`;
    let body;
    if (attrs.kind === 'image/webp') body = ['img', { src, alt: attrs.alt }];
    else if (attrs.kind?.startsWith('video/')) body = ['video', { src, controls: '', playsinline: '', preload: 'metadata', 'aria-label': attrs.alt }];
    else body = ['a', { href: src, download: '' }, attrs.alt || 'Download document'];
    const children = [body];
    if (attrs.caption) children.push(['figcaption', {}, attrs.caption]);
    return ['figure', mergeAttributes(HTMLAttributes, { 'data-media-id': attrs.id }), ...children];
  }
});

function updateToolbar(instance = editor) {
  if (!instance) return;
  for (const button of document.querySelectorAll('[data-command]')) {
    const command = button.dataset.command;
    if (!['undo','redo'].includes(command)) button.setAttribute('aria-pressed', String(instance.isActive(command)));
  }
  element('text-style').value = String(instance.getAttributes('heading').level || 0);
}
function makeEditor(document) {
  editor?.destroy();
  editor = new Editor({
    element: element('editor'),
    extensions: [StarterKit.configure({ heading: { levels: [2,3,4] }, link: { openOnClick: false, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer' } } }), Placeholder.configure({ placeholder: 'Start writing…' }), MediaNode],
    content: document,
    editorProps: { attributes: { role: 'textbox', 'aria-label': 'Article body', 'aria-multiline': 'true', spellcheck: 'true' } },
    onUpdate: changed,
    onSelectionUpdate: ({ editor: instance }) => updateToolbar(instance),
    onTransaction: ({ editor: instance }) => updateToolbar(instance)
  });
}
async function listArticles() {
  const { articles } = await api('/articles');
  const list = element('draft-list');
  list.replaceChildren();
  if (!articles.length) { const text = document.createElement('p'); text.textContent = 'Your drafts will appear here.'; text.className = 'muted'; list.append(text); }
  for (const article of articles) {
    const button = document.createElement('button');
    button.className = 'draft-item';
    button.setAttribute('aria-current', String(article.id === current?.id));
    const title = document.createElement('strong'); title.textContent = article.title || 'Untitled article';
    const state = document.createElement('span'); state.textContent = article.submitted ? 'Ready for review' : article.published_at ? 'Published · editable draft' : 'Draft';
    button.append(title, state);
    button.addEventListener('click', task(() => openArticle(article.id)));
    list.append(button);
  }
}
async function openArticle(id) {
  await saveDraft();
  if (uploadController) throw new Error('Pause or finish the current upload before opening another draft.');
  const result = await api(`/articles/${id}`);
  current = result.article; media = result.media;
  generation = 0; savedGeneration = 0;
  let recovery;
  try { recovery = JSON.parse(localStorage.getItem(draftKey())); } catch { recovery = null; }
  const restore = recovery && recovery.revision === current.revision;
  const contents = restore ? recovery : current;
  element('article-title').value = contents.title;
  element('article-summary').value = contents.summary;
  makeEditor(contents.document);
  element('article-panel').hidden = false;
  element('desk-welcome').hidden = true;
  element('save-status').textContent = 'Saved';
  element('publish-button').hidden = session.member.role !== 'owner';
  element('submit-button').hidden = session.member.role === 'owner';
  element('withdraw-button').hidden = session.member.role !== 'owner' || !current.published_at;
  element('retry-publication').hidden = session.member.role !== 'owner' || current.publication_version <= current.synced_version;
  previewing = false;
  element('editor-fields').hidden = false;
  element('article-preview').hidden = true;
  element('preview-button').textContent = 'Preview';
  if (restore) { changed(); notice('Recovered changes from this browser. Saving them to your draft.'); }
  else if (recovery) notice('This browser has an older recovery copy. The latest server draft is open.');
  await listArticles();
  pendingUploads();
}
async function initializeSession() {
  session = await api('/session');
  element('sign-out').hidden = !session.member;
  element('signed-in-name').textContent = session.member?.byline || '';
  if (!session.member) { show('sign-in-panel'); return; }
  if (session.member.role === 'owner' && !session.verified) {
    show('mfa-panel');
    const factor = session.factors.find(item => item.status === 'verified');
    if (factor) { factorId = factor.id; element('mfa-enrollment').hidden = true; }
    else {
      const enrollment = await api('/mfa/enroll', 'POST', {});
      factorId = enrollment.id;
      element('mfa-secret').textContent = enrollment.secret;
      await QRCode.toCanvas(element('mfa-qr'), enrollment.uri, { width: 220, margin: 2 });
      element('mfa-enrollment').hidden = false;
    }
    return;
  }
  if (settingPassword) { show('password-panel'); return; }
  show('dashboard');
  element('contributors-button').hidden = session.member.role !== 'owner';
  await listArticles();
}

element('sign-in-form').addEventListener('submit', task(async () => {
  await api('/login', 'POST', { email: element('login-email').value.trim(), password: element('login-password').value });
  element('login-password').value = '';
  await initializeSession();
}));
element('forgot-password').addEventListener('click', task(async () => {
  const email = element('login-email').value.trim();
  if (!email) throw new Error('Enter your email address first.');
  await api('/recover', 'POST', { email });
  notice('If this email belongs to an active contributor, a password reset link is on its way.');
}));
element('password-form').addEventListener('submit', task(async () => {
  await api('/password', 'POST', { password: element('new-password').value });
  element('new-password').value = '';
  settingPassword = false;
  await initializeSession();
}));
element('mfa-form').addEventListener('submit', task(async () => {
  await api('/mfa/verify', 'POST', { factorId, code: element('mfa-code').value });
  element('mfa-code').value = ''; element('mfa-secret').textContent = '';
  await initializeSession();
}));
element('sign-out').addEventListener('click', task(async () => {
  await saveDraft();
  uploadController?.abort();
  await api('/logout', 'POST', {});
  editor?.destroy(); editor = null; current = null;
  element('article-panel').hidden = true; element('desk-welcome').hidden = false;
  await initializeSession();
}));
element('new-article').addEventListener('click', task(async () => {
  await saveDraft();
  const { article } = await api('/articles', 'POST', {});
  await openArticle(article.id);
  element('article-title').focus();
}));
for (const id of ['article-title','article-summary']) element(id).addEventListener('input', changed);
element('save-button').addEventListener('click', task(async () => { await saveDraft(); await listArticles(); }));
element('toolbar').addEventListener('mousedown', event => { if (event.target.closest('button[data-command]')) event.preventDefault(); });
element('toolbar').addEventListener('click', event => {
  const command = event.target.closest('[data-command]')?.dataset.command;
  const method = { bold: 'toggleBold', italic: 'toggleItalic', underline: 'toggleUnderline', bulletList: 'toggleBulletList', orderedList: 'toggleOrderedList', blockquote: 'toggleBlockquote', codeBlock: 'toggleCodeBlock', undo: 'undo', redo: 'redo' }[command];
  if (method) editor.chain().focus()[method]().run();
});
element('text-style').addEventListener('change', event => {
  const level = Number(event.target.value);
  if (level) editor.chain().focus().setHeading({ level }).run();
  else editor.chain().focus().setParagraph().run();
});
element('link-button').addEventListener('click', () => {
  element('link-url').value = editor.getAttributes('link').href || '';
  element('link-dialog').returnValue = '';
  element('link-dialog').showModal();
});
element('link-dialog').addEventListener('close', () => {
  if (element('link-dialog').returnValue !== 'apply') return;
  const href = safeLink(element('link-url').value.trim());
  if (!href) { notice('Enter a valid web address.'); return; }
  editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
});
element('preview-button').addEventListener('click', task(async () => {
  previewing = !previewing;
  if (previewing) {
    const { html } = renderDocument(editor.getJSON(), current.id, media);
    element('article-preview').innerHTML = `<p class="eyebrow">Article preview</p><h1>${escapeHtml(element('article-title').value)}</h1><p class="lede">${escapeHtml(element('article-summary').value)}</p>${html}`;
  }
  element('editor-fields').hidden = previewing;
  element('article-preview').hidden = !previewing;
  element('preview-button').textContent = previewing ? 'Continue editing' : 'Preview';
}));
element('submit-button').addEventListener('click', task(async () => {
  await saveDraft();
  await api(`/articles/${current.id}/submit`, 'POST', { revision: current.revision });
  notice('Submitted for review. Your draft is saved.');
  await listArticles();
}));
async function publish(withdraw = false) {
  await saveDraft();
  if (!await confirmAction(withdraw ? 'Unpublish this article?' : 'Publish this article?', withdraw ? 'The article and its media will be removed from the public website.' : 'This revision and its attached media will become publicly available on the website.')) return;
  await api(`/articles/${current.id}/publish`, 'POST', { revision: current.revision, withdraw });
  notice(withdraw ? 'The article has been unpublished.' : 'Your article is published.');
  await openArticle(current.id);
}
element('publish-button').addEventListener('click', task(() => publish()));
element('withdraw-button').addEventListener('click', task(() => publish(true)));
element('retry-publication').addEventListener('click', task(async () => { await api(`/articles/${current.id}/sync`, 'POST', {}); await openArticle(current.id); notice('The publication update is complete.'); }));

async function imageFile(file) {
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose an image smaller than 25 MB.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.9));
  if (!blob) throw new Error('This image could not be prepared.');
  return blob;
}
async function fingerprint(file) {
  const sample = new Blob([file.slice(0,65536), file.slice(Math.max(0,file.size-65536)), String(file.size)]);
  const digest = await crypto.subtle.digest('SHA-256', await sample.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function pickFile(purpose, resume = null) {
  filePurpose = purpose; resumeUpload = resume;
  element('file-picker').accept = purpose === 'image' ? 'image/jpeg,image/png,image/webp' : purpose === 'video' ? 'video/mp4,video/webm' : 'application/pdf';
  element('file-picker').value = '';
  element('file-picker').click();
}
element('image-button').addEventListener('click', () => pickFile('image'));
element('video-button').addEventListener('click', () => pickFile('video'));
element('file-button').addEventListener('click', () => pickFile('file'));
element('cancel-upload').addEventListener('click', () => uploadController?.abort());

async function insertMedia(item) {
  element('media-alt').value = ''; element('media-caption').value = '';
  const dialog = element('media-dialog'); dialog.returnValue = ''; dialog.showModal();
  const insert = await new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'insert'), { once: true }));
  if (!insert) return;
  editor.chain().focus().insertContent({ type: 'media', attrs: { id: item.id, articleId: current.id, kind: item.kind, alt: element('media-alt').value, caption: element('media-caption').value } }).run();
  await saveDraft();
  pendingUploads();
}
function pendingUploads() {
  const target = element('pending-uploads'); target.replaceChildren();
  const documentText = JSON.stringify(editor?.getJSON() || {});
  for (const item of media.filter(item => item.state === 'uploading' || !documentText.includes(item.id))) {
    const row = document.createElement('div'); row.className = 'pending-upload';
    const text = document.createElement('span'); text.textContent = `${item.kind.startsWith('video/') ? 'Video' : item.kind === 'image/webp' ? 'Image' : 'Document'} · ${(item.size / 1048576).toFixed(1)} MB · ${item.state === 'ready' ? 'Ready to insert' : 'Upload paused'}`;
    const button = document.createElement('button'); button.className = 'quiet-button'; button.textContent = item.state === 'ready' ? 'Insert' : 'Select file to resume';
    button.addEventListener('click', task(() => item.state === 'ready' ? insertMedia(item) : pickFile(item.kind === 'image/webp' ? 'image' : item.kind.startsWith('video/') ? 'video' : 'file', item)));
    row.append(text, button);
    if (item.state === 'uploading') {
      const discard = document.createElement('button'); discard.className = 'quiet-button'; discard.textContent = 'Discard upload';
      discard.addEventListener('click', task(async () => {
        if (uploadController) throw new Error('Pause the upload first.');
        if (!await confirmAction('Discard this upload?', 'The unfinished upload will be removed. You can upload the file again later.')) return;
        await api(`/uploads/${item.id}`, 'DELETE');
        media = media.filter(candidate => candidate.id !== item.id); pendingUploads();
      }));
      row.append(discard);
    }
    target.append(row);
  }
}
element('file-picker').addEventListener('change', task(async () => {
  const selected = element('file-picker').files[0];
  if (!selected) return;
  if (uploadController) throw new Error('Finish or pause the current upload first.');
  await saveDraft();
  const file = filePurpose === 'image' ? await imageFile(selected) : selected;
  if (file.size > 1073741824) throw new Error('Choose a video of 1 GB or smaller.');
  const fileFingerprint = await fingerprint(file);
  let upload = resumeUpload ? await api(`/uploads/${resumeUpload.id}`) : await api('/uploads', 'POST', { articleId: current.id, kind: file.type, size: file.size, fingerprint: fileFingerprint });
  if (upload.fingerprint !== fileFingerprint) throw new Error('Choose the same file to resume this upload.');
  if (!media.some(item => item.id === upload.id)) media.push(upload);
  uploadController = new AbortController();
  element('upload-status').hidden = false;
  element('upload-message').textContent = 'Uploading… You can continue writing.';
  try {
    const total = Math.ceil(file.size / upload.partSize);
    for (let part = 1; part <= total; part++) {
      if (!upload.parts[String(part)]) await api(`/uploads/${upload.id}/parts/${part}`, 'PUT', file.slice((part-1)*upload.partSize, Math.min(part*upload.partSize,file.size)), { signal: uploadController.signal });
      element('upload-progress').value = part / total * 100;
    }
    const result = await api(`/uploads/${upload.id}/complete`, 'POST', {});
    media = media.map(item => item.id === upload.id ? result.media : item);
    uploadController = null;
    await insertMedia(result.media);
  } catch (error) {
    if (error.name === 'AbortError') notice('Upload paused. Select the same file to resume it.');
    else notice(`Upload paused. ${error.message} Select the same file to retry.`);
  } finally { uploadController = null; element('upload-status').hidden = true; pendingUploads(); }
}));

async function contributors() {
  await saveDraft();
  const { members } = await api('/contributors');
  const target = element('contributors-list'); target.replaceChildren();
  for (const member of members) {
    const row = document.createElement('div'); row.className = 'contributor-row';
    const text = document.createElement('span'); text.textContent = `${member.byline} · ${member.role === 'owner' ? 'Owner' : member.active ? 'Active' : 'Access revoked'}`;
    row.append(text);
    if (member.role !== 'owner') {
      const button = document.createElement('button'); button.className = 'quiet-button'; button.textContent = member.active ? 'Revoke access' : 'Restore access';
      button.addEventListener('click', task(async () => {
        if (!await confirmAction(button.textContent + '?', `${member.byline} ${member.active ? 'will lose access to the writing desk.' : 'will regain access to the writing desk.'}`)) return;
        await api(`/contributors/${member.id}`, 'PATCH', { active: !member.active }); await contributors();
      }));
      row.append(button);
      if (member.active) {
        const resend = document.createElement('button'); resend.className = 'quiet-button'; resend.textContent = 'Send account link';
        resend.addEventListener('click', task(async () => { await api(`/contributors/${member.id}/invite`, 'POST', {}); notice('Account setup link sent.'); }));
        row.append(resend);
      }
    }
    target.append(row);
  }
  show('contributors-panel');
}
element('contributors-button').addEventListener('click', task(contributors));
element('back-to-writing').addEventListener('click', () => show('dashboard'));
element('invite-form').addEventListener('submit', task(async () => {
  await api('/contributors', 'POST', { email: element('invite-email').value.trim(), byline: element('invite-byline').value.trim() });
  element('invite-form').reset(); notice('Invitation sent.'); await contributors();
}));
window.addEventListener('beforeunload', event => { if (generation !== savedGeneration || uploadController) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('online', () => { if (current) saveDraft().catch(error => notice(error.message)); });
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 's' && current) { event.preventDefault(); saveDraft().catch(error => notice(error.message)); } });

async function start() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has('token_hash')) {
    history.replaceState(null, '', location.pathname);
    await api('/accept', 'POST', { token_hash: params.get('token_hash'), type: params.get('type') });
    settingPassword = true;
    await initializeSession();
  } else await initializeSession();
}
start().catch(error => { show('sign-in-panel'); notice(error.message); });

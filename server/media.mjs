import { adminClient, databaseResult, identify, readJson, RequestError } from './auth.mjs';
import { UUID } from './content.mjs';

export const PART_SIZE = 8 * 1024 * 1024;
export const MAX_FILE_SIZE = 1024 * 1024 * 1024;
const limits = { 'image/webp': 12 * 1024 * 1024, 'video/mp4': MAX_FILE_SIZE, 'video/webm': MAX_FILE_SIZE, 'application/pdf': 20 * 1024 * 1024 };
export const mediaKey = media => `media/${media.article_id}/${media.id}`;

async function editableMedia(context) {
  const identity = await identify(context);
  const id = context.req.param('id');
  if (!UUID.test(id)) throw new RequestError(404, 'Upload unavailable.');
  const media = databaseResult(await identity.client.from('media').select('*').eq('id', id).maybeSingle());
  if (!media) throw new RequestError(404, 'Upload unavailable.');
  return { ...identity, media, admin: adminClient(context.env) };
}

export function checkFileHeader(bytes, kind) {
  const ascii = (start, end) => new TextDecoder().decode(bytes.slice(start, end));
  if (kind === 'image/webp') return ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP';
  if (kind === 'video/mp4') return ascii(4,8) === 'ftyp';
  if (kind === 'video/webm') return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (kind === 'application/pdf') return ascii(0,5) === '%PDF-';
  return false;
}

export function stripWebpMetadata(input) {
  const bytes = new Uint8Array(input);
  if (!checkFileHeader(bytes, 'image/webp')) throw new RequestError(400, 'Invalid image.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  let length = 12;
  let hasImage = false;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new RequestError(400, 'Invalid image.');
    const tag = new TextDecoder().decode(bytes.slice(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size + size % 2;
    if (end > bytes.length) throw new RequestError(400, 'Invalid image.');
    if (['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ICCP'].includes(tag)) {
      const chunk = bytes.slice(offset, end);
      if (tag === 'VP8X') {
        if (size < 10) throw new RequestError(400, 'Invalid image.');
        chunk[8] &= ~0x0c;
        const width = 1 + chunk[12] + (chunk[13] << 8) + (chunk[14] << 16);
        const height = 1 + chunk[15] + (chunk[16] << 8) + (chunk[17] << 16);
        if (width * height > 32000000) throw new RequestError(400, 'Image dimensions are too large.');
      }
      if (tag === 'VP8 ' || tag === 'VP8L') hasImage = true;
      chunks.push(chunk); length += chunk.length;
    }
    offset = end;
  }
  if (!hasImage) throw new RequestError(400, 'Unsupported image.');
  const cleaned = new Uint8Array(length);
  cleaned.set(bytes.slice(0, 12));
  new DataView(cleaned.buffer).setUint32(4, length - 8, true);
  let offset = 12;
  for (const chunk of chunks) { cleaned.set(chunk, offset); offset += chunk.length; }
  return cleaned;
}

export function mediaRoutes(app) {
  app.post('/api/uploads', async context => {
    const { client } = await identify(context);
    const input = await readJson(context, 2000);
    if (!UUID.test(input.articleId) || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > (limits[input.kind] || 0)) throw new RequestError(400, 'Unsupported file type or size.');
    if (!/^[a-f0-9]{64}$/.test(input.fingerprint)) throw new RequestError(400, 'Invalid upload fingerprint.');
    const media = databaseResult(await client.rpc('reserve_media', { article: input.articleId, file_kind: input.kind, file_size: input.size, file_fingerprint: input.fingerprint }));
    const admin = adminClient(context.env);
    let upload;
    try {
      upload = await context.env.MEDIA.createMultipartUpload(mediaKey(media), { httpMetadata: { contentType: input.kind } });
      databaseResult(await admin.from('media').update({ upload_id: upload.uploadId }).eq('id', media.id));
      return context.json({ ...media, upload_id: undefined, partSize: PART_SIZE });
    } catch (error) {
      if (upload) { try { await upload.abort(); } catch { /* R2 lifecycle also expires unfinished multipart uploads. */ } }
      await admin.from('media').update({ state: 'cancelled' }).eq('id', media.id);
      throw error;
    }
  });

  app.get('/api/uploads/:id', async context => {
    const { media } = await editableMedia(context);
    return context.json({ ...media, upload_id: undefined, partSize: PART_SIZE });
  });

  app.put('/api/uploads/:id/parts/:part', async context => {
    const { media, admin } = await editableMedia(context);
    const part = Number(context.req.param('part'));
    const totalParts = Math.ceil(media.size / PART_SIZE);
    if (media.state !== 'uploading' || !media.upload_id || !Number.isInteger(part) || part < 1 || part > totalParts) throw new RequestError(409, 'Upload is not accepting this part.');
    const expectedSize = part === totalParts ? media.size - PART_SIZE * (part - 1) : PART_SIZE;
    const bytes = await context.req.arrayBuffer();
    if (bytes.byteLength !== expectedSize) throw new RequestError(400, 'Upload part has the wrong size.');
    if (part === 1 && !checkFileHeader(new Uint8Array(bytes), media.kind)) throw new RequestError(400, 'The file contents do not match the selected format.');
    const upload = context.env.MEDIA.resumeMultipartUpload(mediaKey(media), media.upload_id);
    const result = await upload.uploadPart(part, bytes);
    databaseResult(await admin.rpc('record_upload_part', { media_id: media.id, part_number: part, part_etag: result.etag }));
    return context.json({ part, complete: true });
  });

  app.post('/api/uploads/:id/complete', async context => {
    const { media, admin } = await editableMedia(context);
    if (media.state === 'ready') return context.json({ media: { ...media, upload_id: undefined } });
    if (media.state !== 'uploading') throw new RequestError(409, 'Upload was cancelled.');
    const key = mediaKey(media);
    let object = await context.env.MEDIA.head(key);
    if (!object) {
      const parts = Object.entries(media.parts).map(([number, etag]) => ({ partNumber: Number(number), etag })).sort((a,b) => a.partNumber - b.partNumber);
      if (parts.length !== Math.ceil(media.size / PART_SIZE)) throw new RequestError(409, 'Some upload parts are missing.');
      const upload = context.env.MEDIA.resumeMultipartUpload(key, media.upload_id);
      object = await upload.complete(parts);
    }
    if (object.size !== media.size && !object.customMetadata?.cleaned) throw new RequestError(400, 'The completed file has the wrong size.');
    if (media.kind === 'image/webp' && !object.customMetadata?.cleaned) {
      const original = await context.env.MEDIA.get(key);
      const cleaned = stripWebpMetadata(await original.arrayBuffer());
      await context.env.MEDIA.put(key, cleaned, { httpMetadata: { contentType: 'image/webp' }, customMetadata: { cleaned: 'true' } });
    }
    databaseResult(await admin.from('media').update({ state: 'ready' }).eq('id', media.id));
    return context.json({ media: { ...media, state: 'ready', upload_id: undefined } });
  });

  app.delete('/api/uploads/:id', async context => {
    const { media, admin } = await editableMedia(context);
    if (media.state === 'ready') throw new RequestError(409, 'Only unfinished uploads can be cancelled.');
    if (media.upload_id) await context.env.MEDIA.resumeMultipartUpload(mediaKey(media), media.upload_id).abort();
    await context.env.MEDIA.delete(mediaKey(media));
    databaseResult(await admin.from('media').update({ state: 'cancelled' }).eq('id', media.id));
    return context.json({ cancelled: true });
  });
}

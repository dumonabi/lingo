import fs from 'fs/promises';
import path from 'path';
import { getRuntimeDataRoot } from './data-paths.js';

function blobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function localFilePath(key) {
  return path.join(getRuntimeDataRoot(), key);
}

async function readBlobText(key) {
  const { get, BlobNotFoundError } = await import('@vercel/blob');
  try {
    const result = await get(key, { access: 'private' });
    if (result.statusCode !== 200 || !result.stream) return null;
    return await new Response(result.stream).text();
  } catch (err) {
    if (err?.name === 'BlobNotFoundError' || err?.constructor?.name === 'BlobNotFoundError') {
      return null;
    }
    throw err;
  }
}

async function readBlobBuffer(key) {
  const { get } = await import('@vercel/blob');
  try {
    const result = await get(key, { access: 'private' });
    if (result.statusCode !== 200 || !result.stream) return null;
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  } catch (err) {
    if (err?.name === 'BlobNotFoundError' || err?.constructor?.name === 'BlobNotFoundError') {
      return null;
    }
    throw err;
  }
}

async function writeBlob(key, body, contentType) {
  const { put } = await import('@vercel/blob');
  await put(key, body, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
  });
}

async function deleteBlobPrefix(prefix) {
  const { list, del } = await import('@vercel/blob');
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    if (page.blobs.length) {
      await del(page.blobs.map((blob) => blob.url));
    }
    cursor = page.cursor;
  } while (cursor);
}

export function isPersistentBlobEnabled() {
  return blobEnabled();
}

export async function readText(key) {
  if (blobEnabled()) {
    return readBlobText(key);
  }
  try {
    return await fs.readFile(localFilePath(key), 'utf8');
  } catch {
    return null;
  }
}

export async function writeText(key, text) {
  if (blobEnabled()) {
    await writeBlob(key, text, 'application/json; charset=utf-8');
    return;
  }
  const filePath = localFilePath(key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

export async function readBuffer(key) {
  if (blobEnabled()) {
    return readBlobBuffer(key);
  }
  try {
    return await fs.readFile(localFilePath(key));
  } catch {
    return null;
  }
}

export async function writeBuffer(key, buffer, contentType = 'application/octet-stream') {
  if (blobEnabled()) {
    await writeBlob(key, buffer, contentType);
    return;
  }
  const filePath = localFilePath(key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
}

export async function deleteFile(key) {
  if (blobEnabled()) {
    const { del } = await import('@vercel/blob');
    try {
      await del(key);
    } catch {
      // ignore missing blob
    }
    return;
  }
  try {
    await fs.unlink(localFilePath(key));
  } catch {
    // ignore missing file
  }
}

export async function deletePrefix(prefix) {
  if (blobEnabled()) {
    await deleteBlobPrefix(prefix);
    return;
  }
  try {
    await fs.rm(localFilePath(prefix), { recursive: true, force: true });
  } catch {
    // ignore missing directory
  }
}

export async function fileExists(key) {
  if (blobEnabled()) {
    const { head } = await import('@vercel/blob');
    try {
      await head(key);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await fs.access(localFilePath(key));
    return true;
  } catch {
    return false;
  }
}

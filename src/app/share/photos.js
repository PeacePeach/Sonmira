// Save to Photos in the iOS app (ios/App/App/SonmiraPhotosPlugin.swift).
// The file goes to the native side in base64 chunks and is added to the
// photo library unchanged. Builds without the plugin (TestFlight build 3 and
// older) report it unavailable, and the share sheet keeps its old path.

import { isNativeIOS, nativePlugin } from '../native/platform.js';

const NAME = 'SonmiraPhotos';
const CHUNK = 3 * 256 * 1024; // bytes per bridge call (a multiple of 3: whole base64 groups)

export class PhotosError extends Error {
  /** @param {'denied'|'unavailable'|'failed'} kind */
  constructor(kind, cause) { super(kind); this.kind = kind; this.cause = cause; }
}

export const photosAvailable = () => isNativeIOS() && !!globalThis.Capacitor?.isPluginAvailable?.(NAME);

function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Adds a JPG or MP4 to Photos. Resolves once it is saved.
 * @param {File} file
 * @throws {PhotosError}
 */
export async function saveToPhotos(file, plugin = nativePlugin(NAME)) {
  if (!plugin) throw new PhotosError('unavailable');
  const kind = file.type.startsWith('video') ? 'video' : 'image';
  const ext = (file.name.split('.').pop() || (kind === 'video' ? 'mp4' : 'jpg')).toLowerCase();
  let id;
  try {
    ({ id } = await plugin.begin({ kind, ext }));
    for (let at = 0; at < file.size; at += CHUNK) {
      const bytes = new Uint8Array(await file.slice(at, at + CHUNK).arrayBuffer());
      await plugin.append({ id, data: base64(bytes) });
    }
  } catch (e) {
    if (id) plugin.discard({ id }).catch(() => {});
    throw new PhotosError(e?.code === 'UNIMPLEMENTED' ? 'unavailable' : 'failed', e);
  }
  try { await plugin.finish({ id }); }
  catch (e) { throw new PhotosError(e?.code === 'denied' ? 'denied' : 'failed', e); }
}

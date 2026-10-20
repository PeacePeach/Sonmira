// Hands a finished file to the system share sheet (Web Share API — on iPhone
// this is the native iOS share sheet: Save Image, Messages, Instagram…).
// Where the browser can't share files, the file is saved instead.

import { isNativeIOS } from '../native/platform.js';

export function canShareFiles(sample) {
  try { return !!navigator.canShare?.({ files: [sample] }); } catch { return false; }
}

/**
 * Call directly from a tap: browsers only open the share sheet during a user gesture.
 * @returns {Promise<'shared'|'cancelled'|'saved'>}
 */
export async function deliverFile(file) {
  if (canShareFiles(file)) {
    try { await navigator.share({ files: [file] }); return 'shared'; }
    catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
      throw e;
    }
  }
  return saveFile(file);
}

/**
 * Saves the file as a browser download (in Safari, Downloads or Files).
 * Browsers only: the iOS app saves to Photos (photos.js) and never comes
 * here, so Save there can't turn into the share sheet.
 * @returns {Promise<'saved'>}
 */
export async function saveFile(file) {
  if (isNativeIOS()) throw new Error('saveFile is for browsers; the iOS app saves to Photos');
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'saved';
}

export const fileName = (date, ext, variant = '') => `sonmira-${date}${variant ? `-${variant}` : ''}.${ext}`;

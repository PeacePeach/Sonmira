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
 * Saves the file to the device (a download; in Safari, Downloads or Files).
 * In the iOS app, where the web view can't download, it opens the share
 * sheet instead, whose first row is Save Image.
 * @returns {Promise<'saved'|'shared'|'cancelled'>}
 */
export async function saveFile(file) {
  if (isNativeIOS() && canShareFiles(file)) return deliverFile(file);
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'saved';
}

export const fileName = (date, ext, variant = '') => `sonmira-${date}${variant ? `-${variant}` : ''}.${ext}`;

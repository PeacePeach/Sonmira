// Hands a finished file to the system share sheet (Web Share API — on iPhone
// this is the native iOS share sheet: Save Image, Messages, Instagram…).
// Where the browser can't share files, the file is saved instead.

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
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'saved';
}

export const fileName = (date, ext) => `sonmira-${date}.${ext}`;

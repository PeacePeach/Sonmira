// Launch screen (index.html #launch): shown from the first paint until the
// diary is in, then faded out and removed. Startup only; no minimum time.

export async function hideLaunch() {
  const el = document.getElementById('launch');
  if (!el) return;
  // The diary's text in its own fonts, not a fallback that swaps in after.
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 400))]).catch(() => {});
  // Let the diary paint once under the launch screen before it fades.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  el.classList.add('done');
  const remove = () => el.remove();
  el.addEventListener('transitionend', (e) => { if (e.target === el) remove(); });
  setTimeout(remove, 800);
}

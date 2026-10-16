"""Measure the style references and write src/engine/art/annotations.json.

Usage: python3 tools/annotate_refs.py <handoff_dir>
  <handoff_dir> holds reference_manifest.json and references/ (the user's
  Sonmira_Art_Engine_Handoff_v2). The reference images are NOT stored in this
  repository; only their measurements and observations are.

Measured (computed here, per region of interest so captions, watermarks,
collage gutters and UI chrome are left out):
  palette        6 k-means colours with weights
  value          mean / contrast of lightness
  saturation     mean HSV saturation
  whitespace     share of near-white, unsaturated pixels (paper left open)
  edge_density   mean Sobel gradient of lightness (crisp edges and detail)
  fine_texture   std of lightness minus a 4 px blur (grain, granulation, marks)
  structure      share of lightness variance that survives a 16 px blur
                 (large, organised forms vs. all-over texture)
Observed (written by hand from looking at each image, in OBSERVATIONS below).
"""
import json, hashlib, sys, os
import numpy as np
from PIL import Image, ImageFilter

# region(s) of interest as [x0, y0, x1, y1] fractions of the image
ROI = {
  'loose_01': [[.06,.06,.26,.29],[.40,.06,.60,.29],[.74,.06,.94,.29],[.06,.39,.26,.62],[.40,.39,.60,.62],[.74,.39,.94,.62],[.06,.73,.26,.95],[.40,.73,.60,.95],[.74,.73,.94,.95]],
  'loose_03': [[.11,.11,.89,.89]],
  'gathered_01': [[.03,.03,.99,.32],[.03,.35,.99,.65],[.03,.68,.99,.98]],
  'gathered_05': [[.03,.03,.99,.32],[.03,.35,.99,.65],[.03,.68,.99,.98]],
  'resolved_01': [[0,0,1,.95]],
  'resolved_05': [[0,0,1,.62]],
  'resolved_07': [[0,.04,1,.88]],
  'resolved_10': [[0,0,1,.93]],
}

def kmeans(px, k=6, iters=12, seed=0):
  rng = np.random.default_rng(seed)
  c = px[rng.choice(len(px), k, replace=False)]
  for _ in range(iters):
    d = ((px[:, None, :] - c[None]) ** 2).sum(-1)
    lab = d.argmin(1)
    for j in range(k):
      m = px[lab == j]
      if len(m): c[j] = m.mean(0)
  w = np.bincount(lab, minlength=k) / len(px)
  order = np.argsort(-w)
  return c[order], w[order]

def measure(img):
  img = img.convert('RGB'); img.thumbnail((320, 320))
  a = np.asarray(img).astype(np.float32) / 255
  L = 0.2126*a[...,0] + 0.7152*a[...,1] + 0.0722*a[...,2]
  mx, mn = a.max(-1), a.min(-1)
  sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
  gimg = Image.fromarray((L*255).astype(np.uint8))
  b4 = np.asarray(gimg.filter(ImageFilter.GaussianBlur(4))).astype(np.float32)/255
  b16 = np.asarray(gimg.filter(ImageFilter.GaussianBlur(16))).astype(np.float32)/255
  gx = np.abs(np.diff(L, axis=1)).mean(); gy = np.abs(np.diff(L, axis=0)).mean()
  pal, w = kmeans(a.reshape(-1, 3)[::3].copy())
  return dict(
    value_mean=float(L.mean()), value_contrast=float(np.percentile(L,95)-np.percentile(L,5)),
    saturation=float(sat.mean()), whitespace=float(((L > .86) & (sat < .12)).mean()),
    edge_density=float(gx+gy), fine_texture=float((L-b4).std()),
    structure=float(b16.var()/max(L.var(),1e-6)),
    palette=[{'hex': '#%02x%02x%02x' % tuple(int(v*255) for v in c), 'weight': round(float(x),3)} for c, x in zip(pal, w)],
  )

def avg(ms):
  out = {k: round(float(np.mean([m[k] for m in ms])), 4) for k in ms[0] if k != 'palette'}
  out['palette'] = ms[0]['palette'] if len(ms) == 1 else sorted(sum((m['palette'] for m in ms), []), key=lambda p: -p['weight'])[:6]
  return out

def main(root):
  man = json.load(open(os.path.join(root, 'reference_manifest.json')))
  obs = json.load(open(os.path.join(os.path.dirname(__file__), 'reference_observations.json')))
  out = []
  for r in man['references']:
    path = os.path.join(root, r['file'])
    sha = hashlib.sha256(open(path, 'rb').read()).hexdigest()
    assert sha == r['sha256'], f"checksum mismatch {r['id']}"
    im = Image.open(path); W, H = im.size
    rois = ROI.get(r['id'], [[0,0,1,1]])
    ms = [measure(im.crop((int(x0*W), int(y0*H), int(x1*W), int(y1*H)))) for x0,y0,x1,y1 in rois]
    o = obs[r['id']]
    out.append({'id': r['id'], 'level': r['level'], 'user_category': r['user_category'], 'sha256': sha,
                'size': [W, H], 'analysis_roi': rois, 'measured': avg(ms), **o})
  dst = os.path.join(os.path.dirname(__file__), '..', 'src', 'engine', 'art', 'annotations.json')
  json.dump({'source': 'Sonmira_Art_Engine_Handoff_v2 (user-labelled tiers)', 'count': len(out),
             'count_by_level': {l: sum(1 for x in out if x['level']==l) for l in ('loose','gathered','resolved')},
             'references': out}, open(dst, 'w'), ensure_ascii=False, indent=1)
  print('wrote', len(out), 'annotations')

if __name__ == '__main__':
  main(sys.argv[1])

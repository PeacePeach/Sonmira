"""Side-by-side sheet: a family's references next to generated outputs.

Usage: python3 tools/compare_refs.py <refs_dir> <sheet.jpg> <output.jpg> [<output.jpg> ...]
Each output needs the .json written beside it by tools/generate-family.mjs.
One row per output: the references that were sent, then the result.
"""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw

H, PAD, TOP = 520, 16, 34
refs_dir, sheet, outs = Path(sys.argv[1]), sys.argv[2], sys.argv[3:]
rows = []
for o in outs:
    meta = json.loads(Path(o).with_suffix('.json').read_text())
    if meta.get('referencePath'):
        tiles = [(f"ref {meta['referenceId']} (primary)", refs_dir / meta['referencePath'])]
    else:
        tiles = [(f"ref {r}" + (" (primary)" if r == meta.get('primaryReference') else ''), refs_dir / meta['tier'] / r) for r in meta['references']]
    tiles.append((f"{meta['family']}  ·  {meta['model']} {meta['quality']}  ·  seed {meta['seed']}", Path(o)))
    rows.append([(t, Image.open(p).convert('RGB')) for t, p in tiles])
fit = lambda im: im.resize((round(im.width * H / im.height), H))
rows = [[(t, fit(im)) for t, im in r] for r in rows]
W = max(sum(im.width + PAD for _, im in r) + PAD for r in rows)
out = Image.new('RGB', (W, len(rows) * (H + TOP + PAD) + PAD), 'white')
d = ImageDraw.Draw(out)
y = PAD
for r in rows:
    x = PAD
    for t, im in r:
        d.text((x, y + 8), t, fill=(40, 40, 40))
        out.paste(im, (x, y + TOP))
        x += im.width + PAD
    y += H + TOP + PAD
out.save(sheet, quality=90)
print(sheet)

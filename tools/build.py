"""Build a deployable copy of Abad Kerajaan in ./docs (static files only, ready for GitHub Pages "main /docs")
+ abad-kerajaan-web.zip (for itch.io etc).
- copies index.html, css, js and the assets the game loads
- converts the big sprite atlases from PNG to WebP (much smaller downloads) and rewrites their json page lists
- stamps a build version on index.html so browsers pick up new js/css after a deploy
    python tools/build.py"""
import os, re, json, shutil, time, zipfile
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'docs')      # GitHub Pages: Settings > Pages > Deploy from a branch > main / docs
ZIP = os.path.join(ROOT, 'abad-kerajaan-web.zip')
ATLASES = ['units', 'fauna', 'buildings', 'nature']
KEEP_ASSETS = ('assets',)          # everything the game loads lives in assets/

def size(path):
    t = 0
    for d, _, fs in os.walk(path):
        for f in fs: t += os.path.getsize(os.path.join(d, f))
    return t

def main():
    t0 = time.time()
    if os.path.exists(DIST): shutil.rmtree(DIST)
    os.makedirs(DIST)
    for f in ('index.html',): shutil.copy2(os.path.join(ROOT, f), DIST)
    for d in ('css', 'js') + KEEP_ASSETS: shutil.copytree(os.path.join(ROOT, d), os.path.join(DIST, d))
    A = os.path.join(DIST, 'assets')
    before = size(A)
    # sprite atlases -> WebP (colour pages lossy q92 with full alpha, masks lossless)
    for name in ATLASES:
        jp = os.path.join(A, name + '.json')
        if not os.path.exists(jp): continue
        meta = json.load(open(jp))
        pages = []
        for pg in meta['pages']:
            src = os.path.join(A, pg); dst = src[:-4] + '.webp'
            Image.open(src).save(dst, 'WEBP', quality=92, alpha_quality=100, method=6)
            os.remove(src); pages.append(pg[:-4] + '.webp')
            mk = os.path.join(A, pg.replace(name + '_', name + '_mask_'))
            if os.path.exists(mk):
                Image.open(mk).save(mk[:-4] + '.webp', 'WEBP', lossless=True, method=6); os.remove(mk)
        meta['pages'] = pages
        json.dump(meta, open(jp, 'w'), separators=(',', ':'))
    ic = os.path.join(A, 'icons.png')
    if os.path.exists(ic):
        Image.open(ic).save(ic[:-4] + '.webp', 'WEBP', quality=92, alpha_quality=100, method=6); os.remove(ic)
        for css in ('css/style.css',):
            p = os.path.join(DIST, css); s = open(p, encoding='utf-8').read().replace('icons.png', 'icons.webp'); open(p, 'w', encoding='utf-8').write(s)
        for js in os.listdir(os.path.join(DIST, 'js')):
            p = os.path.join(DIST, 'js', js); s = open(p, encoding='utf-8').read()
            if 'icons.png' in s: open(p, 'w', encoding='utf-8').write(s.replace('icons.png', 'icons.webp'))
    # drop files the game never requests
    for f in os.listdir(A):
        if f.endswith('.wav'): os.remove(os.path.join(A, f))
    open(os.path.join(DIST, '.nojekyll'), 'w').close()      # serve files as-is on GitHub Pages (no Jekyll processing)
    # cache-busting version stamp on the entry points
    ver = time.strftime('%Y%m%d%H%M')
    p = os.path.join(DIST, 'index.html'); s = open(p, encoding='utf-8').read()
    s = re.sub(r'(css/style\.css|js/main\.js)\?v=[\w]+', lambda m: f'{m.group(1)}?v={ver}', s)
    open(p, 'w', encoding='utf-8').write(s)
    # zip for itch.io / any static host (index.html at the root of the archive)
    if os.path.exists(ZIP): os.remove(ZIP)
    with zipfile.ZipFile(ZIP, 'w', zipfile.ZIP_DEFLATED) as z:
        for d, _, fs in os.walk(DIST):
            for f in fs:
                full = os.path.join(d, f); z.write(full, os.path.relpath(full, DIST))
    # Firebase Hosting config for a separate site (never the project's default site, which hosts other games)
    site = os.environ.get('SITE', 'abad-kerajaan-game')
    fb = {'hosting': {'site': site, 'public': 'docs', 'ignore': ['**/.*'],
          'headers': [{'source': '**/*.@(html|js|css|json)', 'headers': [{'key': 'Cache-Control', 'value': 'no-cache'}]},
                      {'source': '**/*.@(webp|png|jpg|ogg|m4a)', 'headers': [{'key': 'Cache-Control', 'value': 'public, max-age=86400'}]}]}}
    json.dump(fb, open(os.path.join(ROOT, 'firebase.json'), 'w'), indent=2)
    json.dump({'projects': {'default': os.environ.get('PROJECT', 'vuez-63625')}}, open(os.path.join(ROOT, '.firebaserc'), 'w'), indent=2)
    print(f'Assets: {before / 1e6:.1f} MB -> {size(A) / 1e6:.1f} MB')
    print(f'docs/: {size(DIST) / 1e6:.1f} MB  |  zip: {os.path.getsize(ZIP) / 1e6:.1f} MB  |  build {ver} in {time.time() - t0:.0f}s')

if __name__ == '__main__':
    main()

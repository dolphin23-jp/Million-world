#!/usr/bin/env python3
"""
生成テクスチャの腰まわりの描き崩れを直す（docs/05-asset-automation.md「腰の背面」）。

Tripo の焼き込みテクスチャには、背中側の腰に「傷のような暗い線」とトップス裾の赤い楔、
ショーツのウエストバンド上端と裾に「ささくれた黒いふち」がある（原メッシュの形は綺麗）。
トゥーン着色＋輪郭線では目立つので、その部分のテクセルだけを塗り直す。
UV は小さな島に分かれているため、テクスチャ上の座標ではなく「3D 上の領域」で対象を選ぶ
（領域に入る三角形の UV をラスタライズして対象テクセルを決める）。

  python3 tools/clean-texture.py <model.glb> <texture.png> <out.png> [--debug]

  --debug: 対象テクセルをマゼンタで塗って出力（領域が正しい場所に当たっているかを描画で確認する用）
"""
import json, struct, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
glb, tex_path, out_path = sys.argv[1:4]
debug = '--debug' in sys.argv

def read_glb(path):
    b = open(path, 'rb').read(); n = struct.unpack_from('<I', b, 12)[0]
    return json.loads(b[20:20 + n]), b[20 + n + 8:]

js, bin_ = read_glb(glb)
prim = js['meshes'][0]['primitives'][0]
def acc(i):
    a = js['accessors'][i]; bv = js['bufferViews'][a['bufferView']]
    ct = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[a['componentType']]
    nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    isz = np.dtype(ct).itemsize; stride = bv.get('byteStride') or isz * nc
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    arr = np.ndarray(shape=(a['count'], nc), dtype=ct, buffer=bin_, offset=off, strides=(stride, isz))
    return (arr if nc > 1 else arr[:, 0]).copy()
pos = acc(prim['attributes']['POSITION']); uv = acc(prim['attributes']['TEXCOORD_0']); idx = acc(prim['indices']).reshape(-1, 3)

img = np.array(Image.open(tex_path).convert('RGB')).astype(np.float32)
S = img.shape[0]

# 胴の断面（y=1.05 付近、腕を除く）から中心 x と前後の中心 z を求める
torso = pos[(pos[:, 1] > 1.0) & (pos[:, 1] < 1.1)]
cx0 = np.median(torso[:, 0]); torso = torso[np.abs(torso[:, 0] - cx0) < 0.13]
cx = float((torso[:, 0].min() + torso[:, 0].max()) / 2); zc = float((torso[:, 2].min() + torso[:, 2].max()) / 2)
print(f'胴の中心 x={cx:.3f} z={zc:.3f}  断面 x[{torso[:,0].min():.3f},{torso[:,0].max():.3f}] z[{torso[:,2].min():.3f},{torso[:,2].max():.3f}]')

cen = pos[idx].mean(axis=1)  # 三角形の重心
def region_mask(sel):
    m = Image.new('L', (S, S), 0); d = ImageDraw.Draw(m)
    for t in idx[sel]:
        d.polygon([(float(uv[i][0]) * S, float(uv[i][1]) * S) for i in t], fill=255)
    return np.array(m) > 0

dx = np.abs(cen[:, 0] - cx)
Y = cen[:, 1]
R_SKIN = (Y > 0.98) & (Y < 1.29) & (dx < 0.16) & (cen[:, 2] < zc)        # 背中側の腰（素肌）
R_BAND = (Y > 0.93) & (Y < 1.10) & (dx < 0.24)                            # ショーツのウエストバンド上端（全周）
R_HEM = (Y > 1.17) & (Y < 1.31) & (dx < 0.24)                             # トップスの裾（全周）
m_skin, m_band, m_hem = region_mask(R_SKIN), region_mask(R_BAND), region_mask(R_HEM)
print('対象テクセル: 背中の腰 %d / バンド %d / 裾 %d' % (m_skin.sum(), m_band.sum(), m_hem.sum()))

out = img.copy()
if debug:
    for m, c in [(m_skin, (255, 0, 255)), (m_band, (0, 255, 255)), (m_hem, (255, 255, 0))]:
        out[m] = c
    Image.fromarray(out.astype(np.uint8)).save(out_path); print('debug 出力', out_path); sys.exit(0)

# ---- 1. 背中の腰: 素肌の線・楔を、周囲の肌色で塗り直す ----
r, g, b = img[..., 0], img[..., 1], img[..., 2]
mx, mn = img.max(-1), img.min(-1)
sat = (mx - mn) / np.maximum(mx, 1)
skin_like = (mx > 0.45 * 255) & (sat > 0.06) & (r >= g) & (g >= b - 12)     # 黒・白・髪（黄）を除く
base = m_skin & skin_like
def norm_blur(mask, sigma):
    w = mask.astype(np.float32)
    num = np.stack([ndimage.gaussian_filter(img[..., c] * w, sigma) for c in range(3)], -1)
    den = ndimage.gaussian_filter(w, sigma)[..., None]
    return num / np.maximum(den, 1e-4), den[..., 0]
est0, _ = norm_blur(base, 14)
dev = np.linalg.norm(img - est0, axis=-1)
outlier = base & (dev > 15)
outlier = ndimage.binary_dilation(outlier, iterations=3) & base
inlier = base & ~outlier
est1, den1 = norm_blur(inlier, 18)
fix = outlier & (den1 > 0.02)
print('肌の塗り直し: 外れ値 %d テクセル（対象肌の %.1f%%）' % (fix.sum(), fix.sum() / max(base.sum(), 1) * 100))
feather = ndimage.gaussian_filter(fix.astype(np.float32), 1.5)[..., None]
out = out * (1 - feather) + est1 * feather

# ---- 2. バンド上端・裾: ささくれを中央値フィルタで均す（島の縁から 5px 内側だけ） ----
pil = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
med = np.array(pil.filter(ImageFilter.MedianFilter(9))).astype(np.float32)
for m in (m_band, m_hem):
    inner = ndimage.binary_erosion(m, iterations=5)
    out[inner] = med[inner]

Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(out_path)
print('出力', out_path)

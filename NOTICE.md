# Notices

短版 / TL;DR — **代码是 MIT；美术不是。** 熊的形象和这些图片属于原作者 **Nagano（ナガノ）**，**禁止商用**，仅供个人非商业使用。

---

## 1. Code — MIT

Everything under `lib/`, `tools/`, `test/`, `docs/`, plus `package.json` and
`cordis.patch.yml`, is released under the MIT license — see [LICENSE](LICENSE).

## 2. Artwork — © Nagano, all rights reserved, **NON-COMMERCIAL ONLY**

The following files are **NOT** covered by the MIT license:

| File | What it is |
| --- | --- |
| `assets/source/zichaoxiong.gif` | the source artwork this pet was built from |
| `assets/frames/frame-*.webp` | the 7 animation frames derived from it |
| `assets/sprite-sheet.webp` | contact sheet of those frames |
| `assets/frames-base64.js` | the same frames, base64-encoded for inlining |
| `docs/preview*.webp` | screenshots of the pet running (they show the character) |
| `lib/client.js` | contains a copy of those frames inside the bundle |

**Character and artwork: © Nagano (ナガノ)** — the author of *ちいかわ* (Chiikawa) and
*自分ツッコミくま* (Joke Bear / 농담곰 / 自嘲熊).

The author has stated on X (Twitter) that **commercial use of this character is not
permitted**. This project therefore treats the artwork as **non-commercial, personal
use only**:

- ✅ run it, read it, fork it, modify it, share the project as it is
- ❌ do **not** sell it, bundle it into a paid product, put it behind ads, paywalls or
  donations, print merchandise from it, or use it in any commercial context
- ❌ do not re-license the artwork, and do not claim it as your own

This is an **unofficial fan project**. It is not affiliated with, endorsed by, or
sponsored by Nagano, or by the rights holders of *ちいかわ* / *自分ツッコミくま*.

**Takedown:** if you are the rights holder and want the artwork removed, please open an
issue — it will be removed promptly.

## 3. Want a fully MIT-licensed build?

The artwork is isolated on purpose. Drop in your own animated GIF and re-derive
everything:

```bash
# replace the source (any animated GIF with a transparent background works)
cp your-pet.gif assets/source/zichaoxiong.gif
python tools/build_assets.py     # needs Pillow; re-derives frames + base64 module
node tools/build-client.mjs      # rebuilds lib/client.js
```

Then delete `assets/frames-base64.js`'s old frames from git history if you need a clean
provenance, and update this file.

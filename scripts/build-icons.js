/**
 * scripts/build-icons.js
 * SVG → PNG / ICO / (icns placeholder) を生成する
 * 使い方: node scripts/build-icons.js
 */

const sharp = require('sharp');
const { imagesToIco } = require('png-to-ico');
const fs = require('fs');
const path = require('path');

const SRC_SVG   = path.join(__dirname, '../src/assets/icon.svg');
const ASSETS    = path.join(__dirname, '../src/assets');

const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];

async function main() {
  // ── 1. 各サイズの PNG を生成 ──────────────────────────────────────────────
  console.log('Generating PNGs...');
  const pngPaths = [];

  for (const size of SIZES) {
    const outPath = path.join(ASSETS, `icon_${size}.png`);
    await sharp(SRC_SVG)
      .resize(size, size)
      .png()
      .toFile(outPath);
    pngPaths.push(outPath);
    console.log(`  ✓ icon_${size}.png`);
  }

  // ── 2. Linux 用 PNG (512px) ───────────────────────────────────────────────
  const linuxPng = path.join(ASSETS, 'icon.png');
  fs.copyFileSync(path.join(ASSETS, 'icon_512.png'), linuxPng);
  console.log('  ✓ icon.png (Linux)');

  // ── 3. Windows 用 .ico (複数サイズ埋め込み) ──────────────────────────────
  console.log('Generating icon.ico...');
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoImages = await Promise.all(icoSizes.map(async (s) => {
    const { data, info } = await sharp(path.join(ASSETS, `icon_${s}.png`))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  }));
  const icoBuffer = imagesToIco(icoImages);
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), icoBuffer);
  console.log('  ✓ icon.ico (Windows)');

  // ── 4. 中間 PNG を削除 ────────────────────────────────────────────────────
  for (const size of SIZES) {
    fs.unlinkSync(path.join(ASSETS, `icon_${size}.png`));
  }
  console.log('  ✓ Temp PNGs cleaned up');

  console.log('\nDone! Generated:');
  console.log('  src/assets/icon.png  (Linux, 512px)');
  console.log('  src/assets/icon.ico  (Windows, multi-size)');
  console.log('\nmacOS icon.icns: generate on macOS with `iconutil` or in CI.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

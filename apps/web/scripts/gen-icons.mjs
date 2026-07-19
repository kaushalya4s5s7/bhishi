// scripts/gen-icons.mjs — run once, then the -D sharp dep can stay for regen
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/logo-mark.svg');
const paper = { r: 0xfa, g: 0xf9, b: 0xf6, alpha: 1 };

async function make(size, out, pad = 0) {
  const inner = Math.round(size * (1 - pad * 2));
  const logo = await sharp(svg).resize(inner, inner, { fit: 'contain', background: { ...paper, alpha: 0 } }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: paper } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(out);
}

await make(192, 'public/icons/icon-192.png');
await make(512, 'public/icons/icon-512.png');
await make(512, 'public/icons/icon-maskable-512.png', 0.2);
await make(180, 'public/icons/apple-touch-icon.png');
console.log('icons written');

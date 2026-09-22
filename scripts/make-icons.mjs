// Placeholder app icons until the client's logo arrives. Run: node scripts/make-icons.mjs
import sharp from "sharp";

const INDIGO = "#2d3a8c";
const GROUND = "#f4f2ee";

// scale < 1 keeps the letter inside the maskable safe zone (inner 80%).
function svg(size, { rounded, scale }) {
  const radius = rounded ? size * 0.22 : 0;
  const fontSize = size * 0.62 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${INDIGO}"/>
  <text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Georgia, serif"
    font-weight="700" font-size="${fontSize}" fill="${GROUND}">F</text>
</svg>`;
}

const icons = [
  { file: "icon-192.png", size: 192, rounded: true, scale: 1 },
  { file: "icon-512.png", size: 512, rounded: true, scale: 1 },
  { file: "maskable-512.png", size: 512, rounded: false, scale: 0.75 },
  { file: "apple-touch-icon.png", size: 180, rounded: false, scale: 0.9 },
];

for (const { file, size, ...opts } of icons) {
  await sharp(Buffer.from(svg(size, opts)))
    .png()
    .toFile(`public/icons/${file}`);
  console.log(`public/icons/${file}`);
}

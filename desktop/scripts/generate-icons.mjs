/**
 * Pure Node.js icon generator for ScreenSnap Desktop.
 * Renders the Zagid Moss & Citron rounded-square viewfinder icon with 2x2
 * supersampling and writes PNG + multi-resolution ICO outputs.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const ICO_SIZES = [16, 32, 48, 64, 128, 256];

const COLOR_MOSS_950 = [21, 28, 8];     // #151C08
const COLOR_MOSS_850 = [39, 52, 17];    // #273411
const COLOR_MOSS_700 = [76, 98, 26];    // #4C621A
const COLOR_CITRON_500 = [164, 198, 57]; // #A4C639
const COLOR_PISTACHIO_300 = [216, 235, 138]; // #D8EB8A
const COLOR_IVORY_100 = [245, 249, 220]; // #F5F9DC

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const lenBytes = Buffer.allocUnsafe(4);
  lenBytes.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBytes = Buffer.allocUnsafe(4);
  crcBytes.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([lenBytes, crcInput, crcBytes]);
}

/**
 * Encode raw RGBA pixel bytes into a valid 8-bit RGBA PNG buffer.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba
 * @returns {Buffer}
 */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA color type
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.allocUnsafe(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const rowOut = y * (stride + 1);
    const rowIn = y * stride;
    raw[rowOut] = 0; // filter type 0 (None)
    raw.set(rgba.subarray(rowIn, rowIn + stride), rowOut + 1);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Pack PNG frames into a Windows .ico container.
 * Uses PNG-encoded frames (standard for Vista+ icons including 256x256).
 * @param {Array<{ size: number, png: Buffer }>} frames
 * @returns {Buffer}
 */
function encodeIco(frames) {
  const count = frames.length;
  const headerSize = 6 + count * 16;
  const dir = Buffer.alloc(headerSize);

  // ICONDIR: reserved=0, type=1 (icon), count=frames.length
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(count, 4);

  let offset = headerSize;
  const buffers = [dir];

  for (let i = 0; i < count; i++) {
    const { size, png } = frames[i];
    const entryOffset = 6 + i * 16;
    const dimByte = size >= 256 ? 0 : size;

    dir[entryOffset] = dimByte;
    dir[entryOffset + 1] = dimByte;
    dir[entryOffset + 2] = 0; // colorCount (0 for >= 8bpp)
    dir[entryOffset + 3] = 0; // reserved
    dir.writeUInt16LE(1, entryOffset + 4); // planes
    dir.writeUInt16LE(32, entryOffset + 6); // bitCount
    dir.writeUInt32LE(png.length, entryOffset + 8); // bytesInRes
    dir.writeUInt32LE(offset, entryOffset + 12); // imageOffset

    buffers.push(png);
    offset += png.length;
  }

  return Buffer.concat(buffers);
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function sdRoundedBox(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const denom = bax * bax + bay * bay;
  const h = denom > 0 ? clamp((pax * bax + pay * bay) / denom, 0, 1) : 0;
  return Math.hypot(pax - bax * h, pay - bay * h);
}

/**
 * Render the Zagid Moss & Citron ScreenSnap icon at `size x size`
 * using 2x2 supersampling and premultiplied alpha compositing.
 * @param {number} size
 * @returns {Uint8Array}
 */
function renderIconRgba(size) {
  const rgba = new Uint8Array(size * size * 4);
  const aa = 0.5 / size;

  const boxHalf = 0.46;
  const boxRadius = 0.21;
  const bracketCorner = 0.255;
  const bracketArmEnd = 0.12;
  const bracketHalfWidth = 0.031;
  const lensRadius = 0.126;
  const lensHalfWidth = 0.025;
  const dotRadius = 0.046;

  // 2x2 subpixel offsets inside each pixel
  const subOffsets = [0.25, 0.75];

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;

      for (let sy = 0; sy < 2; sy++) {
        const v = (py + subOffsets[sy]) / size;
        for (let sx = 0; sx < 2; sx++) {
          const u = (px + subOffsets[sx]) / size;

          const cx = u - 0.5;
          const cy = v - 0.5;
          const dBox = sdRoundedBox(cx, cy, boxHalf, boxHalf, boxRadius);
          const boxAlpha = 1 - smoothstep(-aa, aa, dBox);

          if (boxAlpha <= 0) {
            continue;
          }

          // Radial moss/olive gradient (#4C621A -> #273411 -> #151C08)
          const radialDist = clamp(Math.hypot(u - 0.43, v - 0.57) / 0.72, 0, 1);
          let r;
          let g;
          let b;
          if (radialDist < 0.48) {
            const t = radialDist / 0.48;
            r = COLOR_MOSS_700[0] + (COLOR_MOSS_850[0] - COLOR_MOSS_700[0]) * t;
            g = COLOR_MOSS_700[1] + (COLOR_MOSS_850[1] - COLOR_MOSS_700[1]) * t;
            b = COLOR_MOSS_700[2] + (COLOR_MOSS_850[2] - COLOR_MOSS_700[2]) * t;
          } else {
            const t = (radialDist - 0.48) / 0.52;
            r = COLOR_MOSS_850[0] + (COLOR_MOSS_950[0] - COLOR_MOSS_850[0]) * t;
            g = COLOR_MOSS_850[1] + (COLOR_MOSS_950[1] - COLOR_MOSS_850[1]) * t;
            b = COLOR_MOSS_850[2] + (COLOR_MOSS_950[2] - COLOR_MOSS_850[2]) * t;
          }

          // Luminous corner glows (#A4C639 and #D8EB8A)
          const dxBL = u - 0.14;
          const dyBL = v - 0.86;
          const blDist2 = dxBL * dxBL + dyBL * dyBL;
          const blCitron = Math.exp(-blDist2 / (2 * 0.27 * 0.27)) * 0.52;
          const blPistachio = Math.exp(-blDist2 / (2 * 0.16 * 0.16)) * 0.24;

          const dxTL = u - 0.16;
          const dyTL = v - 0.16;
          const tlDist2 = dxTL * dxTL + dyTL * dyTL;
          const tlCitron = Math.exp(-tlDist2 / (2 * 0.24 * 0.24)) * 0.3;
          const tlPistachio = Math.exp(-tlDist2 / (2 * 0.14 * 0.14)) * 0.14;

          const citronGlow = clamp(blCitron + tlCitron, 0, 1);
          r += (COLOR_CITRON_500[0] - r) * citronGlow;
          g += (COLOR_CITRON_500[1] - g) * citronGlow;
          b += (COLOR_CITRON_500[2] - b) * citronGlow;

          const pistachioGlow = clamp(blPistachio + tlPistachio, 0, 1);
          r += (COLOR_PISTACHIO_300[0] - r) * pistachioGlow;
          g += (COLOR_PISTACHIO_300[1] - g) * pistachioGlow;
          b += (COLOR_PISTACHIO_300[2] - b) * pistachioGlow;

          // Subtle luminous inner edge rim
          const rimBand =
            smoothstep(-0.026, -0.007, dBox) * (1 - smoothstep(-0.007, 0.004, dBox));
          const rimDirectional = clamp(1.1 - (u + v) * 0.45, 0.28, 0.95);
          const rimAlpha = rimBand * rimDirectional * 0.36;
          r += (COLOR_PISTACHIO_300[0] - r) * rimAlpha;
          g += (COLOR_PISTACHIO_300[1] - g) * rimAlpha;
          b += (COLOR_PISTACHIO_300[2] - b) * rimAlpha;

          // Quadrant symmetry around (0.5, 0.5) for viewfinder brackets & lens
          const ax = Math.abs(cx);
          const ay = Math.abs(cy);

          const dH = sdSegment(ax, ay, bracketCorner, bracketCorner, bracketArmEnd, bracketCorner);
          const dV = sdSegment(ax, ay, bracketCorner, bracketCorner, bracketCorner, bracketArmEnd);
          const dBracket = Math.min(dH, dV) - bracketHalfWidth;

          // Soft citron aura behind brackets
          if (dBracket > 0 && dBracket < 0.08) {
            const aura = Math.exp(-(dBracket * dBracket) / (2 * 0.022 * 0.022)) * 0.22;
            r += (COLOR_CITRON_500[0] - r) * aura;
            g += (COLOR_CITRON_500[1] - g) * aura;
            b += (COLOR_CITRON_500[2] - b) * aura;
          }

          const bracketAlpha = 1 - smoothstep(-aa, aa, dBracket);
          if (bracketAlpha > 0) {
            const mixPistachio = clamp((v - 0.22) / 0.56, 0, 1) * 0.38;
            const br =
              COLOR_IVORY_100[0] + (COLOR_PISTACHIO_300[0] - COLOR_IVORY_100[0]) * mixPistachio;
            const bg =
              COLOR_IVORY_100[1] + (COLOR_PISTACHIO_300[1] - COLOR_IVORY_100[1]) * mixPistachio;
            const bb =
              COLOR_IVORY_100[2] + (COLOR_PISTACHIO_300[2] - COLOR_IVORY_100[2]) * mixPistachio;
            r += (br - r) * bracketAlpha;
            g += (bg - g) * bracketAlpha;
            b += (bb - b) * bracketAlpha;
          }

          // Central camera lens ring (#A4C639) with soft top-left sheen
          const distCenter = Math.hypot(ax, ay);
          const dRing = Math.abs(distCenter - lensRadius) - lensHalfWidth;

          if (dRing > 0 && dRing < 0.07) {
            const lensAura = Math.exp(-(dRing * dRing) / (2 * 0.02 * 0.02)) * 0.24;
            r += (COLOR_CITRON_500[0] - r) * lensAura;
            g += (COLOR_CITRON_500[1] - g) * lensAura;
            b += (COLOR_CITRON_500[2] - b) * lensAura;
          }

          const ringAlpha = 1 - smoothstep(-aa, aa, dRing);
          if (ringAlpha > 0) {
            const sheen = clamp(0.62 - cx * 1.4 - cy * 1.4, 0, 1) * 0.34;
            const rr =
              COLOR_CITRON_500[0] + (COLOR_PISTACHIO_300[0] - COLOR_CITRON_500[0]) * sheen;
            const rg =
              COLOR_CITRON_500[1] + (COLOR_PISTACHIO_300[1] - COLOR_CITRON_500[1]) * sheen;
            const rb =
              COLOR_CITRON_500[2] + (COLOR_PISTACHIO_300[2] - COLOR_CITRON_500[2]) * sheen;
            r += (rr - r) * ringAlpha;
            g += (rg - g) * ringAlpha;
            b += (rb - b) * ringAlpha;
          }

          // Center ivory dot (#F5F9DC)
          const dDot = distCenter - dotRadius;
          const dotAlpha = 1 - smoothstep(-aa, aa, dDot);
          if (dotAlpha > 0) {
            r += (COLOR_IVORY_100[0] - r) * dotAlpha;
            g += (COLOR_IVORY_100[1] - g) * dotAlpha;
            b += (COLOR_IVORY_100[2] - b) * dotAlpha;
          }

          accR += r * boxAlpha;
          accG += g * boxAlpha;
          accB += b * boxAlpha;
          accA += boxAlpha;
        }
      }

      const outIdx = (py * size + px) * 4;
      if (accA > 0) {
        const avgAlpha = accA * 0.25;
        rgba[outIdx] = Math.round(clamp(accR / accA, 0, 255));
        rgba[outIdx + 1] = Math.round(clamp(accG / accA, 0, 255));
        rgba[outIdx + 2] = Math.round(clamp(accB / accA, 0, 255));
        rgba[outIdx + 3] = Math.round(clamp(avgAlpha * 255, 0, 255));
      } else {
        rgba[outIdx] = 0;
        rgba[outIdx + 1] = 0;
        rgba[outIdx + 2] = 0;
        rgba[outIdx + 3] = 0;
      }
    }
  }

  return rgba;
}

function generateAllIcons() {
  const buildDir = path.join(ROOT_DIR, "build");
  const assetsDir = path.join(ROOT_DIR, "assets");
  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });

  const pngBySize = new Map();
  for (const size of [...ICO_SIZES, 512]) {
    const rgba = renderIconRgba(size);
    pngBySize.set(size, encodePng(size, size, rgba));
  }

  const buildPngPath = path.join(buildDir, "icon.png");
  const asset32Path = path.join(assetsDir, "icon-32.png");
  const asset128Path = path.join(assetsDir, "icon-128.png");
  const buildIcoPath = path.join(buildDir, "icon.ico");

  fs.writeFileSync(buildPngPath, pngBySize.get(512));
  fs.writeFileSync(asset32Path, pngBySize.get(32));
  fs.writeFileSync(asset128Path, pngBySize.get(128));

  const icoFrames = ICO_SIZES.map((size) => ({ size, png: pngBySize.get(size) }));
  fs.writeFileSync(buildIcoPath, encodeIco(icoFrames));

  return {
    buildPngPath,
    buildIcoPath,
    asset32Path,
    asset128Path,
  };
}

const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isCli) {
  const outputs = generateAllIcons();
  console.log("Generated icons:");
  console.log(`- ${path.relative(ROOT_DIR, outputs.buildPngPath)} (512x512)`);
  console.log(`- ${path.relative(ROOT_DIR, outputs.buildIcoPath)} (${ICO_SIZES.join(", ")})`);
  console.log(`- ${path.relative(ROOT_DIR, outputs.asset32Path)} (32x32)`);
  console.log(`- ${path.relative(ROOT_DIR, outputs.asset128Path)} (128x128)`);
}

export { encodePng, encodeIco, renderIconRgba, generateAllIcons, ICO_SIZES };

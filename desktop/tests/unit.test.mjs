import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { buildScreenshotFilename } from "../src/shared/filename.mjs";
import {
  A4_HEIGHT_PT,
  A4_WIDTH_PT,
  MAX_PDF_PAGE_PT,
  buildPdfFromJpegs,
} from "../src/shared/pdf-builder.mjs";

const require = createRequire(import.meta.url);
const {
  DEFAULT_SETTINGS,
  MIN_GOST_OPACITY,
  MAX_GOST_OPACITY,
  getDefaultShortcuts,
  sanitizeAccelerator,
  getSettingsPath,
  sanitizeSettings,
  loadSettings,
  saveSettings,
  updateSettings,
} = require("../src/main/settings.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function parsePngHeader(buffer) {
  assert.ok(buffer.length >= 33, "PNG buffer too short");
  assert.deepEqual(
    buffer.subarray(0, 8),
    PNG_SIGNATURE,
    "PNG signature mismatch"
  );
  const ihdrLen = buffer.readUInt32BE(8);
  const ihdrType = buffer.subarray(12, 16).toString("ascii");
  assert.equal(ihdrLen, 13, "IHDR chunk length must be 13");
  assert.equal(ihdrType, "IHDR", "First chunk must be IHDR");

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
  };
}

function parseAndVerifyPdf(pdfBytes, expectedObjCount) {
  const buf = Buffer.from(pdfBytes);
  assert.equal(
    buf.subarray(0, 9).toString("latin1"),
    "%PDF-1.4\n",
    "PDF must begin with %PDF-1.4\\n"
  );
  assert.equal(
    buf.subarray(buf.length - 6).toString("latin1"),
    "%%EOF\n",
    "PDF must end with %%EOF\\n"
  );

  const tail = buf.subarray(Math.max(0, buf.length - 128)).toString("latin1");
  const startxrefMatch = tail.match(/startxref\n(\d+)\n%%EOF\n$/);
  assert.ok(startxrefMatch, "Missing startxref trailer");
  const xrefOffset = Number(startxrefMatch[1]);

  const expectedXrefHeader = `xref\n0 ${expectedObjCount + 1}\n`;
  assert.equal(
    buf.subarray(xrefOffset, xrefOffset + expectedXrefHeader.length).toString("latin1"),
    expectedXrefHeader,
    "startxref must point directly to xref table header"
  );

  let cursor = xrefOffset + expectedXrefHeader.length;
  const freeEntry = buf.subarray(cursor, cursor + 20).toString("latin1");
  assert.equal(freeEntry, "0000000000 65535 f \n");
  cursor += 20;

  const offsets = [];
  for (let id = 1; id <= expectedObjCount; id++) {
    const row = buf.subarray(cursor, cursor + 20).toString("latin1");
    assert.match(row, /^\d{10} 00000 n \n$/, `Invalid xref row for obj ${id}: ${row}`);
    const objOffset = Number(row.slice(0, 10));
    offsets.push(objOffset);
    const objMarker = `${id} 0 obj\n`;
    assert.equal(
      buf.subarray(objOffset, objOffset + objMarker.length).toString("latin1"),
      objMarker,
      `Object ${id} offset mismatch`
    );
    cursor += 20;
  }

  return { buf, xrefOffset, offsets };
}

test("PNG icon assets have valid signatures and IHDR dimensions", () => {
  const targets = [
    { rel: "build/icon.png", width: 512, height: 512 },
    { rel: "assets/icon-32.png", width: 32, height: 32 },
    { rel: "assets/icon-128.png", width: 128, height: 128 },
  ];

  for (const target of targets) {
    const fullPath = path.join(ROOT_DIR, target.rel);
    assert.ok(fs.existsSync(fullPath), `${target.rel} must exist`);
    const buf = fs.readFileSync(fullPath);
    const ihdr = parsePngHeader(buf);
    assert.equal(ihdr.width, target.width, `${target.rel} width`);
    assert.equal(ihdr.height, target.height, `${target.rel} height`);
    assert.equal(ihdr.bitDepth, 8, `${target.rel} bitDepth`);
    assert.equal(ihdr.colorType, 6, `${target.rel} RGBA colorType`);
    assert.ok(buf.includes(Buffer.from("IDAT", "ascii")), `${target.rel} has IDAT`);
    assert.ok(buf.includes(Buffer.from("IEND", "ascii")), `${target.rel} has IEND`);
  }
});

test("build/icon.ico has valid header, 6 PNG frames (16..256), and accurate offsets", () => {
  const icoPath = path.join(ROOT_DIR, "build/icon.ico");
  assert.ok(fs.existsSync(icoPath), "build/icon.ico must exist");
  const ico = fs.readFileSync(icoPath);

  assert.deepEqual(ico.subarray(0, 4), Buffer.from([0x00, 0x00, 0x01, 0x00]));
  const frameCount = ico.readUInt16LE(4);
  assert.equal(frameCount, 6);

  const expectedSizes = [16, 32, 48, 64, 128, 256];
  const headerEnd = 6 + frameCount * 16;
  assert.ok(ico.length > headerEnd);

  let prevEnd = headerEnd;
  for (let i = 0; i < frameCount; i++) {
    const size = expectedSizes[i];
    const entryOffset = 6 + i * 16;
    const widthByte = ico[entryOffset];
    const heightByte = ico[entryOffset + 1];
    const planes = ico.readUInt16LE(entryOffset + 4);
    const bitCount = ico.readUInt16LE(entryOffset + 6);
    const bytesInRes = ico.readUInt32LE(entryOffset + 8);
    const imageOffset = ico.readUInt32LE(entryOffset + 12);

    const expectedByte = size === 256 ? 0 : size;
    assert.equal(widthByte, expectedByte, `Frame ${i} width byte`);
    assert.equal(heightByte, expectedByte, `Frame ${i} height byte`);
    assert.equal(planes, 1, `Frame ${i} planes`);
    assert.equal(bitCount, 32, `Frame ${i} bitCount`);
    assert.ok(bytesInRes > 33, `Frame ${i} bytesInRes > 33`);
    assert.ok(imageOffset >= prevEnd, `Frame ${i} offset non-overlapping`);
    assert.ok(imageOffset + bytesInRes <= ico.length, `Frame ${i} within bounds`);

    const frameSlice = ico.subarray(imageOffset, imageOffset + bytesInRes);
    const ihdr = parsePngHeader(frameSlice);
    assert.equal(ihdr.width, size, `Frame ${i} PNG width`);
    assert.equal(ihdr.height, size, `Frame ${i} PNG height`);
    prevEnd = imageOffset + bytesInRes;
  }
});

test("buildScreenshotFilename sanitizes accents, illegal chars, extensions, and empty labels", () => {
  const fixedDate = new Date(2026, 10, 24, 9, 5, 3); // 2026-11-24 09:05:03

  assert.equal(
    buildScreenshotFilename("Área de Trabalho — Monitor 1", "png", fixedDate),
    "ScreenSnap_Area-de-Trabalho-—-Monitor-1_2026-11-24_09-05-03.png"
  );

  const illegalName = buildScreenshotFilename('Relatório: <Teste> "Final"/\\|?*\x01', ".jpg", fixedDate);
  assert.equal(illegalName, "ScreenSnap_Relatorio-Teste-Final_2026-11-24_09-05-03.jpg");
  assert.equal(/[<>:"/\\|?*\x00-\x1f]/.test(illegalName), false);

  for (const emptyInput of ["", "   ", null, undefined, '<>:"/\\|?*']) {
    assert.equal(
      buildScreenshotFilename(emptyInput, "pdf", fixedDate),
      "ScreenSnap_captura_2026-11-24_09-05-03.pdf"
    );
  }

  const longLabel = "A".repeat(47) + " ZZZ";
  const longFilename = buildScreenshotFilename(longLabel, "png", fixedDate);
  assert.equal(
    longFilename,
    `ScreenSnap_${"A".repeat(47)}_2026-11-24_09-05-03.png`
  );
});

test("buildPdfFromJpegs builds valid single-page PDF with exact xref offsets", () => {
  assert.equal(MAX_PDF_PAGE_PT, 14400);
  assert.equal(A4_WIDTH_PT, 595.28);
  assert.equal(A4_HEIGHT_PT, 841.89);

  assert.throws(() => buildPdfFromJpegs([]));

  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0xff, 0xd9]);
  const pdf = buildPdfFromJpegs([
    {
      jpegBytes: fakeJpeg,
      pxWidth: 1600,
      pxHeight: 900,
      pageWidthPt: 1200,
      pageHeightPt: 675,
      drawXPt: 0,
      drawYPt: 0,
      drawWidthPt: 1200,
      drawHeightPt: 675,
    },
  ]);

  const { buf } = parseAndVerifyPdf(pdf, 5);
  const text = buf.toString("latin1");
  assert.ok(text.includes("/Count 1 >>"));
  assert.ok(text.includes("/MediaBox [0 0 1200 675]"));
  assert.ok(text.includes("/Width 1600 /Height 900"));
  assert.ok(text.includes("/Filter /DCTDecode /Length 10"));
  assert.ok(buf.includes(Buffer.from(fakeJpeg)));
});

test("buildPdfFromJpegs builds valid multi-page A4 PDF with exact xref and startxref", () => {
  const jpegs = [
    new Uint8Array([0xff, 0xd8, 0x01, 0xff, 0xd9]),
    new Uint8Array([0xff, 0xd8, 0x02, 0x03, 0xff, 0xd9]),
    new Uint8Array([0xff, 0xd8, 0x04, 0x05, 0x06, 0xff, 0xd9]),
  ];

  const pages = jpegs.map((jpegBytes, idx) => ({
    jpegBytes,
    pxWidth: 1000,
    pxHeight: 1400 - idx * 100,
    pageWidthPt: A4_WIDTH_PT,
    pageHeightPt: A4_HEIGHT_PT,
    drawXPt: 24,
    drawYPt: 24,
    drawWidthPt: A4_WIDTH_PT - 48,
    drawHeightPt: A4_HEIGHT_PT - 48,
  }));

  const pdf = buildPdfFromJpegs(pages);
  const { buf } = parseAndVerifyPdf(pdf, 2 + pages.length * 3);
  const text = buf.toString("latin1");

  assert.ok(text.includes("/Kids [ 3 0 R 6 0 R 9 0 R ] /Count 3"));
  assert.ok(text.includes(`/MediaBox [0 0 ${A4_WIDTH_PT} ${A4_HEIGHT_PT}]`));
  for (const jpeg of jpegs) {
    assert.ok(buf.includes(Buffer.from(jpeg)));
  }
});

test("package.json configures electron, multi-platform build targets, and existing icon paths", () => {
  const pkgPath = path.join(ROOT_DIR, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  assert.ok(pkg.devDependencies?.electron, "electron must be listed in devDependencies");
  assert.ok(pkg.build?.win, "build.win must exist");
  assert.ok(pkg.build?.mac, "build.mac must exist");
  assert.ok(pkg.build?.linux, "build.linux must exist");

  const iconPaths = [
    pkg.build.win.icon,
    pkg.build.mac.icon,
    pkg.build.linux.icon,
    "assets/icon-32.png",
    "assets/icon-128.png",
  ];
  for (const relIcon of iconPaths) {
    assert.ok(typeof relIcon === "string" && relIcon.length > 0, "icon path must be set");
    const absIcon = path.join(ROOT_DIR, relIcon);
    assert.ok(fs.existsSync(absIcon), `Icon must exist: ${relIcon}`);
    assert.ok(fs.statSync(absIcon).size > 0, `Icon must be non-empty: ${relIcon}`);
  }
});

test("package.json bundles Windows Win+Shift+S scripts via extraResources", () => {
  const pkgPath = path.join(ROOT_DIR, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const extraResources = pkg.build?.win?.extraResources;

  assert.ok(Array.isArray(extraResources), "build.win.extraResources must be an array");
  const winScriptsEntry = extraResources.find(
    (entry) => entry?.from === "scripts/windows" && entry?.to === "scripts/windows"
  );
  assert.ok(winScriptsEntry, "extraResources must bundle scripts/windows");
  assert.ok(
    Array.isArray(winScriptsEntry.filter) &&
      winScriptsEntry.filter.includes("toggle-win-shift-s.ps1") &&
      winScriptsEntry.filter.includes("Liberar-WinShiftS.bat"),
    "extraResources filter must include toggle-win-shift-s.ps1 and Liberar-WinShiftS.bat"
  );

  for (const fileName of ["toggle-win-shift-s.ps1", "Liberar-WinShiftS.bat"]) {
    const absFile = path.join(ROOT_DIR, "scripts", "windows", fileName);
    assert.ok(fs.existsSync(absFile), `Script must exist on disk: ${fileName}`);
    assert.ok(fs.statSync(absFile).size > 0, `Script must be non-empty: ${fileName}`);
  }
});

test("package.json specifies homepage and maintainer email for Linux deb builds", () => {
  const pkgPath = path.join(ROOT_DIR, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  assert.match(String(pkg.homepage || ""), /^https?:\/\//, "homepage must be a valid URL");
  assert.ok(
    String(pkg.author?.email || "").includes("@") ||
      String(pkg.build?.linux?.maintainer || "").includes("@"),
    "author.email or build.linux.maintainer must contain an email address for FpmTarget deb builds"
  );
  assert.equal(pkg.build?.publish, null, "build.publish must be null to disable implicit CI publishing");
  for (const scriptName of ["build:win", "build:mac", "build:linux"]) {
    assert.ok(
      String(pkg.scripts?.[scriptName] || "").includes("--publish never"),
      `${scriptName} must pass --publish never`
    );
  }
});

test("src/shared/theme.css preserves Zagid tokens and defines --ds-mesh-launcher", () => {
  const themePath = path.join(ROOT_DIR, "src/shared/theme.css");
  const css = fs.readFileSync(themePath, "utf8");
  for (const token of [
    "--ds-moss-950",
    "--ds-citron-500",
    "--ds-pistachio-300",
    "--ds-ivory-100",
    "--ds-gradient-display",
    "--ds-mesh-popup",
    "--ds-mesh-launcher",
  ]) {
    assert.ok(css.includes(token), `theme.css must define ${token}`);
  }
});

test("getDefaultShortcuts returns platform-specific default shortcuts", () => {
  assert.deepEqual(getDefaultShortcuts("win32"), {
    region: "PrintScreen",
    screen: "CommandOrControl+Shift+1",
    window: "CommandOrControl+Shift+3",
  });
  assert.deepEqual(getDefaultShortcuts("linux"), {
    region: "PrintScreen",
    screen: "CommandOrControl+Shift+1",
    window: "CommandOrControl+Shift+3",
  });
  assert.deepEqual(getDefaultShortcuts("darwin"), {
    region: "CommandOrControl+Shift+S",
    screen: "CommandOrControl+Shift+1",
    window: "CommandOrControl+Shift+3",
  });
  assert.equal(DEFAULT_SETTINGS.tryWinShiftS, true);
});

test("sanitizeAccelerator canonicalizes valid accelerators and rejects invalid inputs", () => {
  const fallback = "CommandOrControl+Shift+S";

  assert.equal(sanitizeAccelerator("PrintScreen", fallback), "PrintScreen");
  assert.equal(sanitizeAccelerator(" printscreen ", fallback), "PrintScreen");
  assert.equal(sanitizeAccelerator("Super+Shift+S", fallback), "Super+Shift+S");
  assert.equal(sanitizeAccelerator("CommandOrControl+Shift+S", fallback), "CommandOrControl+Shift+S");
  assert.equal(sanitizeAccelerator("Alt+Shift+2", fallback), "Alt+Shift+2");
  assert.equal(sanitizeAccelerator("F9", fallback), "F9");
  assert.equal(sanitizeAccelerator("Ctrl+Shift+s", fallback), "Control+Shift+S");
  assert.equal(sanitizeAccelerator("cmdorctrl+shift+s", fallback), "CommandOrControl+Shift+S");

  const tooLong = `CommandOrControl+Shift+${"A".repeat(45)}`;
  assert.ok(tooLong.length > 64);

  for (const invalid of [
    "",
    "   ",
    null,
    undefined,
    "Control",
    "Ctrl+Shift",
    "Win+Alt+??",
    "Control+Control+S",
    "A",
    tooLong,
  ]) {
    assert.equal(sanitizeAccelerator(invalid, fallback), fallback, `Expected fallback for ${String(invalid)}`);
  }
});

test("saveSettings, loadSettings, and updateSettings persist and sanitize in isolated temp dir", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "screensnap-test-"));
  try {
    // Missing file yields defaults
    const initial = loadSettings(tmpDir);
    assert.deepEqual(initial, {
      delaySeconds: 0,
      minimizeToTray: true,
      tryWinShiftS: true,
      gostEnabled: true,
      gostIdleOpacity: 0.3,
      gostPosition: null,
      shortcuts: getDefaultShortcuts(),
    });

    // Save custom shortcuts & tryWinShiftS=false
    const saved = saveSettings(
      {
        delaySeconds: 3,
        minimizeToTray: false,
        tryWinShiftS: false,
        shortcuts: {
          region: "F9",
          screen: "Alt+Shift+2",
          window: "Super+Shift+S",
        },
      },
      tmpDir
    );
    assert.equal(saved.tryWinShiftS, false);
    assert.deepEqual(saved.shortcuts, {
      region: "F9",
      screen: "Alt+Shift+2",
      window: "Super+Shift+S",
    });
    assert.ok(fs.existsSync(getSettingsPath(tmpDir)));
    assert.deepEqual(loadSettings(tmpDir), saved);

    // Partial update preserves existing fields and other shortcut entries
    const afterFlagUpdate = updateSettings({ tryWinShiftS: true }, tmpDir);
    assert.equal(afterFlagUpdate.tryWinShiftS, true);
    assert.equal(afterFlagUpdate.delaySeconds, 3);
    assert.equal(afterFlagUpdate.minimizeToTray, false);
    assert.deepEqual(afterFlagUpdate.shortcuts, {
      region: "F9",
      screen: "Alt+Shift+2",
      window: "Super+Shift+S",
    });

    const afterShortcutUpdate = updateSettings(
      { shortcuts: { region: "Ctrl+Shift+s" } },
      tmpDir
    );
    assert.equal(afterShortcutUpdate.tryWinShiftS, true);
    assert.equal(afterShortcutUpdate.delaySeconds, 3);
    assert.equal(afterShortcutUpdate.minimizeToTray, false);
    assert.deepEqual(afterShortcutUpdate.shortcuts, {
      region: "Control+Shift+S",
      screen: "Alt+Shift+2",
      window: "Super+Shift+S",
    });
    assert.deepEqual(loadSettings(tmpDir), afterShortcutUpdate);

    // Corrupt JSON recovers gracefully to defaults
    fs.writeFileSync(getSettingsPath(tmpDir), "{not valid json!!!", "utf8");
    assert.deepEqual(loadSettings(tmpDir), {
      delaySeconds: 0,
      minimizeToTray: true,
      tryWinShiftS: true,
      gostEnabled: true,
      gostIdleOpacity: 0.3,
      gostPosition: null,
      shortcuts: getDefaultShortcuts(),
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Gost constants and DEFAULT_SETTINGS defaults are properly defined", () => {
  assert.equal(MIN_GOST_OPACITY, 0.15);
  assert.equal(MAX_GOST_OPACITY, 0.85);
  assert.equal(DEFAULT_SETTINGS.gostEnabled, true);
  assert.equal(DEFAULT_SETTINGS.gostIdleOpacity, 0.3);
  assert.equal(DEFAULT_SETTINGS.gostPosition, null);
});

test("sanitizeSettings validates and clamps Modo Gost fields", () => {
  const customFallback = {
    ...DEFAULT_SETTINGS,
    gostEnabled: false,
    gostIdleOpacity: 0.62,
    gostPosition: { x: 300, y: 150 },
  };

  // gostEnabled: booleans accepted, non-booleans fall back safely
  assert.equal(sanitizeSettings({ gostEnabled: false }).gostEnabled, false);
  assert.equal(sanitizeSettings({ gostEnabled: true }, customFallback).gostEnabled, true);
  for (const invalidBool of ["true", 1, 0, null, undefined]) {
    assert.equal(sanitizeSettings({ gostEnabled: invalidBool }).gostEnabled, true);
    assert.equal(sanitizeSettings({ gostEnabled: invalidBool }, customFallback).gostEnabled, false);
  }

  // gostIdleOpacity: in-range values, rounding to 2 decimals, clamping, and fallback
  assert.equal(sanitizeSettings({ gostIdleOpacity: 0.15 }).gostIdleOpacity, 0.15);
  assert.equal(sanitizeSettings({ gostIdleOpacity: 0.5 }).gostIdleOpacity, 0.5);
  assert.equal(sanitizeSettings({ gostIdleOpacity: 0.85 }).gostIdleOpacity, 0.85);
  assert.equal(sanitizeSettings({ gostIdleOpacity: 0.337 }).gostIdleOpacity, 0.34);
  assert.equal(sanitizeSettings({ gostIdleOpacity: 0.334 }).gostIdleOpacity, 0.33);

  for (const low of [0.05, 0, -1]) {
    assert.equal(sanitizeSettings({ gostIdleOpacity: low }).gostIdleOpacity, MIN_GOST_OPACITY);
  }
  for (const high of [0.95, 1, 2]) {
    assert.equal(sanitizeSettings({ gostIdleOpacity: high }).gostIdleOpacity, MAX_GOST_OPACITY);
  }
  for (const invalidOpacity of [NaN, Infinity, -Infinity, "not-a-number", "", null, undefined, true]) {
    assert.equal(sanitizeSettings({ gostIdleOpacity: invalidOpacity }).gostIdleOpacity, 0.3);
    assert.equal(sanitizeSettings({ gostIdleOpacity: invalidOpacity }, customFallback).gostIdleOpacity, 0.62);
  }

  // gostPosition: explicit null, rounded integer coordinates, and safe fallback on invalid inputs
  assert.equal(sanitizeSettings({ gostPosition: null }, customFallback).gostPosition, null);
  assert.deepEqual(sanitizeSettings({ gostPosition: { x: 120.7, y: 84.2 } }).gostPosition, {
    x: 121,
    y: 84,
  });
  assert.deepEqual(sanitizeSettings({ gostPosition: { x: -250.4, y: 0 } }).gostPosition, {
    x: -250,
    y: 0,
  });

  for (const invalidPos of [
    { x: NaN, y: 10 },
    { x: 10, y: Infinity },
    { x: "", y: 10 },
    { x: true, y: 10 },
    "100,200",
    [10, 20],
    123,
    undefined,
  ]) {
    assert.equal(sanitizeSettings({ gostPosition: invalidPos }).gostPosition, null);
    assert.deepEqual(
      sanitizeSettings({ gostPosition: invalidPos }, customFallback).gostPosition,
      { x: 300, y: 150 }
    );
  }
});

test("saveSettings, loadSettings, and updateSettings persist and update Modo Gost state", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "screensnap-gost-test-"));
  try {
    const saved = saveSettings(
      {
        gostEnabled: false,
        gostIdleOpacity: 0.65,
        gostPosition: { x: 420, y: 310 },
      },
      tmpDir
    );
    assert.equal(saved.gostEnabled, false);
    assert.equal(saved.gostIdleOpacity, 0.65);
    assert.deepEqual(saved.gostPosition, { x: 420, y: 310 });
    assert.deepEqual(loadSettings(tmpDir), saved);

    // Partial update of opacity preserves gostEnabled and gostPosition
    const afterOpacityUpdate = updateSettings({ gostIdleOpacity: 0.25 }, tmpDir);
    assert.equal(afterOpacityUpdate.gostEnabled, false);
    assert.equal(afterOpacityUpdate.gostIdleOpacity, 0.25);
    assert.deepEqual(afterOpacityUpdate.gostPosition, { x: 420, y: 310 });
    assert.deepEqual(loadSettings(tmpDir), afterOpacityUpdate);

    // Partial update clearing gostPosition preserves gostEnabled and gostIdleOpacity
    const afterClearPosition = updateSettings({ gostPosition: null }, tmpDir);
    assert.equal(afterClearPosition.gostEnabled, false);
    assert.equal(afterClearPosition.gostIdleOpacity, 0.25);
    assert.equal(afterClearPosition.gostPosition, null);
    assert.deepEqual(loadSettings(tmpDir), afterClearPosition);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

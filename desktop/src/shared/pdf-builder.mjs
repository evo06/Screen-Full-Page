const encoder = new TextEncoder();

/**
 * PDF 1.4 maximum standard user-unit page dimension (200 inches * 72 pt/in).
 */
export const MAX_PDF_PAGE_PT = 14400;
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;

/**
 * Build a valid multi-page PDF 1.4 binary embedding JPEG images via /DCTDecode.
 * Each page entry must specify:
 * - jpegBytes: Uint8Array | ArrayBuffer
 * - pxWidth: number
 * - pxHeight: number
 * - pageWidthPt: number
 * - pageHeightPt: number
 * - drawXPt: number
 * - drawYPt: number
 * - drawWidthPt: number
 * - drawHeightPt: number
 *
 * @param {Array<object>} pages
 * @returns {Uint8Array}
 */
export function buildPdfFromJpegs(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("Nenhuma página informada para gerar PDF.");
  }

  const chunks = [];
  let byteOffset = 0;

  const pushBytes = (bytes) => {
    chunks.push(bytes);
    byteOffset += bytes.length;
  };
  const pushText = (text) => pushBytes(encoder.encode(text));

  // Header with binary comment bytes so tools treat the file as binary PDF
  pushBytes(
    new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a,
      0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
    ])
  );

  // Object 1: Catalog, Object 2: Pages root, then 3 objects per page
  const totalObjects = 2 + pages.length * 3;
  const offsets = new Array(totalObjects + 1).fill(0);

  const pageIds = [];
  for (let i = 0; i < pages.length; i++) {
    pageIds.push(3 + i * 3);
  }

  const writeObj = (id, writeBody) => {
    offsets[id] = byteOffset;
    pushText(`${id} 0 obj\n`);
    writeBody();
    pushText("\nendobj\n");
  };

  writeObj(1, () => {
    pushText("<< /Type /Catalog /Pages 2 0 R >>");
  });

  writeObj(2, () => {
    const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
    pushText(`<< /Type /Pages /Kids [ ${kids} ] /Count ${pages.length} >>`);
  });

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const jpegBytes = normalizeJpegBytes(p?.jpegBytes, i);
    assertPositiveFinite(p.pxWidth, "pxWidth", i);
    assertPositiveFinite(p.pxHeight, "pxHeight", i);
    assertPositiveFinite(p.pageWidthPt, "pageWidthPt", i);
    assertPositiveFinite(p.pageHeightPt, "pageHeightPt", i);
    assertFinite(p.drawXPt, "drawXPt", i);
    assertFinite(p.drawYPt, "drawYPt", i);
    assertPositiveFinite(p.drawWidthPt, "drawWidthPt", i);
    assertPositiveFinite(p.drawHeightPt, "drawHeightPt", i);

    const pageId = 3 + i * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;

    const pw = fmtNum(p.pageWidthPt);
    const ph = fmtNum(p.pageHeightPt);
    const dx = fmtNum(p.drawXPt);
    const dy = fmtNum(p.drawYPt);
    const dw = fmtNum(p.drawWidthPt);
    const dh = fmtNum(p.drawHeightPt);

    writeObj(pageId, () => {
      pushText(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] ` +
          `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`
      );
    });

    const streamCmd = `q\n${dw} 0 0 ${dh} ${dx} ${dy} cm\n/Im0 Do\nQ\n`;
    const streamBytes = encoder.encode(streamCmd);
    writeObj(contentId, () => {
      pushText(`<< /Length ${streamBytes.length} >>\nstream\n`);
      pushBytes(streamBytes);
      pushText("endstream");
    });

    writeObj(imageId, () => {
      pushText(
        `<< /Type /XObject /Subtype /Image /Width ${Math.round(p.pxWidth)} /Height ${Math.round(p.pxHeight)} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
      );
      pushBytes(jpegBytes);
      pushText("\nendstream");
    });
  }

  const xrefOffset = byteOffset;
  pushText(`xref\n0 ${totalObjects + 1}\n`);
  pushText("0000000000 65535 f \n");
  for (let id = 1; id <= totalObjects; id++) {
    pushText(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }

  pushText(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  const out = new Uint8Array(byteOffset);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

function normalizeJpegBytes(raw, pageIndex) {
  const bytes =
    raw instanceof Uint8Array
      ? raw
      : raw instanceof ArrayBuffer
        ? new Uint8Array(raw)
        : null;
  if (!bytes || bytes.length === 0) {
    throw new Error(`Página ${pageIndex + 1} sem bytes JPEG válidos.`);
  }
  return bytes;
}

function assertFinite(value, field, pageIndex) {
  if (!Number.isFinite(value)) {
    throw new Error(`Página ${pageIndex + 1} com campo numérico inválido: ${field}.`);
  }
}

function assertPositiveFinite(value, field, pageIndex) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Página ${pageIndex + 1} exige ${field} > 0.`);
  }
}

function fmtNum(n) {
  const formatted = Number(n).toFixed(2).replace(/\.00$/, "");
  return formatted === "-0" ? "0" : formatted;
}

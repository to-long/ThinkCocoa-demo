/**
 * XLSX → PDF via headless LibreOffice.
 *
 * The reports ARE their templates: merged header bands, brand colours,
 * column widths, a cover page. Redrawing that in a PDF library means
 * reimplementing a spreadsheet renderer and still getting it wrong, so
 * the PDF is the workbook itself, printed by something that understands
 * xlsx. Measured on the demo set: 0.5–1.6s per report, ~360 MB of
 * `libreoffice-calc --no-install-recommends` on the box.
 *
 * Two things the conversion needs from us, both learned the hard way:
 *
 *   1. PAGE SETUP. The templates carry none, so Calc slices 19 columns
 *      into vertical strips and repeats the whole table for each —
 *      1091 pages for 1008 rows. We stamp landscape + fit-to-width onto
 *      every sheet before converting. Only on the PDF path; the XLSX
 *      download keeps the template exactly as authored.
 *
 *   2. RECALCULATION. ExcelJS writes `=COUNTA(...)` with no cached
 *      result, and LibreOffice does not recalculate xlsx on load by
 *      default — "Total plots registered" printed 1 instead of 1008. A
 *      throwaway user profile with `OOXMLRecalcMode = 0` (always) fixes
 *      it at conversion time. Writing cached results in the generators
 *      would fix it at the source AND for the xlsx download; until then
 *      this keeps the PDF honest.
 */

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

/** Override when the binary isn't on PATH (macOS: the app bundle). */
const SOFFICE = process.env.SOFFICE_BIN ?? 'soffice';
/** Generous: a cold LibreOffice start is ~1s, a big sheet ~2s more. */
const TIMEOUT_MS = 60_000;

/**
 * Landscape, one page wide, header rows repeated. Applied to a COPY of
 * the workbook — see the note above about leaving the xlsx untouched.
 */
async function withPrintLayout(xlsx: Buffer): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
  for (const ws of wb.worksheets) {
    ws.pageSetup = {
      ...ws.pageSetup,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      // 0 = as many pages tall as it takes; only the WIDTH is pinned.
      fitToHeight: 0,
      paperSize: 9, // A4
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Minimal LibreOffice profile whose only job is "always recalculate". */
const RECALC_PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <item oor:path="/org.openoffice.Office.Calc/Formula/Load">
    <prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop>
  </item>
</oor:items>
`;

function runSoffice(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(SOFFICE, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (c: Buffer) => {
      stderr = (stderr + c.toString()).slice(-1000);
    });
    child.stdout?.resume();
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`LibreOffice timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? new Error(
              `LibreOffice not found (tried "${SOFFICE}"). Install libreoffice-calc, or set SOFFICE_BIN.`,
            )
          : err,
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`LibreOffice exited ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
    });
  });
}

export async function xlsxToPdf(xlsx: Buffer, baseName: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'tc-pdf-'));
  try {
    const src = path.join(dir, `${baseName}.xlsx`);
    await writeFile(src, await withPrintLayout(xlsx));

    // Every run gets its OWN profile directory. LibreOffice refuses to
    // start a second instance against a profile already in use, so a
    // shared one would serialise (or fail) concurrent report runs.
    const profile = path.join(dir, 'profile');
    // The setting has to live at the path LibreOffice reads on startup —
    // <profile>/user/registrymodifications.xcu. Dropping the file
    // anywhere else does nothing, silently, which is how the first
    // version still printed a stale 1 for a COUNTA over 1008 rows.
    await mkdir(path.join(profile, 'user'), { recursive: true });
    await writeFile(path.join(profile, 'user', 'registrymodifications.xcu'), RECALC_PROFILE);

    await runSoffice(
      [
        '--headless',
        '--norestore',
        '--invisible',
        `-env:UserInstallation=file://${profile}`,
        '--convert-to',
        'pdf:calc_pdf_Export',
        '--outdir',
        dir,
        src,
      ],
      dir,
    );

    return await readFile(path.join(dir, `${baseName}.pdf`));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

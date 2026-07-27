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
 *      every sheet before converting, and HIDE every row past the last
 *      one carrying a value. The templates style a fixed-height data area
 *      — 5005 bordered rows for 112 of data — and Calc printed all of it:
 *      64 pages, 62 of them an empty grid. Hiding those rows brings it to
 *      2. Only on the PDF path; the XLSX download keeps the template
 *      exactly as authored.
 *
 *      Two things that do NOT work, tried in this order: a print area
 *      clipped to the content (ExcelJS writes `_xlnm.Print_Area`,
 *      LibreOffice ignores it) and `spliceRows` (leaves `rowCount` and the
 *      sheet `dimension` at 5005, so the rows come back on write).
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
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

/**
 * The `soffice` binary. `SOFFICE_BIN` wins; otherwise PATH, which is how
 * the Debian package installs it. The macOS cask does NOT put anything on
 * PATH — it drops an app bundle — so that path is probed too, or every
 * developer on a Mac has to export the variable before `bun run dev`.
 */
const MAC_SOFFICE = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
/** The Docker shim, relative to the BE's cwd (apps/be in dev and prod). */
const DOCKER_SHIM = 'scripts/soffice-docker.sh';

function sofficeBin(): string {
  const fromEnv = process.env.SOFFICE_BIN;
  // A path that no longer exists is worse than no setting at all: it is
  // usually a stale value from a `.env` the running process read before it
  // changed, and the error it produces names a binary nobody asked for.
  if (fromEnv && !fromEnv.includes('/')) return fromEnv; // bare name → PATH
  if (fromEnv && existsSync(fromEnv)) return path.resolve(fromEnv);
  // `spawn` hands a relative path to execvp, which searches PATH rather
  // than the working directory — so the shim has to be absolute.
  if (existsSync(DOCKER_SHIM)) return path.resolve(DOCKER_SHIM);
  if (process.platform === 'darwin' && existsSync(MAC_SOFFICE)) return MAC_SOFFICE;
  return 'soffice';
}

/**
 * Where to do the work.
 *
 * NOT `$TMPDIR` on macOS: the shim bind-mounts this directory into the
 * container, and Docker Desktop refuses everything under /private/tmp and
 * under ~/Documents ("operation not permitted", macOS privacy). $HOME is
 * allowed, so that is where it goes — no env var to get stale, and one
 * fewer trap to document.
 */
function workRoot(): string {
  return process.platform === 'darwin' ? path.join(homedir(), '.thinkcocoa-tmp') : tmpdir();
}
/** Generous: a cold LibreOffice start is ~1s, a big sheet ~2s more. */
const TIMEOUT_MS = 60_000;

/**
 * Last row that actually carries something.
 *
 * `rowCount` counts anything the template TOUCHED, which includes the
 * borders and fills painted down an empty data area. A cell counts as
 * content when it holds a value; styling alone does not.
 */
function lastRowWithValue(ws: ExcelJS.Worksheet): number {
  let lastRow = 0;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    let rowHasContent = false;
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      const empty = v === null || v === undefined || v === '';
      if (empty) return;
      rowHasContent = true;
    });
    if (rowHasContent && rowNumber > lastRow) lastRow = rowNumber;
  });
  return lastRow;
}

/**
 * Landscape, one page wide, print area clipped to the content. Applied to
 * a COPY of the workbook — see the note above about leaving the xlsx
 * untouched.
 */
async function withPrintLayout(xlsx: Buffer): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
  for (const ws of wb.worksheets) {
    const lastRow = lastRowWithValue(ws);
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
    // Hidden rows are not printed. This is the only one of the three
    // approaches that LibreOffice actually respects — see the note at the
    // top of the file.
    for (let n = lastRow + 1; n <= ws.rowCount; n++) ws.getRow(n).hidden = true;
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
    const bin = sofficeBin();
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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
              `LibreOffice not found (tried "${bin}"). Install libreoffice-calc, or set SOFFICE_BIN.`,
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
  const root = workRoot();
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, 'tc-pdf-'));
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

/**
 * Writing summary formulas that other spreadsheet apps can actually read.
 *
 * An xlsx formula cell is two things: the formula and the value it last
 * evaluated to.
 *
 *     <c r="B2"><f>COUNTA(A5:A5004)</f><v>1008</v></c>
 *                  ^ formula          ^ cached result
 *
 * Only Excel recalculates on open. LibreOffice does not for ooxml (default
 * `OOXMLRecalcMode`), and Google Sheets and Apple Numbers import the cached
 * value and never recalculate. So whatever sits in `<v>` IS the number the
 * client sees.
 *
 * Our templates were authored with sample data, so their cached values are
 * the sample's — `COUNTA` over 1 example row cached as `1`. Loading a
 * template and writing 1008 data rows does not touch that: ExcelJS carries
 * the stale `<v>` straight through to the output. The report opened in
 * Excel read 1008; the same file in Google Sheets read 1. `fullCalcOnLoad`
 * does not help — it is a request, and only Excel and LibreOffice honour
 * it.
 *
 * Hence `setFormula`: every summary cell is rewritten with BOTH the formula
 * (so the workbook stays live and auditable — a reviewer can widen the range
 * and see it recompute) and the result we already hold in memory. The
 * formula is passed explicitly rather than reused from the template because
 * several templates point at the wrong column: they were authored against
 * an earlier layout, and a `COUNTIF` over the wrong column is a plausible
 * zero, not a visible error.
 */

import type ExcelJS from 'exceljs';

/** A formula result — `'—'` is the em-dash our `IFERROR` fallbacks use. */
export type FormulaResult = number | string;

/**
 * Write `formula` into `addr` along with its already-computed `result`.
 *
 * Pass the formula even when the template already holds it: it documents at
 * the call site which range the number came from, and it is the only way to
 * repoint a formula the template got wrong.
 */
export function setFormula(
  sheet: ExcelJS.Worksheet,
  addr: string,
  formula: string,
  result: FormulaResult,
): void {
  sheet.getCell(addr).value = { formula, result } as ExcelJS.CellValue;
}

/** Rows matching a predicate — the TS twin of `COUNTIF`. */
export function countWhere<T>(rows: readonly T[], pred: (row: T) => boolean): number {
  let n = 0;
  for (const row of rows) if (pred(row)) n++;
  return n;
}

/** Sum of a numeric field, skipping null/undefined/NaN — twin of `SUM`. */
export function sumOf<T>(rows: readonly T[], pick: (row: T) => number | null | undefined): number {
  let total = 0;
  for (const row of rows) {
    const v = pick(row);
    if (typeof v === 'number' && Number.isFinite(v)) total += v;
  }
  return total;
}

/** Distinct non-empty values — twin of the `SUMPRODUCT(1/COUNTIF(…))` idiom. */
export function distinctCount<T>(
  rows: readonly T[],
  pick: (row: T) => string | null | undefined,
): number {
  const seen = new Set<string>();
  for (const row of rows) {
    const v = pick(row);
    if (v) seen.add(v);
  }
  return seen.size;
}

/**
 * Share of `numerator` in `denominator`, or the em-dash the templates'
 * `IFERROR(…,"—")` wrappers fall back to. Returns a fraction, not a
 * percentage — the cells carry a `0%` number format.
 */
export function ratioOr<T extends string>(
  numerator: number,
  denominator: number,
  fallback: T = '—' as T,
): number | T {
  return denominator === 0 ? fallback : numerator / denominator;
}

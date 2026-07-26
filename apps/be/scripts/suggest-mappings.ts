import 'dotenv/config';
import ExcelJS from 'exceljs';

const KOBO_TOKEN = process.env.KOBO_API_KEY;
if (!KOBO_TOKEN) throw new Error('KOBO_API_KEY env var is required — see apps/be/.env');
const ASSET = process.env.KOBO_ASSET_UID ?? 'atvYAbbMA2jfvHVQGwSEFi';
const res = await fetch(`https://kf.kobotoolbox.org/api/v2/assets/${ASSET}/?format=json`, {
  headers: { Authorization: `Token ${KOBO_TOKEN}`, Accept: 'application/json' },
});
// biome-ignore lint/suspicious/noExplicitAny: script data
const asset: any = await res.json();
// biome-ignore lint/suspicious/noExplicitAny: script data
const survey: any[] = asset.content.survey ?? [];
const groupStack: string[] = [];
const koboFields: Record<string, { path: string; label: string; list: string | null }> = {};
for (const item of survey) {
  const t = item.type;
  if (t === 'begin_group' || t === 'begin_repeat') {
    groupStack.push(item.name ?? '');
    continue;
  }
  if (t === 'end_group' || t === 'end_repeat') {
    groupStack.pop();
    continue;
  }
  if (!item.name) continue;
  const path = [...groupStack, item.name].filter(Boolean).join('/');
  const label = Array.isArray(item.label) ? (item.label[0] ?? '') : (item.label ?? '');
  koboFields[path] = { path, label: String(label), list: item.select_from_list_name ?? null };
}
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(
  '/Users/long.to/Documents/PRIVATE/ThinkCocoa-Project/docs/Internal_Inspection_Form updated 2026 - feedback Richard.xlsx',
);
const sheet = wb.worksheets[0];
const STOP = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'do',
  'does',
  'did',
  'of',
  'to',
  'and',
  'or',
  'for',
  'in',
  'on',
  'at',
  'that',
  'this',
  'with',
  'have',
  'has',
  'from',
  'by',
  'as',
  'it',
  'be',
]);
const wordSet = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/^[\d.-]+\s*/, '')
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i);
};

// Specifically: 26 skipped QIDs
const TARGETS = [
  '3.4',
  '4.5',
  '4.8',
  '5.2',
  '5.5',
  '5.6',
  '6.11',
  '6.12',
  '6.13',
  '6.14',
  '6.17',
  '7.7',
  '7.13',
  '7.18',
  '7.25',
  '7.30',
  '7.32',
  '7.34',
  '7.36',
  '7.37',
  '7.39',
  '7.42',
  '7.43',
  '8.8',
  '8.14',
  '8.20',
];
const targets = new Set(TARGETS);

for (let r = 2; r <= sheet.rowCount; r++) {
  const row = sheet.getRow(r);
  // biome-ignore lint/suspicious/noExplicitAny: script data
  const qidCell = row.getCell('B').value as any;
  const qid = String(qidCell?.result ?? qidCell ?? '').trim();
  if (!targets.has(qid)) continue;
  const qt = String(row.getCell('D').value ?? '').trim();
  const qSet = wordSet(qt);
  const candidates: { path: string; label: string; score: number }[] = [];
  for (const f of Object.values(koboFields)) {
    if (/^\d+[a-z]--/.test(f.label.trim())) continue;
    candidates.push({ path: f.path, label: f.label, score: jaccard(qSet, wordSet(f.label)) });
  }
  candidates.sort((a, b) => b.score - a.score);
  console.log(`\nQID ${qid}: "${qt.slice(0, 90)}"`);
  for (const c of candidates.slice(0, 3)) {
    console.log(`  ${c.score.toFixed(2)} → ${c.path} "${c.label.slice(0, 80)}"`);
  }
}

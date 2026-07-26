import 'dotenv/config';
import ExcelJS from 'exceljs';
import { Client } from 'pg';

const KOBO_TOKEN = process.env.KOBO_API_KEY;
if (!KOBO_TOKEN) throw new Error('KOBO_API_KEY env var is required — see apps/be/.env');
const ASSET = process.env.KOBO_ASSET_UID ?? 'atvYAbbMA2jfvHVQGwSEFi';

// 1. Load Kobo
const res = await fetch(`https://kf.kobotoolbox.org/api/v2/assets/${ASSET}/?format=json`, {
  headers: { Authorization: `Token ${KOBO_TOKEN}`, Accept: 'application/json' },
});
// biome-ignore lint/suspicious/noExplicitAny: script data
const asset: any = await res.json();
// biome-ignore lint/suspicious/noExplicitAny: script data
const survey: any[] = asset.content.survey ?? [];
// biome-ignore lint/suspicious/noExplicitAny: script data
const choices: any[] = asset.content.choices ?? [];
const groupStack: string[] = [];
const koboFields: Record<
  string,
  { name: string; path: string; label: string; list: string | null }
> = {};
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
  koboFields[path] = {
    name: item.name,
    path,
    label: String(label),
    list: item.select_from_list_name ?? null,
  };
}
const choiceByList = new Map<string, Map<string, string>>();
for (const c of choices) {
  if (!c.list_name || !c.name) continue;
  const label = Array.isArray(c.label) ? (c.label[0] ?? '') : (c.label ?? '');
  if (!choiceByList.has(c.list_name)) choiceByList.set(c.list_name, new Map());
  choiceByList.get(c.list_name)!.set(c.name, String(label));
}

// 2. Excel
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(
  '/Users/long.to/Documents/PRIVATE/ImpactCocoa-Project/docs/Internal_Inspection_Form updated 2026 - feedback Richard.xlsx',
);
const sheet = wb.worksheets[0];
interface ExcelQ {
  qid: string;
  section: string;
  questionText: string;
  options: string[];
  ao: (number | null)[];
}
const excelScored: ExcelQ[] = [];
for (let r = 2; r <= sheet.rowCount; r++) {
  const row = sheet.getRow(r);
  // biome-ignore lint/suspicious/noExplicitAny: script data
  const qidCell = row.getCell('B').value as any;
  const qid = String(qidCell?.result ?? qidCell ?? '').trim();
  const section = String(row.getCell('A').value ?? '').trim();
  const qt = String(row.getCell('D').value ?? '').trim();
  if (!qt) continue;
  const options = ['E', 'F', 'G', 'H']
    .map((c) => row.getCell(c).value)
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
  const scoringYn = String(row.getCell('I').value ?? '')
    .trim()
    .toUpperCase();
  const ao = ['J', 'K', 'L', 'M', 'N'].map((c) => {
    const v = row.getCell(c).value;
    return typeof v === 'number' ? v : null;
  });
  if (scoringYn === 'YES') excelScored.push({ qid, section, questionText: qt, options, ao });
}

// 3. Fuzzy match
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

const Q_T = 0.5,
  O_T = 0.4;
// biome-ignore lint/correctness/noUnusedVariables: script data
interface ScoreEntry {
  qid: string;
  koboPath: string;
  ao: number;
  choiceName: string;
}
const lookup: Map<string, Map<string, number>> = new Map(); // koboPath → choiceName → points
const includedQs: string[] = [];
const skippedQs: { qid: string; reason: string }[] = [];
let theoreticalMax = 0;

for (const q of excelScored) {
  const qSet = wordSet(q.questionText);
  let bestPath: string | null = null;
  let bestScore = 0;
  for (const [path, f] of Object.entries(koboFields)) {
    if (/^\d+[a-z]--/.test(f.label.trim())) continue;
    const s = jaccard(qSet, wordSet(f.label));
    if (s > bestScore) {
      bestScore = s;
      bestPath = path;
    }
  }
  if (!bestPath || bestScore < Q_T) {
    skippedQs.push({ qid: q.qid, reason: `low question match (${bestScore.toFixed(2)})` });
    continue;
  }
  const field = koboFields[bestPath]!;
  const list = field.list ? (choiceByList.get(field.list) ?? null) : null;
  if (!list) {
    skippedQs.push({ qid: q.qid, reason: `no choice list (${bestPath})` });
    continue;
  }
  // Map each option
  const optMaps: { choiceName: string; ao: number }[] = [];
  let optOk = true;
  for (let i = 0; i < q.options.length; i++) {
    const optText = q.options[i];
    const optAo = q.ao[i];
    if (optAo == null) continue;
    let bestChoice: string | null = null;
    let bestOptScore = 0;
    for (const [name, label] of list.entries()) {
      const s = jaccard(wordSet(optText), wordSet(label));
      if (s > bestOptScore) {
        bestOptScore = s;
        bestChoice = name;
      }
    }
    if (!bestChoice || bestOptScore < O_T) {
      optOk = false;
      break;
    }
    optMaps.push({ choiceName: bestChoice, ao: optAo });
  }
  if (!optOk || optMaps.length === 0) {
    skippedQs.push({ qid: q.qid, reason: `low option match (${bestPath})` });
    continue;
  }
  // Add to lookup
  if (!lookup.has(bestPath)) lookup.set(bestPath, new Map());
  for (const m of optMaps) lookup.get(bestPath)!.set(m.choiceName, m.ao);
  includedQs.push(q.qid);
  theoreticalMax += Math.max(...optMaps.map((m) => m.ao));
}
console.log(`Included questions: ${includedQs.length}/${excelScored.length}`);
console.log(`Skipped: ${skippedQs.length}`);
for (const s of skippedQs.slice(0, 30)) console.log(`  - ${s.qid}: ${s.reason}`);
console.log(`Theoretical max (sum of max AO per included question): ${theoreticalMax}`);

// 4. Connect DB and score each inspection
const pg = new Client({
  host: 'localhost',
  port: 5539,
  user: 'postgres',
  password: 'postgres',
  database: 'thinkcocoa',
});
await pg.connect();
const r = await pg.query(
  `SELECT id, raw_data, farmer_id, date_inspection FROM inspection.inspections ORDER BY date_inspection`,
);
console.log(`\nInspections to score: ${r.rows.length}`);

// 5. Year sequence per farmer
const seqPerFarmer = new Map<string, number>();
const results: {
  id: number;
  pct: number;
  score: number;
  max: number;
  status: string;
  year: number;
  disqualified: boolean;
}[] = [];

function bucket(pct: number, year: number): string {
  if (year >= 5) {
    if (pct >= 90) return 'Certified';
    if (pct >= 50) return 'Certified with CA';
    if (pct >= 25) return 'Not Certified';
    return 'Disqualified';
  }
  const cert = { 1: 60, 2: 70, 3: 75, 4: 80 }[year] ?? 60;
  if (pct >= cert) return 'Certified';
  if (pct >= 50) return 'Certified with CA';
  if (pct >= 25) return 'Not Certified';
  return 'Disqualified';
}

for (const row of r.rows) {
  const raw = row.raw_data;
  const farmer = row.farmer_id ?? '__no_farmer__';
  const yearSeq = (seqPerFarmer.get(farmer) ?? 0) + 1;
  seqPerFarmer.set(farmer, yearSeq);

  let score = 0;
  let disqualified = false;
  let _questionsAnswered = 0;
  for (const [path, choiceMap] of lookup.entries()) {
    const v = raw[path];
    if (v == null || v === '') continue;
    if (v === 'D' || v === 'disqualified') {
      disqualified = true;
      continue;
    }
    const pts = choiceMap.get(String(v));
    if (pts == null) continue;
    score += pts;
    _questionsAnswered++;
  }
  const pct = theoreticalMax > 0 ? Math.round((score / theoreticalMax) * 10000) / 100 : 0;
  const status = disqualified ? 'Disqualified' : bucket(pct, Math.min(yearSeq, 5));
  results.push({
    id: row.id,
    pct,
    score,
    max: theoreticalMax,
    status,
    year: yearSeq,
    disqualified,
  });
}

console.log('\n=== Score distribution ===');
const buckets = {
  '0-24': 0,
  '25-49': 0,
  '50-59': 0,
  '60-69': 0,
  '70-79': 0,
  '80-89': 0,
  '90-100': 0,
  '100+': 0,
};
for (const x of results) {
  const p = x.pct;
  if (p < 25) buckets['0-24']++;
  else if (p < 50) buckets['25-49']++;
  else if (p < 60) buckets['50-59']++;
  else if (p < 70) buckets['60-69']++;
  else if (p < 80) buckets['70-79']++;
  else if (p < 90) buckets['80-89']++;
  else if (p <= 100) buckets['90-100']++;
  else buckets['100+']++;
}
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k}%: ${v}`);

console.log('\n=== Status distribution ===');
const stats: Record<string, number> = {};
for (const x of results) stats[x.status] = (stats[x.status] ?? 0) + 1;
for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v}`);

console.log('\n=== Year distribution ===');
const yearStats: Record<number, number> = {};
for (const x of results) yearStats[x.year] = (yearStats[x.year] ?? 0) + 1;
for (const [k, v] of Object.entries(yearStats).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`  Year ${k}: ${v}`);
}

console.log('\n=== First 10 inspections ===');
for (const x of results.slice(0, 10)) {
  console.log(
    `  id=${x.id} year=${x.year} score=${x.score}/${x.max} pct=${x.pct}% status="${x.status}"${x.disqualified ? ' (D!)' : ''}`,
  );
}

await Bun.write(
  '/tmp/ii-scores.json',
  JSON.stringify({ included: includedQs.length, max: theoreticalMax, results }, null, 2),
);
console.log(`\nSaved /tmp/ii-scores.json (${results.length} rows)`);
await pg.end();

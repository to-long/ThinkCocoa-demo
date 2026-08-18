import 'dotenv/config';
import ExcelJS from 'exceljs';
import { Client } from 'pg';

const KOBO_TOKEN = process.env.KOBO_API_KEY;
if (!KOBO_TOKEN) throw new Error('KOBO_API_KEY env var is required — see apps/be/.env');
const ASSET = process.env.KOBO_ASSET_UID ?? 'atvYAbbMA2jfvHVQGwSEFi';

// Reuse the v2 mapping logic (compact)
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
const choiceListsOrdered = new Map<string, { name: string; label: string }[]>();
for (const c of choices) {
  if (!c.list_name || !c.name) continue;
  const label = Array.isArray(c.label) ? (c.label[0] ?? '') : (c.label ?? '');
  if (!choiceListsOrdered.has(c.list_name)) choiceListsOrdered.set(c.list_name, []);
  choiceListsOrdered.get(c.list_name)!.push({ name: c.name, label: String(label) });
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(
  '/Users/long.to/Documents/PRIVATE/KuanaData-Project/docs/Internal_Inspection_Form updated 2026 - feedback Richard.xlsx',
);
const sheet = wb.worksheets[0];
interface ExcelQ {
  qid: string;
  questionText: string;
  options: string[];
  ao: (number | null)[];
}
const excelScored: ExcelQ[] = [];
for (let r = 2; r <= sheet.rowCount; r++) {
  const row = sheet.getRow(r);
  // biome-ignore lint/suspicious/noExplicitAny: script
  const qidCell = row.getCell('B').value as any;
  const qid = String(qidCell?.result ?? qidCell ?? '').trim();
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
  if (scoringYn === 'YES') excelScored.push({ qid, questionText: qt, options, ao });
}

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

const MANUAL_QUESTION: Record<string, string> = {
  '3.4': 'Management/ListOfWorker',
  '4.8': 'Traceability/RecievedPremium',
  '5.2': 'environment/ForestConversion',
  '5.5': 'environment/NegetiveImpact',
  '5.6': 'environment/LegalRight',
  '6.11': 'environment/VegetationBufferZone',
  '6.12': 'environment/Hunting',
  '6.17': 'environment/EndangeredPlants',
  '7.7': 'FarmingPractices/Fermentation',
  '7.18': 'FarmingPractices/SoilErosion',
  '7.25': 'FarmingPractices/ApplicationPeriod',
  '7.30': 'FarmingPractices/RecordKeepping',
  '7.32': 'FarmingPractices/ProperDispose',
  '7.34': 'FarmingPractices/PesticideStorage',
  '7.36': 'FarmingPractices/PPEUse',
  '7.37': 'FarmingPractices/PPECondition',
  '7.39': 'FarmingPractices/ActivityProtected',
  '7.43': 'FarmingPractices/LockedStorage',
  '8.8': 'Social/FairWage',
  '8.14': 'Social/Freedom',
  '8.20': 'Social/Grievance',
};
const NO_EQUIVALENT = new Set(['4.5', '6.13', '6.14', '7.13', '7.42']);

const Q_T = 0.5,
  O_T_STRICT = 0.4;

interface QuestionMap {
  qid: string;
  koboPath: string;
  choiceToPoints: Map<string, number>;
  maxPoints: number;
  choiceList: { name: string; label: string }[];
}
const included: QuestionMap[] = [];

for (const q of excelScored) {
  if (NO_EQUIVALENT.has(q.qid)) continue;
  let koboPath: string | null = MANUAL_QUESTION[q.qid] ?? null;
  if (!koboPath) {
    const qSet = wordSet(q.questionText);
    let bestScore = 0;
    for (const [path, f] of Object.entries(koboFields)) {
      if (/^\d+[a-z]--/.test(f.label.trim())) continue;
      const s = jaccard(qSet, wordSet(f.label));
      if (s > bestScore) {
        bestScore = s;
        koboPath = path;
      }
    }
    if (bestScore < Q_T) koboPath = null;
  }
  if (!koboPath || !koboFields[koboPath]) continue;
  const list = koboFields[koboPath].list;
  const choiceList = list ? (choiceListsOrdered.get(list) ?? []) : [];
  if (choiceList.length === 0) continue;
  const choiceToPoints = new Map<string, number>();
  let maxPoints = 0;
  for (let i = 0; i < q.options.length; i++) {
    const optText = q.options[i];
    const optAo = q.ao[i];
    if (optAo == null) continue;
    const optSet = wordSet(optText);
    let chosen: { name: string; score: number } | null = null;
    for (const c of choiceList) {
      const s = jaccard(optSet, wordSet(c.label));
      if (!chosen || s > chosen.score) chosen = { name: c.name, score: s };
    }
    if (!chosen || chosen.score < O_T_STRICT) {
      if (i < choiceList.length) chosen = { name: choiceList[i].name, score: -1 };
    }
    if (chosen) {
      choiceToPoints.set(chosen.name, optAo);
      if (optAo > maxPoints) maxPoints = optAo;
    }
  }
  included.push({ qid: q.qid, koboPath, choiceToPoints, maxPoints, choiceList });
}

// Now query DB and tally unmatched
const pg = new Client({
  host: 'localhost',
  port: 5539,
  user: 'postgres',
  password: 'postgres',
  database: 'kuanadata',
});
await pg.connect();
const r = await pg.query(`SELECT id, raw_data FROM inspection.inspections`);

// Tally: { koboPath → { actualAnswerValue → { count, sampleIds[], aoMappedTo|null } } }
type Bucket = { count: number; samples: number[] };
const tally: Record<
  string,
  { qid: string; mapped: Map<string, number>; unmapped: Map<string, Bucket>; empty: Bucket }
> = {};

for (const q of included) {
  tally[q.koboPath] = {
    qid: q.qid,
    mapped: q.choiceToPoints,
    unmapped: new Map(),
    empty: { count: 0, samples: [] },
  };
}

for (const row of r.rows) {
  const raw = row.raw_data;
  for (const q of included) {
    const v = raw[q.koboPath];
    if (v == null || v === '') {
      const e = tally[q.koboPath].empty;
      e.count++;
      if (e.samples.length < 5) e.samples.push(row.id);
      continue;
    }
    const s = String(v);
    if (q.choiceToPoints.has(s)) continue; // matched
    // Unmatched
    const t = tally[q.koboPath].unmapped;
    if (!t.has(s)) t.set(s, { count: 0, samples: [] });
    const b = t.get(s)!;
    b.count++;
    if (b.samples.length < 5) b.samples.push(row.id);
  }
}

console.log('=== UNMATCHED ANSWER VALUES (Kobo answer not in our lookup) ===\n');
let totalUnmatched = 0;
const byPath = Object.entries(tally).sort((a, b) => {
  const sumA = [...a[1].unmapped.values()].reduce((s, x) => s + x.count, 0);
  const sumB = [...b[1].unmapped.values()].reduce((s, x) => s + x.count, 0);
  return sumB - sumA;
});
for (const [path, info] of byPath) {
  if (info.unmapped.size === 0) continue;
  const mappedStrs = [...info.mapped.entries()].map(([n, p]) => `${n}→${p}pt`).join(', ');
  console.log(`QID ${info.qid} · ${path}`);
  console.log(`  Mapped: ${mappedStrs}`);
  for (const [val, b] of [...info.unmapped.entries()].sort((a, b) => b[1].count - a[1].count)) {
    totalUnmatched += b.count;
    // Find the Kobo choice label if any
    const q = included.find((x) => x.koboPath === path)!;
    const choice = q.choiceList.find((c) => c.name === val);
    const labelHint = choice ? ` "${choice.label.slice(0, 70)}"` : ' (NOT IN KOBO CHOICE LIST)';
    console.log(`  ❌ "${val}" × ${b.count}${labelHint} | samples: ${b.samples.join(', ')}`);
  }
  console.log();
}

console.log(`Total unmatched answer cells: ${totalUnmatched}`);

console.log('\n=== EMPTY/MISSING ANSWER VALUES (Kobo skipped the question) ===\n');
const byEmpty = Object.entries(tally)
  .filter(([_, info]) => info.empty.count > 0)
  .sort((a, b) => b[1].empty.count - a[1].empty.count);
let totalEmpty = 0;
for (const [path, info] of byEmpty.slice(0, 30)) {
  totalEmpty += info.empty.count;
  console.log(
    `  QID ${info.qid} · ${path}: ${info.empty.count} empty | samples: ${info.empty.samples.join(', ')}`,
  );
}
console.log(`\nTotal empty cells: ${totalEmpty} across ${byEmpty.length} questions`);

await pg.end();

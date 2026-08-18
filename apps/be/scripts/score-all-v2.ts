import 'dotenv/config';
import ExcelJS from 'exceljs';
import { Client } from 'pg';

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
// Choice lists preserving order
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

// Manual overrides — QIDs the fuzzy matcher missed but with known Kobo paths
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
// QIDs with no Kobo equivalent — skip entirely
const NO_EQUIVALENT = new Set(['4.5', '6.13', '6.14', '7.13', '7.42']);

const Q_T = 0.5;
const O_T_STRICT = 0.4;
const _O_T_FALLBACK = 0.15; // lenient when within known-good Q

interface QuestionMap {
  qid: string;
  koboPath: string;
  choiceToPoints: Map<string, number>;
  maxPoints: number;
}
const included: QuestionMap[] = [];
const skipped: { qid: string; reason: string }[] = [];

for (const q of excelScored) {
  if (NO_EQUIVALENT.has(q.qid)) {
    skipped.push({ qid: q.qid, reason: 'no Kobo equivalent' });
    continue;
  }

  // 1. Resolve Kobo path
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
  if (!koboPath || !koboFields[koboPath]) {
    skipped.push({ qid: q.qid, reason: `unresolved question path` });
    continue;
  }
  const list = koboFields[koboPath].list;
  const choiceList = list ? (choiceListsOrdered.get(list) ?? []) : [];
  if (choiceList.length === 0) {
    skipped.push({ qid: q.qid, reason: `no choice list (${koboPath})` });
    continue;
  }

  // 2. Map each option to a choice
  const choiceToPoints = new Map<string, number>();
  let maxPoints = 0;
  let opt_ok = false;
  for (let i = 0; i < q.options.length; i++) {
    const optText = q.options[i];
    const optAo = q.ao[i];
    if (optAo == null) continue;
    const optSet = wordSet(optText);
    // Try strict match first
    let chosen: { name: string; score: number } | null = null;
    for (const c of choiceList) {
      const s = jaccard(optSet, wordSet(c.label));
      if (!chosen || s > chosen.score) chosen = { name: c.name, score: s };
    }
    if (!chosen || chosen.score < O_T_STRICT) {
      // Fallback: positional (Option_i → choiceList[i])
      if (i < choiceList.length) {
        chosen = { name: choiceList[i].name, score: -1 };
      }
    }
    if (chosen) {
      choiceToPoints.set(chosen.name, optAo);
      if (optAo > maxPoints) maxPoints = optAo;
      opt_ok = true;
    }
  }
  if (!opt_ok) {
    skipped.push({ qid: q.qid, reason: `no options resolved` });
    continue;
  }
  included.push({ qid: q.qid, koboPath, choiceToPoints, maxPoints });
}

console.log(`Included: ${included.length}/${excelScored.length}, Skipped: ${skipped.length}`);
if (skipped.length) {
  console.log('Skipped:');
  for (const s of skipped) console.log(`  - ${s.qid}: ${s.reason}`);
}
const max = included.reduce((s, q) => s + q.maxPoints, 0);
console.log(`Theoretical max: ${max} points (spec target = 142)`);

// 3. Score
const pg = new Client({
  host: 'localhost',
  port: 5539,
  user: 'postgres',
  password: 'postgres',
  database: 'kuanadata',
});
await pg.connect();
const r = await pg.query(
  `SELECT id, raw_data, farmer_id, date_inspection FROM inspection.inspections ORDER BY farmer_id, date_inspection`,
);
const seqPerFarmer = new Map<string, number>();
const results: {
  id: number;
  pct: number;
  score: number;
  max: number;
  status: string;
  year: number;
  disqualified: boolean;
  missing: number;
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

  let score = 0,
    disqualified = false,
    missing = 0;
  for (const q of included) {
    const v = raw[q.koboPath];
    if (v == null || v === '') {
      missing++;
      continue;
    }
    if (v === 'D' || v === 'disqualified') {
      disqualified = true;
      continue;
    }
    const pts = q.choiceToPoints.get(String(v));
    if (pts == null) {
      missing++;
      continue;
    }
    score += pts;
  }
  const pct = max > 0 ? Math.round((score / max) * 10000) / 100 : 0;
  const status = disqualified ? 'Disqualified' : bucket(pct, Math.min(yearSeq, 5));
  results.push({ id: row.id, pct, score, max, status, year: yearSeq, disqualified, missing });
}
await pg.end();

console.log(`\n=== Score distribution (${results.length} rows) ===`);
const dist: Record<string, number> = {
  '0-24': 0,
  '25-49': 0,
  '50-59': 0,
  '60-69': 0,
  '70-79': 0,
  '80-89': 0,
  '90-100': 0,
};
for (const x of results) {
  if (x.pct < 25) dist['0-24']++;
  else if (x.pct < 50) dist['25-49']++;
  else if (x.pct < 60) dist['50-59']++;
  else if (x.pct < 70) dist['60-69']++;
  else if (x.pct < 80) dist['70-79']++;
  else if (x.pct < 90) dist['80-89']++;
  else dist['90-100']++;
}
for (const [k, v] of Object.entries(dist)) console.log(`  ${k}%: ${v}`);

console.log('\n=== Status distribution ===');
const stats: Record<string, number> = {};
for (const x of results) stats[x.status] = (stats[x.status] ?? 0) + 1;
for (const [k, v] of Object.entries(stats).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

console.log(
  '\nAvg missing answers per inspection:',
  (results.reduce((s, x) => s + x.missing, 0) / results.length).toFixed(1),
);
console.log('Sample first 10:');
for (const x of results.slice(0, 10))
  console.log(
    `  id=${x.id} year=${x.year} score=${x.score}/${x.max} pct=${x.pct}% status="${x.status}" missing=${x.missing}`,
  );

await Bun.write(
  '/tmp/ii-scores-v2.json',
  JSON.stringify({ included: included.length, max, skippedQs: skipped, results }, null, 2),
);
console.log(`\nSaved /tmp/ii-scores-v2.json`);

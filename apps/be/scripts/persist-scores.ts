import { Client } from 'pg';

const data = await Bun.file('/tmp/ii-scores-v2.json').json();
const pg = new Client({
  host: 'localhost',
  port: 5539,
  user: 'postgres',
  password: 'postgres',
  database: 'kuanadata',
});
await pg.connect();
await pg.query('BEGIN');
let updated = 0;
for (const r of data.results) {
  await pg.query(
    `UPDATE inspection.inspections
       SET compliance_score = $1,
           compliance_max   = $2,
           compliance_pct   = $3,
           updated_at       = NOW()
     WHERE id = $4`,
    [r.score, r.max, r.pct.toFixed(2), r.id],
  );
  updated++;
}
await pg.query('COMMIT');
console.log(`Updated ${updated} inspections`);
// Verify
const v = await pg.query(
  `SELECT MIN(compliance_pct), MAX(compliance_pct), AVG(compliance_pct)::numeric(5,2), MIN(compliance_max), MAX(compliance_max) FROM inspection.inspections`,
);
console.log('After:', v.rows[0]);
await pg.end();

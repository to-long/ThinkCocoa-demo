# Demo import samples

Ready-to-upload files for demoing the three import surfaces. Everything in
here is synthetic — generated names, phone numbers, Ghana Card numbers and
polygons. No real farmer data.

The three files are **one connected set**: the farmers CSV creates the
parcels that the polygon and EUDR files then attach geometry and compliance
status to. Import them in order.

| # | File | Where to upload | Creates |
|---|------|-----------------|---------|
| 1 | `01-farmers-and-parcels.csv` | **Farmers** → `⋮` → Import CSV | 24 farmers + 30 parcels |
| 2 | `02-parcel-polygons.geojson` | **Farms** → `⋮` → Import Polygons (GeoJSON) | 30 parcel geometries |
| 3 | `03-eudr-status.csv` | **Farms** → `⋮` → Import EUDR CSV | 30 EUDR assessments |

Steps 2 and 3 **skip any parcel ID that isn't already in the database**, so
running them before step 1 reports 30 skipped rows and changes nothing.

## What the data looks like

- 4 farmers in each of the 6 seeded cooperatives (Sankofa, Nkabom, Adwuma,
  Aboma, Ayekoo, Nhyira), IDs `<PREFIX>-9001`…`-9004` — the `9xxx` block
  keeps them clear of the seeded `0001`…`0119` range, so imported rows are
  easy to spot and easy to delete.
- The first farmer of every coop has **two** fields (`-F1`, `-F2`) so the
  multi-parcel case is covered; everyone else has one. 24 farmers → 30 parcels.
- Societies reuse the seeded society names, so the Society filter groups
  imported farmers together with existing ones instead of adding orphan values.
- Polygons sit just east of the seeded cluster (≈ `-2.674, 6.13`, Asankrangwa
  area) — visible next to existing plots on the map, never overlapping them.
  Each polygon's area matches its `FIELD Size`.
- EUDR statuses are mixed on purpose: ~70% Compliant, ~15% Needs Review,
  ~10% Non-Compliant, ~5% Unknown, with matching risk levels — enough spread
  to demo the status filter and the compliance stat cards.

## Column reference

### `01-farmers-and-parcels.csv`

One row per **parcel**. Farmer columns repeat when a farmer has several
fields; the importer dedupes farmers by `ProducerID` (first row wins).

| Column | Required | Notes |
|---|---|---|
| `Coop` | ✅ | Must be one of `Sankofa`, `Nkabom`, `Adwuma`, `Aboma`, `Ayekoo`, `Nhyira`. An unrecognised label skips the row |
| `ProducerID` | ✅ | Becomes the farmer's primary key. Re-importing the same ID **updates** that farmer |
| `Producer` | ✅ | Full name; split into first / last on the first space |
| `FarmerGender` | | `male` \| `female` \| `other`; anything else lands NULL |
| `DOBProducer` | | **Year only** (`1985`) → stored as `1985-01-01`. A full date is rejected |
| `PhoneNumber` | | Free text |
| `GhCard` / `CocoBodCard` | | First value matching `GHA-######-#` wins; sets ID type to `ghana_card` |
| `HHAssessed` | | `Yes`/`No`/`true`/`false`/`1`/`0`; blank → NULL ("not asked") |
| `Society` | | RA society name. Keep the ` Society` suffix to match seeded values |
| `Hhsize`, `NumberChildren` | | Non-negative integers |
| `Field ID` | | Parcel primary key. Blank → farmer imported without a parcel |
| `Field` | | Parcel name |
| `FIELD Size` | | Area in hectares, must be > 0 |

Empty values and the literals `none`, `n/a`, `not available`, `unknown`, `-`
all read as NULL.

### `02-parcel-polygons.geojson`

A `FeatureCollection`. The upload dialog auto-detects the parcel-ID property
(it looks for `Parcel ID`, `Field ID`, `Farm ID`, `ID`, `Code`, …) and lets
you map the capture date by hand — pick `Captured At` to fill
`parcel_geometries.captured_at`, otherwise it stays NULL.

Each feature carries `Parcel ID`, `Producer ID`, `Field`, `Area (ha)`,
`Captured At`, `Source`. Geometry is a `Polygon`; the server wraps it in
`ST_Multi` and stores SRID 4326.

### `03-eudr-status.csv`

Headers are named so the dialog's "Match Headers" step pre-fills every field.

| Column | Required | Accepted values |
|---|---|---|
| `Parcel ID` | ✅ | Must already exist |
| `Date of Assessment` | ✅ | Any parseable date (`2026-05-12`) |
| `Assessed By` | ✅ | Free text |
| `Notes` | ✅ | Free text — blank skips the row |
| `EUDR Status` | ✅ | `Compliant`, `Non-Compliant`, `Needs Review`, `Unknown` |
| `Deforestation Risk`, `Protected Area Risk` | | `Low`, `Medium`, `High` (or blank). Anything else skips the row |
| `Overlap`, `On Land`, `In Country` | | Free text — seeded rows use `none` / `yes` |
| `EUDR Data`, `EUDR Explanation` | | Free text |

Re-importing the same parcel ID overwrites its previous assessment.

## Undoing an import

**Admin → Data Sync → Reset demo data** wipes all operational data and
re-runs the seed, which removes everything these files created and restores
the baseline demo dataset. Users, roles, permissions and cooperatives are
kept, so you stay logged in.

## Regenerating

The files are committed output — there is no build step. Edit them by hand,
or regenerate with a throwaway script if the shape of the demo dataset
changes (coop codes, society names and the seeded ID ranges are the only
things they depend on).

# Think!Cocoa — sales team guide

How to run the demo without a developer. Read sections 1–3 once; keep
section 4 open during a call.

---

## 1. Signing in

| | |
|---|---|
| **URL** | *(staging URL — ask Brenda if you don't have it)* |
| **Email** | `project.leader@thinkdata.com` |
| **Password** | `ThinkData2026!` |

That account sees **all six cooperatives** and every module — what you
want in front of a prospect.

Two others, for "what would *my* team see?":

| Account | Shows |
|---|---|
| `buyer@thinkdata.com` | A buyer's read-only view |
| `field.officer.aboma@thinkdata.com` | One cooperative, field-officer permissions |

Same password for every seeded account.

> The yellow **"Demo Environment — Not for Production Use"** banner is
> deliberate, appears on every screen and on every exported document.
> Leave it on.

---

## 2. Getting around

**The cooperative picker** sits in the top bar. Everything you see —
lists, dashboards, reports — is scoped to the cooperative selected there.
**`Aboma Cocoa` has the fullest data**; use it unless you have a reason
not to.

**The sidebar** groups screens the way the business works:

| Group | Screens |
|---|---|
| Main | Dashboard, Farmers, Farm/Parcel, VSLA |
| Operations | Training, Coaching |
| Traceability | Society Purchase, Primary Evacuation, Secondary Evacuation |
| Compliance | Inspections, CLMRS |
| Reporting | Reports |
| Administration | Cooperatives, Users, Roles, Permissions, Data Sync |

**Every list works the same way.** Learn it once:

- **Search** — free text at the top left (name, code, phone…).
- **Filters** — the dropdowns beside it. A filter that's on shows an `×`;
  click it to clear that one filter. Filters live in the URL, so you can
  paste a filtered view to a colleague and they see exactly the same rows.
- **Sort** — click a column header; click again to reverse.
- **Row → detail** — click the row. Codes with a `↗` jump to that
  record's own page (farmer → their plots, plot → its farmer).
- **History** — the button at the top right of a list opens the audit
  trail for that kind of record.

**Detail pages** all open with a strip of four tiles (the state at a
glance), then cards with the full record.

---

## 3. Resetting

After a call where you edited, imported or deleted things:

**Data Sync → Reset demo data → confirm.**

It wipes every operational table and rebuilds the baseline — farmers,
plots, EUDR verdicts, inspections, coaching, CLMRS, training, purchases,
evacuation, VSLA and the activity feed — then reports what came back.
A few seconds. Logins, roles and cooperatives survive; anything deleted
during the demo comes back.

Reset **before** a call, not after, so you know what the prospect will
see.

Sample import files are in `docs/import-samples/` — farmers, parcels with
polygons, EUDR status — for demonstrating bulk import. Reset afterwards.

---

## 4. The modules

### Dashboard

Four tabs. **Traceability** opens first: purchase volumes, evacuation
lots, payment split. Then **Farmers**, **Farms**, **VSLA** — one tab per
value proposition, all charts.

*Line that works:* "Everything you're about to see rolls up here."

### Farmers

The producer register. The list carries name, society, phone, membership
date, **RA Certificate**, CLMRS status and outstanding corrective actions.

- **Certificate validity filter** — `Expiring in 90 days` is the renewals
  queue. The RA Certificate column shows the expiry with the verdict
  beside it: green `valid`, amber `in 15d`, red `expired`.
- **A farmer's page** — tiles for certificate validity, CLMRS, EUDR
  across their plots, and kilos delivered; then profile, household,
  RA certificate (number, certifying body, audit date, time left),
  plots, coaching and CLMRS history.
- **Add Farmer** — the ⋮ menu also holds **Import CSV**, which
  takes the sample file from `docs/import-samples/`.

*Line that works:* "One screen per producer, and the registration flow
behind it is the same one a field officer uses."

### Farm/Parcel

The land. Plot code, farmer, area, trees, and the three EUDR verdicts —
**Deforestation**, **Protected area**, **Overlap** — each filterable.

- **A plot's page** — the polygon drawn over satellite imagery, with
  **deforestation patches and protected-area boundaries in red**. Switch
  the base layer top right if tiles are slow.
- **Import** — GeoJSON polygons and EUDR status CSV, from the samples
  folder.

*Line that works:* "This is the EUDR due-diligence question answered per
plot, not per shipment."

### Society Purchase → Primary → Secondary Evacuation

The chain of custody, in the order the beans move: bought at the society,
trucked to the district warehouse, shipped to port.

On a **Secondary Evacuation** waybill, expand a primary waybill under
**Lot composition**: waybill → purchases → farmers → plots. Purchase IDs
and waybill numbers are links, so you can walk the chain in both
directions. Unresolved links are flagged with an amber count rather than
hidden.

*Line that works:* "Full traceability both ways, and it tells you where
the data is incomplete instead of pretending it isn't."

### VSLA

Savings groups. Group list with members, cumulative savings and loan
status; a group's page shows the savings cycle and a **member ledger** —
each farmer's balance and loan history.

### CLMRS

Child-labour monitoring. Households assessed, risk classification, and
remediation cases linked to the flagged household. The Farmers list has a
CLMRS column so you can pivot from a producer to their case.

### Training · Coaching · Inspections

Field activity: sessions and attendance, coaching visits, and the
inspections that produce the certification outcome and corrective
actions.

### Reports

Seven templates: EUDR Compliance, Certification Status, Corrective
Actions, Farmer Coaching, Group Member Registry, Traceability, Training
Attendance.

Pick a report, set the date range (and society, if asked), choose
**XLSX** or **CSV**, then **Run**. It appears in the run list within a few
seconds — download it and open it in front of them.

### Notifications (the bell, top right)

Every change in the system: who, what, when, and the field-by-field diff.
Filter by user or record with the ↑ button that appears on hover.
Auditors ask about this.

### Administration

Cooperatives, users, roles and permissions — worth opening if a prospect
asks "who can see what?". Roles are editable and permissions are
per-resource. **Data Sync** is also where the reset lives.

---

## 5. A ten-minute run

Dashboard → Farmers (filter `Expiring in 90 days`, open a farmer) →
Farm/Parcel (open a plot, show the map layers) → Secondary Evacuation
(expand a lot) → VSLA (a group's members) → CLMRS → Reports (run EUDR
Compliance, download) → Notifications.

---

## 6. If something looks wrong

| Symptom | Do this |
|---|---|
| Sent back to the login screen | Sign in again. If it repeats, tell the dev team — don't demo through it. |
| A screen is empty | Check the cooperative picker; you may be on a coop with little data. Try `Aboma Cocoa`. |
| A list looks wrong | Check for an active filter — a filter chip with an `×` — and clear it. |
| Data looks edited or deleted | Reset demo data (section 3). |
| Map tiles don't load | Network. Switch the layer control to Open Street Map. |
| A report won't download | Re-run it; if it fails twice, tell the dev team. |

Anything else: Brenda, `brenda@thinkdataservices.com`.

---

## 7. Questions you'll get

- **"Is this real data?"** No. Every farmer, plot, coordinate and
  transaction is synthetic, generated for this demo. No client data is in
  it.
- **"Can we get a copy?"** It's a hosted demo. Deploying against a
  prospect's own data is a separate conversation with the team.
- **"Can I click around myself?"** Yes — that's what the reset is for.
- **"Does it work on my phone?"** It's built for a laptop browser. Screens
  reflow on a tablet; the maps and wide tables want a real screen.

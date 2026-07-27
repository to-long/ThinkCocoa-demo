# Think!Cocoa — sales demo guide

Everything you need to run the demo without a developer. Two pages: sign
in, the ten-minute walkthrough, and how to put it back the way you found
it.

---

## 1. Signing in

| | |
|---|---|
| **URL** | *(staging URL — ask Brenda if you don't have it)* |
| **Email** | `project.leader@thinkdata.com` |
| **Password** | `ThinkData2026!` |

That account sees **all six cooperatives** and every module, which is what
you want in front of a prospect.

Two other logins, for when a prospect asks "what does *my* team see?":

| Account | Password | What it shows |
|---|---|---|
| `buyer@thinkdata.com` | `ThinkData2026!` | A buyer's read-only view |
| `field.officer.aboma@thinkdata.com` | `ThinkData2026!` | One cooperative, field-officer permissions |

Every seeded account uses the same password. The cooperative picker sits
in the top bar — switch it to change which cooperative's data you see.
`Aboma Cocoa` is the fullest one; use it unless you have a reason not to.

> The yellow **"Demo Environment — Not for Production Use"** banner is
> deliberate and appears on every screen and every exported document.
> Leave it on.

---

## 2. The ten-minute walkthrough

Follow it in order — it tracks a bean from the farmer to the port, which
is the story the platform tells.

**① Dashboard** *(lands here after sign-in)*
Opens on the **Traceability** tab: purchase volumes, evacuation lots,
payment split. Then click through **Farmers**, **Farms** and **VSLA** —
one tab per value proposition, all charts, no scrolling needed.
*Say:* "Everything you're about to see rolls up here."

**② Farmers → a farmer**
Click any name. Profile, household, plots, coaching history, CLMRS
assessments, certification — one screen per producer.
*Then:* set the **Expiring in 90 days** filter on the list. That is the
renewals queue, straight off the RA certificate dates.

**③ Farms** → open a plot → the map
The plot's polygon drawn over satellite, with **deforestation patches and
protected-area boundaries** in red. Back on the list, the
**Deforestation / Protected area / Overlap** columns filter the whole book
by EUDR verdict.
*Say:* "This is the EUDR due-diligence question, answered per plot."

**④ Secondary Evacuation → a waybill**
Expand a primary waybill in **Lot composition**: waybill → purchases →
farmers → plots. Click a purchase ID to jump to the purchase, or the
primary waybill to jump up the chain.
*Say:* "Full chain of custody, both directions, no spreadsheets."

**⑤ VSLA → a group**
Savings cycle, loans, repayment rate, and the member ledger with each
farmer's balance and loan history.

**⑥ CLMRS**
Households assessed, risk classification, and remediation cases linked to
the flagged household.

**⑦ Reports**
Pick **EUDR Compliance**, a date range, **XLSX**, then **Run**. It appears
in the run list in a few seconds; download it and open it in front of
them. Seven report templates ship with the demo.

**⑧ Notifications** *(if there's time)*
Every change in the system, who made it, and what changed field by field.
Auditors ask about this.

---

## 3. Resetting the demo

After a call where you edited, imported or deleted things:

**Sync Settings → Reset demo data → confirm.**

It wipes every operational table and rebuilds the baseline — farmers,
plots, EUDR verdicts, inspections, coaching, CLMRS, training, purchases,
evacuation, VSLA and the activity feed — then reports what came back.
Takes a few seconds. Logins, roles and cooperatives survive; anything you
deleted during the demo comes back.

Reset before a call rather than after, so you know exactly what the
prospect will see.

**Sample import files** live in `docs/import-samples/` — farmers, parcels
with polygons, and EUDR status — for demonstrating bulk import. Reset
afterwards.

---

## 4. If something looks wrong

| Symptom | Do this |
|---|---|
| Sent back to the login screen | Sign in again. If it repeats, tell the dev team — don't demo through it. |
| A screen is empty | Check the cooperative picker in the top bar; you may be on a coop with little data. Try `Aboma Cocoa`. |
| Data looks edited or deleted | Reset demo data (section 3). |
| Map tiles don't load | Network — the satellite layer is fetched live. Switch the layer control to Open Street Map. |

Anything else: Brenda, `brenda@thinkdataservices.com`.

---

## 5. What to say if asked

- **"Is this real data?"** No. Every farmer, plot, coordinate and
  transaction is synthetic, generated from scratch for this demo. No
  client data is in it.
- **"Can we get a copy?"** It's a hosted demo. Deployment for a
  prospect's own data is a separate conversation with the team.
- **"Can I click around myself?"** Yes — that's what the reset is for.

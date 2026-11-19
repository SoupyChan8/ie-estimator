# Interior Editors · Estimate

An iPad cost-estimation app for Interior Editors. In front of the client, you pick the home size, scope and finish, show an instant estimate (rates can be adjusted while negotiating), and both sides sign a letter of engagement. The **Studio** (behind a password) manages the rate book, saved versions, signed contracts and branded PDF quotations.

Live: **https://soupychan8.github.io/ie-estimator/**

| Part | What it uses |
|---|---|
| App | React + Vite + TypeScript, hosted free on GitHub Pages. `.github/workflows/deploy.yml` builds and publishes every push to `main`. |
| Database, logins, PDFs | [Supabase](https://supabase.com) free plan, Mumbai region. Postgres tables, Supabase Auth, and a private `quotations` storage bucket. |
| Backup | A Google Sheet with Apps Script (`apps-script/`). Every night it copies everything from Supabase into "Backup …" tabs, which also stops the free project from pausing. |

## How the client flow works

1. **Home**: BHK (1–4) and carpet area.
2. **Scope**: rooms and pieces, with add-ons nested under their main item (e.g. Puja Unit under TV Unit). A room appears only if one of its main items applies to that BHK.
3. **Sizes**: quantities start from the rate book defaults and can be changed. "Carpet area" items (painting, false ceiling, wiring, flooring) take the carpet area as their quantity.
4. **Finish**: Standard, Premium or Luxury.
5. **Estimate**: the total and a room-by-room breakdown. Tap ✏️ next to any rate to change it while negotiating. The old total is shown struck through, with a "You save ₹…" badge, and ↺ restores the rate book rate.
6. **Details** and **Agreement**: client details, then both signatures. Saving stores the contract with the agreed rates; the rate book rate is kept alongside each changed line for reference.

## The Studio

Open it from the estimator (lock icon). It asks for the password again and locks itself after 30 minutes.

- **Contracts**: every signed agreement, each with a 🗑 delete button. Opening one gives:
  - **Quotation details**:
    - The quotation number. Changing it renames the contract, and duplicate numbers are refused.
    - The quotation validity.
    - The *Previous digital signature* switch: on shows the iPad signatures; off leaves blank lines for signing on paper.
    - Included / not-included points. Drag the ⋮⋮ handle to reorder them.
    - Payment schedule and project timeline.
    - A terms bar showing **Currently using** a saved terms version, or **Custom · Edited from …**.
  - **PDF preview**: download the PDF, or save it to the cloud (Supabase storage).
- **Rate book**: categories, items, add-ons, three tier rates, default quantity per BHK, *Quantity = carpet area*, and *Show to clients*. The bar at the top shows which saved version is in use, or **Custom (unsaved)** once anything is edited. From there you can switch versions, update the version, or save a new one. If you switch away from unsaved custom rates, they are kept as a backup version first.
- **Saved versions**: all rate book and terms versions. **Use this version** / **Currently using** marks the active one; the terms version in use is what new quotations start with.
- **Settings**: change your password, or sign this iPad out.

## One-time setup

### 1. Supabase

1. Create a project at supabase.com. Region: **South Asia (Mumbai)**. Keep *Enable Data API* on. Leave the two automatic grant/RLS options unticked; the script handles them.
2. In **SQL Editor**, run `supabase/schema.sql`. It creates the tables, security rules, quotation numbering (IE-YYYY-154 onwards) and the `quotations` bucket. It is safe to run again.
3. Under **Authentication → Users → Add user**, create each person with email, password and *Auto Confirm User* ticked.
4. Under **Authentication → Sign In / Providers**, turn **off** "Allow new users to sign up".
5. Under **Project Settings → API Keys**, copy the Project URL and the **publishable** key.

### 2. Connect the app

Set these in `.env.production`. The publishable key is meant to live in the app, because the database rules only let signed-in staff in:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_KEY=sb_publishable_…
```

Commit and push; GitHub Actions publishes the site. (First time only: repo Settings → Pages → Source: **GitHub Actions**.)

If both values are empty, the app falls back to the old Apps Script backend at `VITE_API_URL`.

### 3. Backup Sheet (Apps Script)

1. Open a Google Sheet and go to **Extensions → Apps Script**.
2. Add two files, `Code.gs` and `Supabase.gs`, from `apps-script/`. Save, then reload the Sheet.
3. **Supabase → 1. Connect**: paste the Project URL and the **secret** key. The secret key is stored in the script only. Never put it in the app or the repo.
4. **Supabase → 3. Turn on nightly backup**. It runs around 2 AM IST and writes the "Backup …" tabs.

*Moving over from the old Sheet backend:* **Supabase → 2. Copy everything from this Sheet** copies the rate book, versions, contracts and staff names, and carries on the quotation numbering.

### 4. On the iPad

Open the link in Safari → Share → **Add to Home Screen**. Sign in once and it stays signed in.

## Day to day

- **Rates**: Studio → Rate book, or Supabase → **Table Editor** → `items` / `categories`. The old Sheet tabs no longer feed the app.
- **People**: Supabase → Authentication → Users (add, remove, reset a password). A display name comes from the `settings` table, row `name:<email>`.
- **Contracts and PDFs**: the `contracts` table and the `quotations` storage bucket. Older PDFs keep their Google Drive link.
- **Usage**: Supabase → Settings → Usage. Normal use stays far below the free limits (500 MB database, 1 GB files, 5 GB transfer a month).

## Files

| Path | What it is |
|---|---|
| `src/pages/Estimator.tsx` | Client flow: home → scope → sizes → finish → estimate → details → agreement |
| `src/pages/Studio.tsx` | Contracts, rate book, versions, settings |
| `src/components/QuotationDocument.tsx` | The branded PDF (html2canvas + jsPDF, A4) |
| `src/components/QuotationOptionsEditor.tsx` | Included / not-included points, payments, timeline |
| `src/components/Versions.tsx` | Rate book and terms version bars and the Saved versions tab |
| `src/lib/backend.ts` | Supabase backend (all app actions) |
| `src/lib/api.ts` | Picks Supabase or the legacy Apps Script backend |
| `src/lib/estimate.ts` | Pricing: tier rates, default quantities, carpet-area items, line items |
| `supabase/schema.sql` | Database setup |
| `supabase/speed-up.sql` | Optional, and not used by the app yet. Moves version matching into the database if switching versions ever feels slow. |
| `apps-script/Code.gs`, `Supabase.gs` | Legacy backend, data copy and nightly backup |

## Development

```
npm install
npm run dev       # http://localhost:5173/ie-estimator/
npm run build     # type-check and production build into dist/
```

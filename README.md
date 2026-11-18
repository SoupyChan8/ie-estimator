# Interior Editors · Estimate

iPad cost-estimation app for Interior Editors. Clients pick their home size, scope and finish, see an
instant estimate, and sign a letter of engagement. The studio (behind a password) manages the rate book,
signed contracts and branded PDF quotations.

- **App:** React + Vite, hosted free on GitHub Pages (`.github/workflows/deploy.yml` deploys every push to `main`).
- **Data & login:** a Google Sheet with an Apps Script web app (`apps-script/Code.gs`). Signatures and PDFs are saved in Google Drive.

## One-time setup

### 1. Google Sheet + Apps Script
1. Create a new Google Sheet (e.g. "Interior Editors Estimator").
2. Extensions → Apps Script. Replace the contents of `Code.gs` with `apps-script/Code.gs` from this repo. Save.
3. Reload the Sheet. An **Estimator** menu appears.
4. Estimator → **1. Set up sheets** (allow the permissions Google asks for). This creates the tabs and the starter rate book.
5. Estimator → **2. Add or reset a user** — add Romi's email, name and password (and yours).
6. In Apps Script: **Deploy → New deployment → Web app**. Execute as: **Me**. Who has access: **Anyone**. Deploy and copy the URL ending in `/exec`.

### 2. Connect the app
Put the `/exec` URL in `.env.production`:

```
VITE_API_URL=https://script.google.com/macros/s/XXXXXXXX/exec
```

Commit and push. GitHub Actions builds and publishes to `https://soupychan8.github.io/ie-estimator/`.

(First time only: repo Settings → Pages → Source: **GitHub Actions**.)

### 3. On the iPad
Open the link in Safari → Share → **Add to Home Screen**. Sign in once; it stays signed in.

## Day to day
- **Rate book:** edit in the app (Studio → Rate book) or directly in the Sheet's `Categories` / `Items` tabs.
- **Users:** Sheet → Estimator menu → add / reset / remove a user, or sign everyone out.
- **Contracts:** rows in the `Contracts` tab; signatures and PDFs in the Drive folder "Interior Editors Estimator".
- **Studio** asks for the password again and locks itself after 30 minutes.

## Updating the backend
After changing `Code.gs`: Deploy → **Manage deployments** → edit the existing deployment → Version: **New version**.
This keeps the same `/exec` URL.

## Images
Put images in `public/assets/` and set their paths in `src/lib/brandAssets.ts`
(cover photo, overview photo, logo, and one thumbnail per scope category).

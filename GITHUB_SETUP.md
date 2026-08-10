# Complete GitHub + GitHub Pages + Protected Worker Setup

Target GitHub account: **cbfitzpatrick**  
Recommended repository: **yjmb-family-tree**  
Repository visibility: **Public**  
GitHub Pages site: `https://cbfitzpatrick.github.io/yjmb-family-tree/`

The public GitHub Pages frontend is static. Secure answer verification and authenticated submission handling therefore use the included Cloudflare Worker. Do **not** place GitHub write tokens, access answers, or encryption keys in `docs/` or browser JavaScript.

---

## 1. Install v13 into the existing local project

Working directory:

```powershell
cd "C:\Users\Chris Fitz\Documents\Fun\Trumpet History\fullbandtree"
```

Before copying v13 over the folder, make a backup:

```powershell
$Project = "C:\Users\Chris Fitz\Documents\Fun\Trumpet History\fullbandtree"
$Backup  = "C:\Users\Chris Fitz\Documents\Fun\Trumpet History\fullbandtree_backup_v12"
Copy-Item -LiteralPath $Project -Destination $Backup -Recurse
```

Extract the v13 ZIP elsewhere and copy the **contents** of `yjmb_full_band_tree_generator_v13` into `fullbandtree`.

Preserve your current local:

- `YJMB Trees.xlsx`
- `.venv\`
- `.full_band_tree_resolutions.json`
- `access_secrets.json` from v12, if present

Do not overwrite the master workbook with any sample file.

---

## 2. Activate Python and install dependencies

```powershell
cd "C:\Users\Chris Fitz\Documents\Fun\Trumpet History\fullbandtree"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r .\requirements.txt
```

If `.venv` does not exist:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r .\requirements.txt
```

---

## 3. Create/preserve local security secrets

Run:

```powershell
python .\initialize_security.py
```

If you already have `access_secrets.json`, this keeps your existing question-answer lists and only adds missing cryptographic keys.

If this is a completely fresh installation, edit:

```text
access_secrets.json
```

and replace the three placeholder answer lists with the accepted lowercase fragments for the three questions. Keep this file local. `.gitignore` excludes it.

Run:

```powershell
python .\print_security_setup.py
```

This prints the Worker/GitHub secret values you will configure later. The output is sensitive. Do not paste it into GitHub source files, Issues, commits, screenshots, or chat channels.

---

## 4. Build the encrypted site and encrypted master workbook

Recommended:

```powershell
.\build-site.ps1 -SkipAmbiguities
```

Or without automatic ambiguity skipping:

```powershell
.\build-site.ps1
```

This creates:

```text
docs\data\tree_data.enc
secure\master_workbook.enc
```

The plaintext `YJMB Trees.xlsx` remains local and ignored by Git.

Run the privacy audit:

```powershell
python .\verify_public_repo.py
```

Expected messages include:

```text
Public-repository privacy check passed.
- encrypted bundle present
- no plaintext tree_data.json
- no public name-bearing card directory
- no public access-answer fingerprints or answer-derived key wraps
```

At this point `workerApiBase` is intentionally still a placeholder. Configure the Worker before the final public build.

---

## 5. Create the public GitHub repository

On GitHub while signed in as **cbfitzpatrick**:

1. Create a new repository.
2. Name it `yjmb-family-tree`.
3. Select **Public**.
4. Do **not** add a GitHub-generated README, `.gitignore`, or license during creation.

Back in PowerShell:

```powershell
cd "C:\Users\Chris Fitz\Documents\Fun\Trumpet History\fullbandtree"
```

If this is not already a Git repository:

```powershell
git init
git branch -M main
```

Configure identity if needed:

```powershell
git config --global user.name "Chris Fitzpatrick"
git config --global user.email "YOUR_GITHUB_EMAIL"
```

Add the remote:

```powershell
git remote add origin https://github.com/cbfitzpatrick/yjmb-family-tree.git
```

If `origin` already exists:

```powershell
git remote set-url origin https://github.com/cbfitzpatrick/yjmb-family-tree.git
```

Verify:

```powershell
git remote -v
```

---

## 6. Create a fine-grained GitHub token for the Worker

The Worker needs a narrowly scoped credential so it can write encrypted queue files and create review Issues.

Create a **fine-grained personal access token** under GitHub account settings with:

- Resource owner: `cbfitzpatrick`
- Repository access: **Only select repositories** → `yjmb-family-tree`
- Repository permissions:
  - **Contents: Read and write**
  - **Issues: Read and write**
- Give it a sensible expiration and rotate it when needed.

Do not place this token in the repository. It will become a Cloudflare Worker secret named `GITHUB_TOKEN`.

---

## 7. Create the Cloudflare Worker project resources

A Cloudflare account is required for the protected API.

From the project root:

```powershell
cd .\worker
npm install
npx wrangler login
```

Create the KV namespace used for privacy-hashed rate/abuse counters:

```powershell
npx wrangler kv namespace create ABUSE_KV
```

Wrangler prints a namespace ID. Edit:

```text
worker\wrangler.jsonc
```

and replace:

```text
REPLACE_WITH_KV_NAMESPACE_ID
```

with that ID.

The default public origin is already:

```text
https://cbfitzpatrick.github.io
```

and the target repo is already `cbfitzpatrick/yjmb-family-tree`.

---

## 8. Configure Cloudflare Turnstile (recommended)

In Cloudflare, create a Turnstile widget for the GitHub Pages hostname:

```text
cbfitzpatrick.github.io
```

Record:

- public **Site Key**
- private **Secret Key**

The Site Key will go into `web_template/site_config.json`. The Secret Key goes only into the Worker secret `TURNSTILE_SECRET`.

Turnstile is an additional anti-bot layer; the Worker also performs independent rate, duplicate, size, content, and relationship-conflict checks.

---

## 9. Configure Worker secrets

Return to the project root in another terminal and print the local secret values:

```powershell
cd "C:\Users\Chris Fitz\Documents\Fun\Trumpet History\fullbandtree"
.\.venv\Scripts\Activate.ps1
python .\print_security_setup.py
```

Then in the Worker folder:

```powershell
cd .\worker
```

Create each secret and paste the corresponding value when Wrangler prompts:

```powershell
npx wrangler secret put ACCESS_STAGE_1_JSON
npx wrangler secret put ACCESS_STAGE_2_JSON
npx wrangler secret put ACCESS_STAGE_3_JSON
npx wrangler secret put SESSION_SIGNING_KEY
npx wrangler secret put TREE_DATA_KEY_B64
npx wrangler secret put SUBMISSION_KEY_B64
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put TURNSTILE_SECRET
```

The accepted question answers now exist only in your local gitignored file and Cloudflare Worker secrets. They are not exported to `docs/`.

If you choose not to use Turnstile, leave `TURNSTILE_SECRET` unset and leave `turnstileSiteKey` blank. The other abuse checks remain active.

---

## 10. Deploy the Worker

From `fullbandtree\worker`:

```powershell
npm run deploy
```

Wrangler prints the Worker URL, similar to:

```text
https://yjmb-family-tree-api.<your-subdomain>.workers.dev
```

Test it in PowerShell:

```powershell
Invoke-RestMethod "https://YOUR-WORKER.workers.dev/health"
```

Expected:

```text
ok
--
True
```

---

## 11. Point the static site at the Worker

Edit:

```text
web_template\site_config.json
```

Change:

```json
"workerApiBase": "https://REPLACE-WITH-YOUR-WORKER.workers.dev"
```

to your actual Worker URL.

If using Turnstile, set:

```json
"turnstileSiteKey": "YOUR_PUBLIC_TURNSTILE_SITE_KEY"
```

Do not put the Turnstile secret here.

Rebuild:

```powershell
cd "C:\Users\Chris Fitz\Documents\Fun\Trumpet History\fullbandtree"
.\.venv\Scripts\Activate.ps1
.\build-site.ps1 -SkipAmbiguities
```

Then:

```powershell
python .\verify_public_repo.py
```

---

## 12. Configure GitHub Actions secrets

In GitHub:

`cbfitzpatrick/yjmb-family-tree` → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

Use `python .\print_security_setup.py` locally to obtain these three values:

1. `TREE_DATA_KEY_B64`
2. `SUBMISSION_KEY_B64`
3. `MASTER_WORKBOOK_KEY_B64`

Only paste each value into the corresponding GitHub Actions secret.

Do **not** create an `ACCESS_STAGE_*` GitHub secret. GitHub Actions does not need the access answers; only the Cloudflare Worker validates them.

---

## 13. Verify what Git will publish

From the project root:

```powershell
git check-ignore -v "YJMB Trees.xlsx" "access_secrets.json" "worker/.dev.vars"
```

Each should be ignored.

Now stage:

```powershell
git add .
git status
```

Run the privacy audit again while the index is populated:

```powershell
python .\verify_public_repo.py
```

Check especially:

```powershell
git diff --cached --name-only |
  Select-String -Pattern 'access_secrets|YJMB Trees\.xlsx|tree_data\.json|access_config\.js|docs/assets/cards|\.dev\.vars'
```

Expected: **no output**.

Files that are expected to be public include:

```text
docs/data/tree_data.enc
secure/master_workbook.enc
.github/workflows/deploy-pages.yml
.github/workflows/process-secure-submissions.yml
.github/workflows/approve-secure-submission.yml
worker/src/index.js
worker/wrangler.jsonc
web_template/*
```

The encrypted master workbook is intentionally public ciphertext; its AES key is not public.

---

## 14. Commit and push

```powershell
git commit -m "Publish protected YJMB family tree"
git push -u origin main
```

If GitHub prompts for HTTPS authentication, use Git Credential Manager/browser authentication, GitHub CLI, a suitable PAT, or SSH—not your normal GitHub account password.

After pushing, inspect the repository in your browser before enabling Pages. Confirm that the plaintext workbook, local answers, and plaintext tree JSON are absent.

---

## 15. Enable GitHub Pages

In GitHub:

1. Open `cbfitzpatrick/yjmb-family-tree`.
2. **Settings** → **Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Open **Actions**.
5. Run `Deploy YJMB tree site` manually if the initial push did not already trigger it.

The public site should be:

```text
https://cbfitzpatrick.github.io/yjmb-family-tree/
```

---

## 16. Test remembered access

Use an incognito/private browser first:

1. Open the Pages URL.
2. Complete the three knowledge questions.
3. Confirm the loading/decryption page appears.
4. Confirm the tree opens.
5. Close the browser tab.
6. Open the Pages URL again in the same browser profile.

A still-valid 30-day session should be recognized and the site should go directly through the protected loading/decryption screen without asking the three questions again.

The remembered cookie contains an opaque signed session token—not the answers.

To force that browser to ask again, clear site cookies/local storage for the Pages site. You can also use the browser developer console while on the site:

```javascript
window.YJMBSecureData?.clearAccess()
```

then reload.

---

## 17. Test Add Yourself automatic routing

After authentication:

1. Open **Add Yourself**.
2. Complete the questionnaire.
3. Confirm the localized tree preview.
4. Complete Turnstile if enabled.
5. Submit.

For a low-risk submission, the Worker returns it to the automatic encrypted queue. It writes only ciphertext to:

```text
.secure_submissions/auto/<UUID>.enc.json
```

The `Apply protected YJMB submissions` workflow then:

- decrypts `secure/master_workbook.enc` inside the Actions runner;
- decrypts the submission;
- performs workbook conflict checks;
- adds the new submitter and safe reciprocal relationships;
- regenerates the encrypted public tree;
- re-encrypts the master workbook;
- removes plaintext runner files;
- deletes the processed encrypted submission file;
- commits only encrypted/public artifacts.

The Pages workflow deploys the updated `docs/` after that protected commit.

---

## 18. What happens when abuse/conflict is detected

The Worker uses an administrator-review threshold. Default score threshold: `3`.

Examples that increase the review score:

- high submission frequency;
- repeated same name/year submission;
- unusual payload size;
- unusually large RAT/section/note lists;
- executable-markup or external-URL-like content.

Invalid access sessions, invalid Turnstile validations, or malformed required fields are rejected rather than forwarded as admin spam.

A suspicious-but-well-formed submission is encrypted and stored at:

```text
.secure_submissions/review/<UUID>.enc.json
```

The Worker creates a GitHub Issue assigned to `cbfitzpatrick`. The Issue contains only the protected UUID/path and routing reasons—not the submitted profile data.

The GitHub Actions updater can also divert an initially low-risk submission to review if it discovers a duplicate or relationship conflict against the real workbook.

---

## 19. Review an encrypted flagged submission locally

Pull the latest repo:

```powershell
git pull
```

Then decrypt a specific review item locally:

```powershell
python .\review_secure_submission.py ".\.secure_submissions\review\SUBMISSION-UUID.enc.json"
```

This uses the local gitignored `access_secrets.json` submission key.

If the submission is legitimate and you want it processed, go to GitHub:

**Actions** → **Approve protected YJMB submission** → **Run workflow**

Paste only the UUID, not the full path.

The workflow moves the encrypted file into the automatic queue. The normal protected processing workflow then runs all workbook conflict checks again.

If it should be rejected, delete the encrypted review file in an administrator commit and close the corresponding Issue.

---

## 20. Normal local data update workflow

When you manually edit your real workbook:

```powershell
cd "C:\Users\Chris Fitz\Documents\Fun\Trumpet History\fullbandtree"
.\.venv\Scripts\Activate.ps1
.\build-site.ps1 -SkipAmbiguities
python .\verify_public_repo.py
git status
git add docs secure/master_workbook.enc
git diff --cached --name-only
git commit -m "Update encrypted YJMB tree data"
git push
```

Never add `YJMB Trees.xlsx`.

---

## 21. Rotating access answers or encryption keys

### Change only the knowledge answers

Edit local `access_secrets.json`, then update only these Worker secrets:

```powershell
npx wrangler secret put ACCESS_STAGE_1_JSON
npx wrangler secret put ACCESS_STAGE_2_JSON
npx wrangler secret put ACCESS_STAGE_3_JSON
```

No public site rebuild is required merely to change the accepted answer fragments because answers are no longer used for the public ciphertext.

Existing remembered 30-day sessions remain valid until they expire unless you also rotate the session-signing secret.

### Immediately invalidate all remembered access sessions

Rotate:

```text
SESSION_SIGNING_KEY
```

in the Cloudflare Worker and redeploy. Old signed session cookies will fail validation.

### Rotate the tree encryption key

Generate/update `treeDataKey` locally, then update both:

- Worker secret `TREE_DATA_KEY_B64`
- GitHub Actions secret `TREE_DATA_KEY_B64`

Rebuild `docs/data/tree_data.enc` before publishing.

### Rotate the submission key

Only do this after all queued encrypted submissions using the old key have been processed/reviewed, or archive the old key securely. Update both Cloudflare and GitHub `SUBMISSION_KEY_B64` values.

---

## 22. Critical files that must stay secret

Never commit or publish:

```text
YJMB Trees.xlsx
access_secrets.json
worker/.dev.vars
worker/.env
```

Never place these values in frontend files:

```text
ACCESS_STAGE_* answers
SESSION_SIGNING_KEY
TREE_DATA_KEY_B64
SUBMISSION_KEY_B64
MASTER_WORKBOOK_KEY_B64
GITHUB_TOKEN
TURNSTILE_SECRET
```

The entire point of the Worker/GitHub Actions split is that the browser and public source repository never need these secrets.

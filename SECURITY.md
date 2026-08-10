# Security Architecture

## What is hidden from the public repository

The following must never be committed:

- access-question answers;
- `access_secrets.json`;
- plaintext `YJMB Trees.xlsx`;
- plaintext `docs/data/tree_data.json`;
- individual public card PNGs containing names;
- Cloudflare/GitHub credentials;
- developer export key;
- AES keys;
- plaintext submission payloads.

`verify_public_repo.py` checks for the most important accidental plaintext artifacts before publication.

## Access answers

v13 removes the v12 public SHA-256 answer fingerprints and PBKDF2 answer-derived wrapped keys.

The three questions are visible because they are part of the user interface. Their accepted answer fragments are checked only inside the Cloudflare Worker using Worker secrets. The browser sends a candidate answer over HTTPS and receives only a signed flow/session token.

This substantially reduces source-code disclosure and prevents the public encrypted bundle from acting as an answer verifier. It does not make shared knowledge questions equivalent to individual account authentication: an authorized visitor can still share an answer or a valid session, and a browser that legitimately receives decrypted data can inspect that data.

## Remembered access

After all three questions are correct, the Worker returns a signed opaque access token valid for 30 days. The static GitHub Pages frontend stores that token in:

- a `Secure; SameSite=Strict` cookie; and
- localStorage as a fallback.

The cookie contains no answer and no tree key. Because GitHub Pages JavaScript must create the cookie, it cannot be `HttpOnly`. The Worker verifies the HMAC signature and expiry on each server request. A forged cookie value does not produce a valid session.

The AES tree key is returned only after the remembered token is validated and is cached only in `sessionStorage` for the active browser session.

## Encryption

Public tree payload:

- AES-256-GCM;
- random 96-bit IV per build;
- stable random 256-bit key stored as a local/GitHub/Worker secret;
- no answer-derived key wraps in the public bundle.

Protected master workbook:

- AES-256-GCM;
- stored in `secure/master_workbook.enc`;
- key held in GitHub Actions secret `MASTER_WORKBOOK_KEY_B64`, the matching Cloudflare Worker secret for owner export, and locally in the gitignored secret file.

Protected contribution submissions:

- AES-256-GCM;
- Worker encrypts before GitHub storage;
- key is a Cloudflare/GitHub secret `SUBMISSION_KEY_B64`.


## Developer-only master-workbook export

The browser never receives `MASTER_WORKBOOK_KEY_B64` or `DEVELOPER_EXPORT_KEY`. A developer export request must present a valid normal signed access token plus the separate `X-Developer-Key` value. The Worker compares the supplied developer key against its `DEVELOPER_EXPORT_KEY` secret using a constant-time SHA-256 digest comparison, rate-limits failures, fetches the current `secure/master_workbook.enc` from GitHub, decrypts the AES-256-GCM envelope inside the Worker with `MASTER_WORKBOOK_KEY_B64`, and returns the resulting XLSX bytes with no-store caching headers.

There is no visible export button. The owner command is `Ctrl+Alt+Shift+E` on the tree page (or `YJMBDeveloperExport()` in the console), but hiding this command is not considered an authorization control because frontend source is public. The independent Worker secret is the authorization control.

The export key is deliberately **not** stored in GitHub Actions because Actions does not need it. `MASTER_WORKBOOK_KEY_B64` is stored in both GitHub Actions and Cloudflare because Actions must update the encrypted workbook while the Worker must decrypt it for an authorized owner download.

## Abuse detection

The Worker performs multiple independent checks. It does not trust client-side validation.

Hard rejection:

- invalid/expired access session;
- invalid Turnstile token when Turnstile is configured;
- missing required identity/year/section information;
- impossible RAT-year range;
- malformed request.

Risk scoring sends the submission to administrator review instead of auto-apply when the configured threshold is reached. Default threshold: 3.

Signals include:

- more than two submissions from the same privacy-hashed network source within an hour;
- more than five within a day;
- repeat submission of the same normalized name/year identity within seven days;
- unusually large payload, notes, memories, RAT lists, or section lists;
- URL-like or executable-markup patterns in free text;
- suspicious submission volume.

The GitHub Actions updater adds a second safety layer. Even a low-risk Worker submission is routed to review if the workbook discovers:

- same-name/same-year duplicate self record;
- matched RAT already has a different VET;
- matched VET has no free RAT slot;
- referenced matched row no longer exists;
- more RATs than the workbook schema can represent;
- parsing/processing errors.

## Administrator review

A review Issue contains only:

- protected submission UUID;
- encrypted file path;
- risk/conflict reason.

It does not contain the submitted member profile. The administrator can pull the repo and run:

```powershell
python .\review_secure_submission.py ".\.secure_submissions\review\SUBMISSION-ID.enc.json"
```

The local `access_secrets.json` supplies the decryption key. After review, the administrator can use the `Approve protected YJMB submission` workflow with the submission UUID.

## Limitations

- Knowledge questions are one knowledge factor, not true multi-factor authentication.
- A visitor who legitimately decrypts the tree can inspect or copy data rendered in their browser.
- A JavaScript-created cookie cannot be `HttpOnly` on a static GitHub Pages origin.
- Security depends on protecting Cloudflare secrets (including the developer export key), GitHub Actions secrets, the fine-grained GitHub token, and the local secret file.
- The abuse score is a conservative routing mechanism, not proof that a person is or is not malicious.
- FERPA applicability and compliance depend on who maintains the records, what the records legally constitute, institutional policy, consent/disclosure basis, and other facts outside this source code.

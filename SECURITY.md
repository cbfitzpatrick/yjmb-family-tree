# Security Architecture

## Access answers

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
- stored somewhere;
- key held in GitHub Actions secret, the matching Cloudflare Worker secret for owner export, and locally in the gitignored secret file.

Protected contribution submissions:

- AES-256-GCM;
- Worker encrypts before GitHub storage;
- key is a Cloudflare/GitHub secret.


## Developer-only master-workbook export

The browser never receives keys. A developer export request must present a valid normal signed access token plus the separate value. The Worker compares the supplied developer key against its secret using a constant-time SHA-256 digest comparison, rate-limits failures, fetches the current from GitHub, decrypts the AES-256-GCM envelope inside the Worker with key, and returns the resulting XLSX bytes with no-store caching headers.

The independent Worker secret is the authorization control.

The export key is deliberately **not** stored in GitHub Actions because Actions does not need it. key is stored in both GitHub Actions and Cloudflare because Actions must update the encrypted workbook while the Worker must decrypt it for an authorized owner download.

## Abuse detection

The Worker performs multiple independent checks. It does not trust client-side validation.

Hard rejection:

- invalid/expired access session;
- invalid Turnstile token when Turnstile is configured;
- missing required identity/year/section information;
- impossible RAT-year range;
- malformed request.

Risk scoring remains as protected audit metadata in v17 but does not create an administrator-approval gate for ordinary well-formed member changes. Hard failures (invalid session, failed configured Turnstile, malformed required fields, executable markup, or invalid payloads) are still rejected. Frequency and unusually large submissions remain visible to administrators as audit reasons.

The GitHub Actions updater is the workbook-aware fail-safe layer. It routes an encrypted request to review instead of overwriting data when it discovers conditions such as:

- same-name/same-year duplicate self record;
- stale correction data that changed after a form was loaded;
- referenced rows that no longer exist;
- more RATs than the workbook schema can represent;
- reciprocal validation conflicts;
- parsing/processing errors.

Member VET/RAT submissions intentionally write only the submitter's side. The other profile is not silently modified; Admin Mode lists unreciprocated claims for explicit validation.

## Administrator review

A review Issue contains only:

- protected submission UUID;
- encrypted file path;
- risk/conflict reason.

It does not contain the submitted member profile.

The local json supplies the decryption key. After review, the administrator can use the workflow with the submission UUID.

## Limitations

- Knowledge questions are one knowledge factor, not true multi-factor authentication.
- A visitor who legitimately decrypts the tree can inspect or copy data rendered in their browser.
- A JavaScript-created cookie cannot be `HttpOnly` on a static GitHub Pages origin.
- Security depends on protecting Cloudflare secrets (including the developer export key), GitHub Actions secrets, the fine-grained GitHub token, and the local secret file.
- The abuse score is a conservative routing mechanism, not proof that a person is or is not malicious.
- FERPA applicability and compliance depend on who maintains the records, what the records legally constitute, institutional policy, consent/disclosure basis, and other facts outside this source code.

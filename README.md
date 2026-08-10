# YJMB Full Band Family Tree

Interactive Yellow Jacket Marching Band RAT/VET family-tree viewer and protected contribution workflow.

## Privacy and security design

The public GitHub repository does **not** contain the plaintext master workbook, plaintext tree JSON, name-bearing card PNG files, access-question answers, answer hashes, or answer-derived key wraps.

Published family-tree data is encrypted with **AES-256-GCM**. The encryption key is supplied to an authenticated browser only after the separate access service verifies the three knowledge questions. Successful access is remembered on that browser with a signed, opaque, expiring session token stored in a Secure/SameSite cookie (with localStorage fallback); the cookie does not contain the access answers or the tree encryption key.

The access answers are stored only as Cloudflare Worker secrets and in the administrator's gitignored local `access_secrets.json`. They are not committed to GitHub. Because answer validation happens server-side, the public repository does not provide a direct answer hash/verifier that can be read from JavaScript.

New "Add Yourself" submissions are also encrypted before entering GitHub. Low-risk authenticated submissions enter the protected automatic-update queue. Submissions with abuse indicators, duplicate/conflicting relationships, unusual frequency, or other safety conflicts are diverted to an encrypted administrator-review queue instead of modifying the tree automatically.

### FERPA-oriented privacy statement

This project is designed to follow **FERPA-oriented privacy and access-control guidelines where applicable**, including minimizing public plaintext personally identifiable information, encrypting stored member data, authenticating access before disclosure, and routing ambiguous or suspicious changes to human review. This statement is a design goal, **not a legal certification or a determination that Georgia Tech has approved the system for FERPA-protected education records**. If the site becomes an official institutional system or stores records that Georgia Tech classifies as protected education records, institutional review and approved authentication/data-handling controls should be used.

## Public/private split

Public repository:

- static HTML/CSS/JavaScript viewer;
- `docs/data/tree_data.enc` encrypted tree bundle;
- `secure/master_workbook.enc` encrypted master workbook for GitHub Actions;
- encrypted queued submissions;
- GitHub Actions workflows and source code.

Local/secret only:

- `YJMB Trees.xlsx` plaintext master workbook;
- `access_secrets.json`;
- Cloudflare Worker answer secrets;
- GitHub write token used by the Worker;
- AES keys and session-signing secret;
- plaintext local card/tree renderings and backups.

## Access flow

1. Gold page: `Hey Band!`
2. White page: `Dwarfing. It's delicious and _______`
3. Blue page: `What's the good word?`
4. Authenticated loading/decryption page.
5. Interactive tree.

The accepted answer fragments are intentionally absent from this README and all public source files.

## Automatic contribution flow

1. Visitor passes the three-question access sequence, or returns with a still-valid remembered session.
2. Visitor completes **Add Yourself**.
3. Optional Cloudflare Turnstile validation and server-side abuse checks run.
4. The Worker encrypts the entire submission using AES-256-GCM before writing it to GitHub.
5. Low-risk submission: encrypted file enters `.secure_submissions/auto/` and the protected Actions workflow attempts to apply it.
6. Suspicious submission: encrypted file enters `.secure_submissions/review/` and an administrator Issue is created containing only the encrypted file ID/path and routing reason—not the submitted profile data.
7. The protected Actions workflow decrypts the encrypted master workbook in the runner, applies safe changes, rebuilds `docs/data/tree_data.enc`, re-encrypts the master workbook, removes plaintext runner files, and commits only encrypted/public artifacts.
8. Any workbook-level conflict detected during automatic application is diverted to the review queue instead of overwriting existing relationships.

Existing-record correction requests remain administrator-reviewed because modifying another existing profile is intentionally higher-risk than adding a new self-submitted profile.

## Setup

See `GITHUB_SETUP.md` for the complete Windows, GitHub Pages, GitHub Actions, Cloudflare Worker, KV, Turnstile, secret, and deployment procedure.

See `SECURITY.md` for the threat model, abuse score, cookie/session behavior, and limitations.

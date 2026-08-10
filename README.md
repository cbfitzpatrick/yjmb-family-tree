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
- AES keys, session-signing secret, and developer-export secret;
- plaintext local card/tree renderings and backups.


## Developer-only Excel export

The protected site includes an intentionally hidden owner export command for retrieving the **latest committed protected master workbook** as an ordinary `.xlsx` file for local archival/editing. There is no visible public download button. On `tree.html`, the owner can press:

```text
Ctrl + Alt + Shift + E
```

or run `YJMBDeveloperExport()` from the browser console. The browser then prompts for the separate developer export key.

Export authorization requires **both**:

1. a currently valid normal YJMB access session; and
2. possession of the independent `DEVELOPER_EXPORT_KEY`.

The developer key is generated locally in `access_secrets.json` and stored in Cloudflare only as a Worker secret. It is never placed in `docs/`, GitHub Actions, localStorage, cookies, or public JavaScript. The Worker fetches the latest `secure/master_workbook.enc` from the `main` branch, decrypts it server-side with `MASTER_WORKBOOK_KEY_B64`, and returns the workbook with `Cache-Control: no-store`. Failed export-key attempts are rate-limited through the abuse KV namespace.

The hidden keyboard command is only a convenience and is **not** the security boundary; anyone can inspect public JavaScript. Security depends on the server-side key check and the normal authenticated session. Possession of the export key is not the same as cryptographically proving a person's identity, so protect it like a password.

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

## v15 leadership and maintenance tools

Leadership remains split into structured formal and informal data. `Marching Band Leadership Role(s)` contains formal roles; `Served in Informal Leadership Position` plus `Informal Leadership Position(s)` represent informal leadership. Cards now display black minimalist corner icons for Section Leader, Drum Major, RAT Parent, informal leadership, and other formal leadership. The Visualizer menu contains an icon key.

Maintenance scripts added in v15:

- `normalizeSectionNames.py`
- `classifyLeadershipPositions.py`
- `assignLeadershipFromNotes.py`
- `createSafeDebugBundle.py`

See `README_V15_DATA_TOOLS.md` for commands and safety behavior.

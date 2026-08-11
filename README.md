# YJMB Family Tree

Protected interactive RAT/VET family tree for the Yellow Jacket Marching Band.

- Build encrypted tree + protected workbook: `./build-site.ps1 -SkipAmbiguities`
- Publish UI changes without rebuilding tree data: `./publish-ui-only.ps1`
- Workbook cleanup/migration tools are scan-only unless `--apply` is supplied.
- Never commit `YJMB Trees.xlsx`, `access_secrets.json`, private keys, or plaintext member/tree data.

On the protected tree page, use the **ⓘ** button for viewer, data, update, and administration information.

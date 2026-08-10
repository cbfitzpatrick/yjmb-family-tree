#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path
p=Path(__file__).resolve().parent/'access_secrets.json'
d=json.loads(p.read_text(encoding='utf-8'))
print('Cloudflare Worker secret values (run `npx wrangler secret put NAME` and paste the value):')
for name,key in [
 ('ACCESS_STAGE_1_JSON','stage1'),('ACCESS_STAGE_2_JSON','stage2'),('ACCESS_STAGE_3_JSON','stage3'),
 ('SESSION_SIGNING_KEY','sessionSigningKey'),('TREE_DATA_KEY_B64','treeDataKey'),('SUBMISSION_KEY_B64','submissionKey')]:
    value=json.dumps(d[key],separators=(',',':')) if isinstance(d[key],list) else d[key]
    print(f'{name}={value}')
print('\nGitHub Actions secrets:')
print(f"TREE_DATA_KEY_B64={d['treeDataKey']}")
print(f"SUBMISSION_KEY_B64={d['submissionKey']}")
print(f"MASTER_WORKBOOK_KEY_B64={d['masterWorkbookKey']}")

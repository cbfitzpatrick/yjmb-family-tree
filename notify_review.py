#!/usr/bin/env python3
from __future__ import annotations
import json, os, urllib.request
from pathlib import Path
r=json.loads(Path('queue_result.json').read_text())
token=os.environ.get('GITHUB_TOKEN',''); repo=os.environ.get('GITHUB_REPOSITORY','cbfitzpatrick/yjmb-family-tree')
for item in r.get('review',[]):
    body={
      'title':f"[Protected submission review] {item['id']}",
      'body':f"An authenticated encrypted submission could not be safely auto-applied and was diverted to administrator review.\n\nEncrypted queue file: `{item['path']}`\nReason: {item['reason']}\n\nNo member-supplied profile data is included in this Issue.",
      'assignees':['cbfitzpatrick'],
    }
    req=urllib.request.Request(f'https://api.github.com/repos/{repo}/issues',data=json.dumps(body).encode(),method='POST',headers={'Authorization':f'Bearer {token}','Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'yjmb-secure-queue'})
    with urllib.request.urlopen(req) as resp: print('Created review issue:',resp.status)

#!/usr/bin/env python3
from __future__ import annotations
import base64, json, os, secrets
from pathlib import Path

ROOT=Path(__file__).resolve().parent
PATH=ROOT/'access_secrets.json'
DEFAULT={
 'stage1':['REPLACE_WITH_STAGE_1_ACCEPTED_TEXT'],
 'stage2':['REPLACE_WITH_STAGE_2_ACCEPTED_TEXT'],
 'stage3':['REPLACE_WITH_STAGE_3_ACCEPTED_TEXT'],
}

def key32(): return base64.b64encode(os.urandom(32)).decode('ascii')

def main():
    data={}
    if PATH.exists():
        data=json.loads(PATH.read_text(encoding='utf-8'))
    for k,v in DEFAULT.items(): data.setdefault(k,v)
    data.setdefault('treeDataKey',key32())
    data.setdefault('submissionKey',key32())
    data.setdefault('masterWorkbookKey',key32())
    data.setdefault('sessionSigningKey',secrets.token_urlsafe(48))
    PATH.write_text(json.dumps(data,indent=2)+"\n",encoding='utf-8')
    print(f'Updated local secret file: {PATH}')
    print('This file is gitignored. Do not commit or publish it.')
    print('\nCloudflare/GitHub secret names can be copied from it using print_security_setup.py.')
if __name__=='__main__': main()

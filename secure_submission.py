#!/usr/bin/env python3
from __future__ import annotations
import argparse, base64, json, os
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def load_key():
    raw=os.environ.get('SUBMISSION_KEY_B64','').strip()
    if not raw:
        p=Path(__file__).resolve().parent/'access_secrets.json'
        if p.exists(): raw=json.loads(p.read_text(encoding='utf-8')).get('submissionKey','')
    key=base64.b64decode(raw)
    if len(key)!=32: raise ValueError('SUBMISSION_KEY_B64/submissionKey must decode to 32 bytes.')
    return key

def decrypt_file(path:Path):
    env=json.loads(path.read_text(encoding='utf-8'))
    if env.get('format')!='yjmb-secure-submission-v1': raise ValueError('Unsupported secure submission format.')
    pt=AESGCM(load_key()).decrypt(base64.b64decode(env['iv']),base64.b64decode(env['ciphertext']),None)
    return json.loads(pt)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('input',type=Path); ap.add_argument('--output',type=Path)
    a=ap.parse_args(); data=decrypt_file(a.input); text=json.dumps(data,indent=2,ensure_ascii=False)+"\n"
    if a.output: a.output.write_text(text,encoding='utf-8')
    else: print(text,end='')
if __name__=='__main__': main()

#!/usr/bin/env python3
from __future__ import annotations
import argparse, base64, json, os
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def load_key():
    raw=os.environ.get('MASTER_WORKBOOK_KEY_B64','').strip()
    if not raw:
        p=Path(__file__).resolve().parent/'access_secrets.json'
        if p.exists(): raw=json.loads(p.read_text(encoding='utf-8')).get('masterWorkbookKey','')
    key=base64.b64decode(raw)
    if len(key)!=32: raise SystemExit('MASTER_WORKBOOK_KEY_B64/masterWorkbookKey must decode to 32 bytes.')
    return key

def encrypt(inp,out):
    iv=os.urandom(12); ct=AESGCM(load_key()).encrypt(iv,Path(inp).read_bytes(),None)
    Path(out).parent.mkdir(parents=True,exist_ok=True)
    Path(out).write_text(json.dumps({'format':'yjmb-master-workbook-v1','cipher':'AES-256-GCM','iv':base64.b64encode(iv).decode(),'ciphertext':base64.b64encode(ct).decode()},separators=(',',':')),encoding='utf-8')

def decrypt(inp,out):
    env=json.loads(Path(inp).read_text(encoding='utf-8'))
    pt=AESGCM(load_key()).decrypt(base64.b64decode(env['iv']),base64.b64decode(env['ciphertext']),None)
    Path(out).write_bytes(pt)

def main():
    ap=argparse.ArgumentParser(); sub=ap.add_subparsers(dest='cmd',required=True)
    for cmd in ('encrypt','decrypt'):
        sp=sub.add_parser(cmd); sp.add_argument('--input',required=True); sp.add_argument('--output',required=True)
    a=ap.parse_args(); (encrypt if a.cmd=='encrypt' else decrypt)(a.input,a.output)
if __name__=='__main__': main()

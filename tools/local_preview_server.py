#!/usr/bin/env python3
"""Local-only YJMB browser preview.  No uploads, Cloudflare calls, or plaintext files.

Default: synthetic member fixture, including two Matt Jackson profiles with
2007 RAT years in different sections. --real-data: decrypt the user's OWN local
encrypted tree in RAM with access_secrets.json/treeDataKey. Binds only loopback.
Not part of the deployed website.
"""
from __future__ import annotations
import argparse
import base64
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs'
LOCAL_SECURE_DATA = r'''\n'use strict';\n(() => {\n  // Block outbound fetches (including email/bug-report submission) during testing.\n  const nativeFetch = window.fetch.bind(window);\n  window.fetch = (resource, options) => {\n    const target = new URL(typeof resource === 'string' ? resource : resource.url, window.location.href);\n    if (target.origin !== window.location.origin) {\n      return Promise.reject(new Error('External network requests are disabled in YJMB local preview.'));\n    }\n    return nativeFetch(resource, options);\n  };\n  const tree = () => fetch('/__local_preview_tree', {cache:'no-store'}).then(r => {\n    if (!r.ok) throw new Error('Local preview tree unavailable');\n    return r.json();\n  });\n  window.YJMBSecureData = {\n    loadTreeData: tree, unlockFromSession: tree,\n    apiFetch: async (path) => {\n      if (path === '/submit') return {status:'local-preview'};\n      throw new Error('This operation is disabled in the local preview.');\n    },\n    getAccessToken: () => 'local-only-preview',\n    clearAccess: () => {}, rememberAccessToken: () => {},\n    downloadDeveloperWorkbook: async () => { throw new Error('Disabled in local preview'); }\n  };\n})();\n'''.replace(r'\n','\n')


def synthetic_tree() -> dict:
    band_start, band_end = 1994, 2012
    colors = {'trumpet': '#99f57b', 'saxophone': '#a8e7f4', 'battery': '#f0b18c', 'front ensemble': '#d1d5ff'}
    people_data = [
        ('row-9', 'Pat Example', 2006, 'trumpet', 140, None, ['section-leader']),
        ('row-10', 'Lee Example', 2008, 'trumpet', 140, 'row-9', ['rat-parent']),
        ('row-11', 'Matt Jackson', 2007, 'saxophone', 490, None, ['mcm']),
        ('row-12', 'Matt Jackson', 2007, 'battery', 860, None, ['guard-captain']),
        ('row-13', 'Sam Example', 2008, 'saxophone', 490, 'row-11', ['libraries']),
        ('row-14', 'Chris Example', 1994, 'trumpet', 1130, None, ['drum-major']),
    ]
    people=[]
    for pid, name, year, section, x, parent, icons in people_data:
        given, family=name.split(' ',1)
        y=(year-band_start)*100+10
        fields=[
            {'label':'Given/Preferred Name','value':given},
            {'label':'Family/Maiden Name','value':family},
            {'label':'RAT Year','value':str(year)},
            {'label':'Instrument','value':section.title()},
            {'label':'Section Nicknames','value':('Horncat' if pid=='row-11' else 'Drummer' if pid=='row-12' else '')},
            {'label':'Leadership','value':', '.join(icons)},
        ]
        people.append({
            'id':pid,'name':name,'displayName':name,'givenPreferredName':given,'familyMaidenName':family,
            'ratYear':year,'ratYearLabel':str(year),'instruments':[section],'instrumentRaw':section.title(),
            'card':{'x':x,'y':y,'width':150,'height':80},'sourceFields':fields,
            'leadershipIcons':icons,'bandClubLeadership':pid=='row-14',
            'parentId':parent,'childrenIds':[],'rootId':parent or pid,
        })
    indexed={p['id']:p for p in people}
    for p in people:
        if p['parentId']: indexed[p['parentId']]['childrenIds'].append(p['id'])
    trees=[]
    for p in people:
        if p['parentId']:continue
        members=[q for q in people if q['id']==p['id'] or q['parentId']==p['id']]
        trees.append({'rootId':p['id'],'memberIds':[q['id'] for q in members],
                      'sections':list({q['instruments'][0] for q in members}),
                      'bounds':{'minX':min(q['card']['x'] for q in members), 'maxX':max(q['card']['x']+150 for q in members)}})
    connectors=[]
    for p in people:
        if p['parentId']:
            parent=indexed[p['parentId']]
            connectors.append({'parentId':parent['id'],'childIds':[p['id']],
                'parentStem':{'start':{'x':parent['card']['x']+75,'y':parent['card']['y']+80},
                              'end':{'x':p['card']['x']+75,'y':p['card']['y']}}})
    bands=[]
    for year in range(band_start,band_end+1):
        phase=(year-1994)%4
        color, fg= (('#102e51','#ffffff') if phase==0 else ('#B3A369','#ffffff') if phase==2 else ('#ffffff','#102e51'))
        bands.append({'label':str(year),'y':(year-band_start)*100,'color':color,'textColor':fg})
    return {'schemaVersion':18,'people':people,'trees':trees,'connectors':connectors,
            'sectionColors':colors,'sectionGradients':{},'cardIconsEnabled':True,
            'width':1500,'height':len(bands)*100,'connectorWidth':8,'yearStripHeight':100,'yearBands':bands}


def decrypt_real_tree() -> dict:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    path = ROOT/'access_secrets.json'
    if not path.is_file():
        raise RuntimeError('Missing local access_secrets.json. Use default synthetic mode instead.')
    raw=json.loads(path.read_text(encoding='utf-8')).get('treeDataKey','')
    key=base64.b64decode(raw,validate=True)
    if len(key)!=32: raise RuntimeError('treeDataKey must decode to exactly 32 bytes')
    envelope=json.loads((DOCS/'data'/'tree_data.enc').read_text(encoding='utf-8'))
    if envelope.get('format')!='yjmb-tree-encrypted-v3': raise RuntimeError('Not the expected encrypted tree format')
    plaintext=AESGCM(key).decrypt(base64.b64decode(envelope['dataIv']),base64.b64decode(envelope['ciphertext']),None)
    return json.loads(plaintext)


def serve(port:int, real_data:bool):
    if not DOCS.is_dir(): raise RuntimeError('Missing docs directory')
    data=decrypt_real_tree() if real_data else synthetic_tree()
    encoded=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode('utf-8')
    # Local HTTP only, bind to 127.0.0.1. No file write or plaintext export.
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(DOCS),**kwargs)
        def _send(self,data:bytes,mime:str):
            self.send_response(200);self.send_header('Content-Type',mime)
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        def do_GET(self):
            if self.headers.get('Host','').split(':')[0].lower() not in ('127.0.0.1','localhost'):
                self.send_error(403, 'Local preview only'); return
            route=self.path.split('?',1)[0]
            if route in ('/secure-data.js','/secure-data.js/'):
                return self._send(LOCAL_SECURE_DATA.encode('utf-8'),'text/javascript; charset=utf-8')
            if route=='/site_config.json':
                return self._send(b'{"turnstileSiteKey":"","workerApiBase":"","githubRepository":"cbfitzpatrick/yjmb-family-tree"}',
                                  'application/json; charset=utf-8')
            if route=='/__local_preview_tree':
                return self._send(encoded,'application/json; charset=utf-8')
            if route=='/add-yourself.html':
                source=(DOCS/'add-yourself.html').read_text(encoding='utf-8')
                source=source.replace('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>','')
                return self._send(source.encode('utf-8'),'text/html; charset=utf-8')
            return super().do_GET()
        def log_message(self,format,*args):
            if self.path.split('?',1)[0]=='/__local_preview_tree': return
            super().log_message(format,*args)
    with ThreadingHTTPServer(('127.0.0.1',port),Handler) as server:
        print(f'LOCAL PREVIEW ONLY (no submissions): http://127.0.0.1:{port}/tree.html',flush=True)
        print(f'Add Yourself: http://127.0.0.1:{port}/add-yourself.html',flush=True)
        print('Using protected local tree in RAM.' if real_data else 'Using synthetic test profiles; card icons are enabled ONLY in this test fixture.',flush=True)
        print('Ctrl+C to stop. All updates are dry-run only.',flush=True)
        server.serve_forever()

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--real-data',action='store_true',help='decrypt local encrypted tree in memory with local access_secrets.json')
    args=parser.parse_args()
    serve(args.port,args.real_data)

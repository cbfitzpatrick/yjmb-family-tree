#!/usr/bin/env python3
from __future__ import annotations
import argparse, copy, json, os, re, tempfile, unicodedata
from pathlib import Path
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter, range_boundaries
from yjmb_taxonomy import canonical_formal_roles, informal_roles_from_text

class ReviewRequired(Exception): pass

def norm(v):
    s='' if v is None else str(v)
    s=unicodedata.normalize('NFKC',s).replace('\u00a0',' ')
    return re.sub(r'\s+',' ',s).strip()
def h(v): return re.sub(r'[^a-z0-9]','',norm(v).casefold())
def namekey(v): return re.sub(r'[^a-z0-9]','',unicodedata.normalize('NFKD',norm(v).casefold()))
def relation(name,year,section): return f"{norm(name)} ({int(year)}) ({norm(section)})"
def parse_row_id(value):
    m=re.fullmatch(r'row-(\d+)',norm(value))
    return int(m.group(1)) if m else None

def discover(ws):
    row=None; headers={}
    for r in range(1,min(ws.max_row,10)+1):
        cand={c:h(ws.cell(r,c).value) for c in range(1,ws.max_column+1)}
        if 'givenpreferredname' in cand.values() and 'familymaidenname' in cand.values(): row=r; headers=cand; break
    if not row: raise RuntimeError('Could not find People on Tree headers.')
    aliases={
      'given':['givenpreferredname'],'nickname':['nickname'],'family':['familymaidenname'],'married':['marriedname'],
      'year':['ratyear'],'instrument':['instrument','section'],'vet':['vet'],
      'display':['treedisplaynamepreference'],'sectionNick':['sectionnicknames'],'specific':['specificinstruments'],
      'memory':['favoritetechbandmemory'],'otherFlag':['participatedinothergtensembles'],'otherList':['othergtensembles'],
      'otherInstFlag':['playeddifferentinstrumentinothergtensembles'],'otherInst':['othergtensembleinstruments'],
      'leadership':['marchingbandleadershiproles'],'informalFlag':['servedininformalleadershipposition'],'informal':['informalleadershippositions'],'leadershipClass':['leadershippositionclassification'],
      'hasNick':['hasnickname'],'changed':['changedlastnamesinceband'],'multi':['hasbeeninmultiplesections'],'currentRat':['currentlyarat'],'pair':['ratvetpairsystemapplied']
    }
    out={}
    for k,vals in aliases.items():
        for c,v in headers.items():
            if v in vals: out[k]=c; break
    required=['given','nickname','family','married','year','instrument','vet']
    missing=[x for x in required if x not in out]
    if missing: raise RuntimeError('Missing required columns: '+', '.join(missing))
    rats=[]
    for c,v in headers.items():
        m=re.fullmatch(r'rat(\d+)',v)
        if m: rats.append((int(m.group(1)),c))
    rats.sort()
    if not rats: raise RuntimeError('No RAT columns found.')
    return row,out,rats

def set_if(mapping,ws,row,key,value):
    c=mapping.get(key)
    if c: ws.cell(row,c).value=value

def row_name(ws,row,m): return norm(f"{ws.cell(row,m['given']).value or ''} {ws.cell(row,m['family']).value or ''}")
def row_year(ws,row,m):
    try: return int(ws.cell(row,m['year']).value)
    except: return None

def append_style_row(ws, header_row):
    old=ws.max_row; row=old+1; src=max(header_row+1,old)
    for c in range(1,ws.max_column+1):
        a=ws.cell(src,c); b=ws.cell(row,c)
        if a.has_style: b._style=copy.copy(a._style)
        b.font=copy.copy(a.font); b.fill=copy.copy(a.fill); b.border=copy.copy(a.border); b.alignment=copy.copy(a.alignment); b.protection=copy.copy(a.protection)
        b.number_format=a.number_format
    for table in ws.tables.values():
        try: minc,minr,maxc,maxr=range_boundaries(table.ref)
        except: continue
        if minr<=header_row<=maxr and maxr==old: table.ref=f"{get_column_letter(minc)}{minr}:{get_column_letter(maxc)}{row}"
    return row

def ensure_rat(ws,parent_row,child_rel,rat_cols):
    ck=namekey(child_rel.split(' (',1)[0])
    for _,c in rat_cols:
        raw=norm(ws.cell(parent_row,c).value)
        if raw and namekey(raw.split(' (',1)[0])==ck:
            ws.cell(parent_row,c).value=child_rel; return True
    for _,c in rat_cols:
        if not norm(ws.cell(parent_row,c).value): ws.cell(parent_row,c).value=child_rel; return True
    raise ReviewRequired(f'Existing VET row {parent_row} has no blank RAT slot.')

def ensure_vet(ws,child_row,parent_rel,m):
    cell=ws.cell(child_row,m['vet']); existing=norm(cell.value)
    if not existing: cell.value=parent_rel; return True
    if namekey(existing.split(' (',1)[0])==namekey(parent_rel.split(' (',1)[0]): cell.value=parent_rel; return True
    raise ReviewRequired(f'Existing RAT row {child_row} already has a different VET.')

def apply(workbook:Path, submission_file:Path):
    wrapper=json.loads(submission_file.read_text(encoding='utf-8'))
    payload=wrapper.get('payload',wrapper)
    wb=load_workbook(workbook)
    if 'People on Tree' not in wb.sheetnames: raise RuntimeError('Worksheet People on Tree not found.')
    ws=wb['People on Tree']; header,m,rat_cols=discover(ws)
    selfd=payload.get('self') or {}; given=norm(selfd.get('givenPreferredName')); family=norm(selfd.get('familyMaidenName')); year=int(selfd.get('ratYear'))
    if not given or not family: raise ReviewRequired('Submitter name is incomplete.')
    duplicate=[]
    for r in range(header+1,ws.max_row+1):
        if namekey(row_name(ws,r,m))==namekey(f'{given} {family}') and row_year(ws,r,m)==year: duplicate.append(r)
    if duplicate: raise ReviewRequired(f'A same-name/same-year person already exists in row(s) {duplicate}.')

    # Preflight reciprocal relationships BEFORE changing workbook.
    vet=payload.get('vet') or None; rats=payload.get('rats') or []
    vet_row=parse_row_id(vet.get('matchedId')) if vet else None
    if vet_row and not (header < vet_row <= ws.max_row): raise ReviewRequired('Matched VET row no longer exists.')
    rat_rows=[]
    for item in rats:
        rr=parse_row_id(item.get('matchedId'))
        if rr:
            if not (header < rr <= ws.max_row): raise ReviewRequired('A matched RAT row no longer exists.')
            existing=norm(ws.cell(rr,m['vet']).value)
            if existing and namekey(existing.split(' (',1)[0]) != namekey(f'{given} {family}'):
                raise ReviewRequired(f'Matched RAT row {rr} already has another VET.')
        rat_rows.append((item,rr))
    if vet_row:
        blanks=sum(1 for _,c in rat_cols if not norm(ws.cell(vet_row,c).value))
        already=any(namekey(norm(ws.cell(vet_row,c).value).split(' (',1)[0])==namekey(f'{given} {family}') for _,c in rat_cols if norm(ws.cell(vet_row,c).value))
        if not blanks and not already: raise ReviewRequired(f'Matched VET row {vet_row} has no free RAT slot.')

    row=append_style_row(ws,header)
    sections=selfd.get('sections') or []
    section_names=[norm(x.get('section')) for x in sections if norm(x.get('section'))]
    instrument=', '.join(section_names) or norm(selfd.get('section'))
    set_if(m,ws,row,'given',given); set_if(m,ws,row,'nickname',norm(selfd.get('nickname')) or None); set_if(m,ws,row,'family',family); set_if(m,ws,row,'married',norm(selfd.get('marriedName')) or None)
    set_if(m,ws,row,'year',year); set_if(m,ws,row,'instrument',instrument); set_if(m,ws,row,'display','Nickname' if selfd.get('treeNamePreference')=='nickname' else 'Given/Preferred Name')
    set_if(m,ws,row,'sectionNick','; '.join(f"{norm(x.get('section'))}: {norm(x.get('sectionNickname'))}" for x in sections if norm(x.get('sectionNickname'))) or None)
    set_if(m,ws,row,'specific','; '.join(f"{norm(x.get('section'))}: {norm(x.get('specificInstrument'))}" for x in sections if norm(x.get('specificInstrument'))) or None)
    set_if(m,ws,row,'memory',norm(payload.get('favoriteTechBandMemory')) or None)
    set_if(m,ws,row,'otherFlag','Yes' if selfd.get('otherGtEnsembles') else 'No'); set_if(m,ws,row,'otherList',norm(selfd.get('otherGtEnsemblesList')) or None)
    set_if(m,ws,row,'otherInstFlag','Yes' if selfd.get('playedDifferentGtInstrument') else 'No'); set_if(m,ws,row,'otherInst',norm(selfd.get('otherGtInstruments')) or None)
    formal_roles=canonical_formal_roles(', '.join(selfd.get('marchingBandLeadershipRoles') or []))
    informal_description=norm(selfd.get('informalLeadershipDescription')) if selfd.get('informalLeadership') else ''
    informal_roles=informal_roles_from_text(informal_description)
    set_if(m,ws,row,'leadership',', '.join(formal_roles) or None)
    set_if(m,ws,row,'informalFlag','Yes' if selfd.get('informalLeadership') else 'No')
    set_if(m,ws,row,'informal',informal_description or None)
    classification='; '.join([*(f'Formal: {role}' for role in formal_roles), *(f'Informal: {role}' for role in informal_roles)])
    set_if(m,ws,row,'leadershipClass',classification or None)
    set_if(m,ws,row,'hasNick','Yes' if selfd.get('hasNickname') else 'No'); set_if(m,ws,row,'changed','Yes' if selfd.get('changedLastName') else 'No'); set_if(m,ws,row,'multi','Yes' if selfd.get('multipleSections') else 'No'); set_if(m,ws,row,'currentRat','Yes' if selfd.get('currentlyRat') else 'No'); set_if(m,ws,row,'pair','Yes' if (payload.get('pairSystem') or {}).get('applies') else 'No')
    self_rel=relation(f'{given} {family}',year,instrument)
    if vet:
        ws.cell(row,m['vet']).value=relation(vet.get('name'),vet.get('year'),vet.get('section'))
        if vet_row: ensure_rat(ws,vet_row,self_rel,rat_cols)
    for idx,(item,rr) in enumerate(rat_rows):
        if idx>=len(rat_cols): raise ReviewRequired('Submission has more RATs than workbook RAT columns.')
        ws.cell(row,rat_cols[idx][1]).value=relation(item.get('name'),item.get('year'),item.get('section'))
        if rr: ensure_vet(ws,rr,self_rel,m)
    # Only the submitter's own note is auto-applied. Third-party notes require human review.
    notes=payload.get('notes') or {}
    self_note=norm(notes.get('self'))
    if self_note:
        # Reuse a general Notes column if present; do not create new schema in automation.
        for c in range(1,ws.max_column+1):
            if h(ws.cell(header,c).value) in {'notes','note'}: ws.cell(row,c).value=self_note; break
    tmp=workbook.with_suffix('.secure-update.tmp.xlsx'); wb.save(tmp); wb.close(); os.replace(tmp,workbook)
    return {'row':row,'name':f'{given} {family}','year':year}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--workbook',type=Path,required=True); ap.add_argument('--submission',type=Path,required=True); ap.add_argument('--result',type=Path)
    a=ap.parse_args()
    try:
        result=apply(a.workbook,a.submission); out={'status':'applied',**result}; code=0
    except ReviewRequired as e:
        out={'status':'review','reason':str(e)}; code=20
    if a.result: a.result.write_text(json.dumps(out,indent=2)+"\n",encoding='utf-8')
    else: print(json.dumps(out,indent=2))
    raise SystemExit(code)
if __name__=='__main__': main()

#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, shutil
from pathlib import Path
from secure_submission import decrypt_file
from apply_secure_submission import apply, ReviewRequired

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--workbook',type=Path,required=True); ap.add_argument('--queue',type=Path,default=Path('.secure_submissions/auto')); ap.add_argument('--review-dir',type=Path,default=Path('.secure_submissions/review')); ap.add_argument('--result',type=Path,default=Path('queue_result.json'))
    a=ap.parse_args(); a.review_dir.mkdir(parents=True,exist_ok=True)
    result={'applied':[],'review':[]}
    for enc in sorted(a.queue.glob('*.enc.json')):
        sid=enc.name.removesuffix('.enc.json')
        tmp=Path(f'.secure-submission-{sid}.json')
        try:
            protected=decrypt_file(enc); tmp.write_text(json.dumps(protected,ensure_ascii=False),encoding='utf-8')
            try:
                info=apply(a.workbook,tmp); result['applied'].append({'id':sid,'row':info['row']}); enc.unlink()
            except ReviewRequired as exc:
                dest=a.review_dir/enc.name; shutil.move(str(enc),str(dest)); result['review'].append({'id':sid,'path':str(dest).replace('\\','/'),'reason':str(exc)})
        except Exception as exc:
            dest=a.review_dir/enc.name
            if enc.exists(): shutil.move(str(enc),str(dest))
            result['review'].append({'id':sid,'path':str(dest).replace('\\','/'),'reason':f'Queue processing error: {type(exc).__name__}'})
        finally:
            tmp.unlink(missing_ok=True)
    a.result.write_text(json.dumps(result,indent=2)+"\n",encoding='utf-8')
    print(json.dumps(result,indent=2))
if __name__=='__main__': main()

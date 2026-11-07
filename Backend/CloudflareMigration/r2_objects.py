#!/usr/bin/env python3
"""Copy only active operational object references from mixed old hotel R2 bucket.

No patient/customer files are uploaded to artifacts or logged. Two-account credentials
require R2 permissions; source buckets are never modified.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import mimetypes
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

SOURCE_BUCKET = 'iumrah-hotels-media'
TARGET_BUCKET = 'iumrah-operations-media'


def references(sql_path: Path) -> list[dict]:
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    db.executescript(sql_path.read_text(encoding='utf8'))
    found = {}
    for table_row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
        table = table_row['name']
        cols = [col[1] for col in db.execute(f'PRAGMA table_info("{table}")')]
        key_fields = [col for col in cols if col == 'object_key' or col.endswith('_object_key')]
        for field in key_fields:
            ct_candidates = [field.replace('_object_key','_content_type'),
                             'content_type','photo_content_type','payme_qr_content_type']
            ct_candidates = [x for x in ct_candidates if x in cols]
            for row in db.execute(f'SELECT * FROM "{table}" WHERE "{field}" IS NOT NULL AND "{field}" != ""'):
                key = str(row[field]).strip()
                if not key or key.startswith(('hotels/','hotel/')):
                    continue
                if key.startswith('/') or '..' in key.split('/'):
                    raise ValueError(f'Unsafe R2 object key in {table}')
                content_type = next((str(row[c]) for c in ct_candidates if row[c]),'')
                if not content_type:
                    content_type = mimetypes.guess_type(key)[0] or 'application/octet-stream'
                found[key] = content_type
    db.close()
    return [{'key':key,'content_type':ctype} for key, ctype in sorted(found.items())]


def call_wrangler(args, account: str, token: str):
    env = os.environ.copy()
    env.update({'CLOUDFLARE_ACCOUNT_ID':account,'CLOUDFLARE_API_TOKEN':token})
    try:
        subprocess.run(['wrangler',*args],env=env,check=True,stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL,timeout=300)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        raise RuntimeError('R2 operation failed. Check read/write permissions and bucket availability.') from None


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--core-sql',type=Path,required=True)
    p.add_argument('--mode',choices=['count','copy'],default='count')
    args=p.parse_args()
    entries=references(args.core_sql)
    print(f'Operational R2 objects referenced by new D1: {len(entries)}')
    if args.mode=='count':return
    old_a,old_t=(os.getenv(x,'') for x in ['OLD_CLOUDFLARE_ACCOUNT_ID','OLD_CLOUDFLARE_API_TOKEN'])
    new_a,new_t=(os.getenv(x,'') for x in ['NEW_CLOUDFLARE_ACCOUNT_ID','NEW_CLOUDFLARE_API_TOKEN'])
    if not all((old_a,old_t,new_a,new_t)) or old_a==new_a:
        raise RuntimeError('Distinct old and new Cloudflare credentials required to copy R2')
    # Require a fresh destination bucket; do not silently overwrite existing private files.
    try:
        call_wrangler(['r2','bucket','info',TARGET_BUCKET],new_a,new_t)
    except RuntimeError:
        call_wrangler(['r2','bucket','create',TARGET_BUCKET],new_a,new_t)
    else:
        raise RuntimeError('Target R2 bucket already exists; refusing to overwrite any objects. '
                           'Use a new empty migration bucket after verifying its contents.')
    with tempfile.TemporaryDirectory() as work:
        pth=Path(work)
        for idx,record in enumerate(entries, start=1):
            key=record['key']; tmp=pth/'payload.bin'; verify=pth/'verify.bin'
            # Reusing one temporary path keeps private names out of the filesystem.
            call_wrangler(['r2','object','get',f'{SOURCE_BUCKET}/{key}','--remote','--file',str(tmp)],old_a,old_t)
            call_wrangler(['r2','object','put',f'{TARGET_BUCKET}/{key}','--remote',
                           '--file',str(tmp),'--content-type',record['content_type']],new_a,new_t)
            call_wrangler(['r2','object','get',f'{TARGET_BUCKET}/{key}','--remote','--file',str(verify)],new_a,new_t)
            if hashlib.sha256(tmp.read_bytes()).digest()!=hashlib.sha256(verify.read_bytes()).digest():
                raise RuntimeError(f'R2 checksum verification failed for operational object #{idx}')
            tmp.unlink();verify.unlink()
            if idx%25==0:print(f'R2 verified {idx}/{len(entries)} objects')
    print(f'R2 migration PASS: {len(entries)} referenced objects copied and byte-verified.')

if __name__=='__main__':
    try:main()
    except Exception as e:
        print(f'R2 migration blocked: {e}',file=sys.stderr)
        sys.exit(1)

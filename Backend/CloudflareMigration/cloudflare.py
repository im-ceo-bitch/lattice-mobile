#!/usr/bin/env python3
"""New-account D1 provisioning/verification; safe guards prevent overwriting any rows."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = 'https://api.cloudflare.com/client/v4/accounts'


def ident(v: str) -> str:
    if not re.fullmatch(r'[A-Za-z0-9_-]+', v):
        raise ValueError('Unsafe D1 database/table identifier')
    return v


def sql_identifier(value: str) -> str:
    return '"' + value.replace('"','""') + '"'


class Cloudflare:
    def __init__(self, account: str, token: str):
        if not re.fullmatch(r'[0-9a-fA-F]{32}', account):
            raise ValueError('Cloudflare account ID should be a 32-character hex string')
        if not token:
            raise ValueError('Cloudflare API Token missing')
        self.url = ROOT + '/' + account + '/d1/database'
        self.token = token

    def request(self, method: str, uri: str, body=None):
        payload = json.dumps(body).encode() if body is not None else None
        for attempt in range(4):
            try:
                req = Request(uri, method=method, data=payload, headers={
                    'Authorization': 'Bearer ' + self.token,
                    'Content-Type': 'application/json',
                    'User-Agent': 'iumrah-core-migration/1',
                })
                with urlopen(req, timeout=60) as response:
                    result = json.load(response)
                if not result.get('success'):
                    raise RuntimeError('Cloudflare API rejected request')
                return result
            except (HTTPError, URLError, TimeoutError) as e:
                if isinstance(e, HTTPError) and e.code not in [429, 500, 502, 503, 504]:
                    raise RuntimeError(f'Cloudflare HTTP {e.code} on {method}; check token scope') from None
                if attempt == 3:
                    raise RuntimeError('Cloudflare API temporarily unavailable') from None
                time.sleep(2**attempt)
        raise AssertionError('unreachable')

    def list_d1(self):
        found = {}
        for page in range(1, 201):
            response = self.request('GET', self.url + '?' + urlencode({'page':page, 'per_page':100}))
            for x in response.get('result') or []:
                found[x['name']] = x.get('uuid') or x.get('id')
            info = response.get('result_info') or {}
            if (info.get('total_count') is not None and len(found) >= info['total_count']) or len(response.get('result') or []) < 100:
                return found
        raise ValueError('D1 list pagination incomplete')

    def create(self, name):
        response = self.request('POST', self.url, {'name':name})
        db = response.get('result') or {}
        result_id = db.get('uuid') or db.get('id')
        if not result_id:
            raise RuntimeError('Create succeeded without a D1 id; abort')
        return result_id

    def query(self, id_, sql):
        response = self.request('POST', self.url + '/' + id_ + '/query', {'sql':sql})
        result = response.get('result') or []
        if not result or not result[0].get('success', True):
            raise RuntimeError('D1 query failed')
        return result[0].get('results') or []


def preflight(cf: Cloudflare, report: dict, allow_create: bool):
    existing = cf.list_d1()
    resolution = {}
    for item in report['reports']:
        db = ident(item['target'])
        if db in existing:
            id_ = existing[db]
        elif allow_create:
            print(f'Creating empty target D1: {db}')
            id_ = cf.create(db)
        else:
            print(f'Dry run: would create D1: {db}')
            continue
        tables = cf.query(id_, "SELECT name FROM sqlite_master WHERE type='table' "
                                 "AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV')")
        # Never write into any existing schema; it may hold real data or be a staged app.
        if tables:
            raise RuntimeError(f'Target D1 {db} is not empty ({len(tables)} tables). '
                               'Migration deliberately refuses overwrite; use a fresh DB.')
        resolution[db] = id_
    return resolution


def verify(cf: Cloudflare, report: dict):
    all_dbs = cf.list_d1()
    failures = []
    for d in report['reports']:
        name = d['target']
        id_ = all_dbs.get(name)
        if not id_:
            failures.append(f'{name}: database missing');continue
        tables = sorted(d['tables'])
        # Small batches to stay below D1 compound SELECT limit.
        for start in range(0, len(tables), 50):
            group = tables[start:start+50]
            query = ' UNION ALL '.join(
                "SELECT '" + name1.replace("'","''") + "' AS table_name, "
                "COUNT(*) AS row_count FROM " + sql_identifier(name1) for name1 in group
            )
            for row in cf.query(id_, query):
                name2 = row.get('table_name')
                expected = d['tables'][name2]['kept']
                actual = int(row.get('row_count', -1))
                if actual != expected:
                    failures.append(f'{name}.{name2}: {actual} not {expected}')
        try:
            fk_count = cf.query(id_, 'SELECT COUNT(*) AS n FROM pragma_foreign_key_check')[0]['n']
            if int(fk_count) != 0:
                failures.append(f'{name}: foreign key check failed ({fk_count})')
        except (KeyError, IndexError, RuntimeError):
            failures.append(f'{name}: foreign-key validation query failed')
        print(f'Checked {name}: {len(tables)} tables')
    if failures:
        raise RuntimeError('Verification failures: ' + '; '.join(failures))
    print('PASS: destination counts and foreign-key checks match prepared source.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['preflight', 'verify'])
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--allow-create', action='store_true')
    args = parser.parse_args()
    old_id = os.getenv('OLD_CLOUDFLARE_ACCOUNT_ID','')
    new_id = os.getenv('NEW_CLOUDFLARE_ACCOUNT_ID','')
    if not old_id or not new_id or old_id.lower() == new_id.lower():
        raise RuntimeError('Old and new Cloudflare Account IDs are missing or identical; abort')
    cf = Cloudflare(new_id, os.getenv('NEW_CLOUDFLARE_API_TOKEN',''))
    report = json.loads(args.report.read_text())
    if args.command == 'preflight':
        result = preflight(cf,report,args.allow_create)
        if args.output:
            args.output.write_text(json.dumps(result, indent=2) + '\n')
    else:
        verify(cf,report)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'Cloudflare migration blocked: {e}', file=sys.stderr)
        sys.exit(1)

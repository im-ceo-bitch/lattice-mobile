#!/usr/bin/env python3
"""Prepare non-hotel, current-flight D1 SQL from OLD Wrangler exports.

Safety: no network; never modifies source exports. Raw SQL & destination SQL are PRIVATE.
Only redacted counts are suitable for GitHub artifacts. SQLite is used to parse SQL
instead of fragile regex filtering of INSERT statements.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sqlite3
import sys
from pathlib import Path

SYSTEM = {"_cf_KV"}
EMPTY_DERIVED = {
    'flight_search_cache', 'flight_search_locks', 'flight_verification_cache',
    'storefront_package_snapshots', 'storefront_package_cache',
    'storefront_flight_refresh_progress',
}
DATE_PATTERN = re.compile(r'^\d{4}-\d{2}-\d{2}$')
DROP_HOTEL_FK = re.compile(
    r',\s*FOREIGN\s+KEY\s*\([^)]*\)\s*REFERENCES\s+["`\[]?hotels["`\]]?\s*\([^)]*\)'
    r'(?:\s+ON\s+DELETE\s+(?:SET\s+NULL|CASCADE|RESTRICT|NO\s+ACTION))?',
    flags=re.I,
)


def qi(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def is_valid_future(date_value: object, cutoff: str) -> bool:
    value = str(date_value or '')[:10]
    if not DATE_PATTERN.fullmatch(value):
        return False
    try:
        dt.date.fromisoformat(value)
    except ValueError:
        return False
    return value >= cutoff


def allow_row(db: str, name: str, row: sqlite3.Row, cutoff: str) -> bool:
    if name == 'curated_flight_offers':
        return is_valid_future(row['outbound_date'], cutoff) and (
            row['inbound_date'] is None or is_valid_future(row['inbound_date'], cutoff)
        )
    if name == 'flight_calendar_fares':
        return is_valid_future(row['outbound_date'], cutoff) and (
            row['inbound_date'] is None or is_valid_future(row['inbound_date'], cutoff)
        )
    if name in EMPTY_DERIVED:
        return False
    if name == 'seo_page_registry':
        # Avoid retaining explicitly hotel-indexed SEO pages. The old hotel API is retired.
        return 'hotel' not in str(row['page_key']).lower()
    return True


def fix_row(name: str, cols: list[str], row: sqlite3.Row) -> tuple:
    values = tuple(row[k] for k in cols)
    if name == 'business_flight_sync_feeds':
        # Preserve existing feed token & ownership, but never republish stale offers.
        values = list(values)
        for key, val in [('snapshot_json', '{"version":1,"flights":[]}'),
                         ('flight_count', 0), ('snapshot_updated_at', None)]:
            if key in cols:
                values[cols.index(key)] = val
        return tuple(values)
    return values


def safe_schema(source: sqlite3.Connection, destination: sqlite3.Connection,
                allow: set[str], exclude: set[str]):
    original = {r['name']: r['sql'] for r in source.execute(
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ) if r['name'] not in SYSTEM}
    unknown = set(original) - allow - exclude
    if unknown:
        raise ValueError(f'NEW TABLES not classified by policy: {sorted(unknown)}; review first')
    missing = allow - set(original)
    if missing:
        raise ValueError(f'Expected tables missing: {sorted(missing)}; update audit/policy first')
    for name in sorted(allow):
        sql = original[name]
        if not sql or sql.upper().startswith('CREATE VIRTUAL'):
            raise ValueError(f'Unsupported virtual/missing schema: {name}')
        if name == 'trip_assignments':
            sql, n = DROP_HOTEL_FK.subn('', sql)
            if n != 2:
                raise ValueError(f'Expected 2 hotel foreign keys on trip_assignments, found {n}')
        for excluded_name in exclude:
            if re.search(r'\bREFERENCES\s+["`\[]?' + re.escape(excluded_name) + r'\b', sql, re.I):
                raise ValueError(f'Dangling foreign key from {name} to {excluded_name}')
        destination.execute(sql)
    return original


def import_indexes_and_triggers(source: sqlite3.Connection, destination: sqlite3.Connection,
                                allow: set[str], exclude: set[str]):
    all_ddl = source.execute(
        "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('index','trigger','view') "
        "AND sql IS NOT NULL ORDER BY CASE type WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 ELSE 3 END"
    ).fetchall()
    for entry in all_ddl:
        ddl = entry['sql']
        if entry['type'] in ('index', 'trigger') and entry['tbl_name'] not in allow:
            continue
        if any(re.search(r'\b' + re.escape(ex) + r'\b', ddl, re.I) for ex in exclude):
            if entry['type'] != 'view' and entry['tbl_name'] in allow:
                # Rare mixed trigger; fail rather than silently dropping behavior.
                raise ValueError(f'An included table has a trigger/index referencing excluded table: {entry["name"]}')
            continue
        if entry['type'] == 'view':
            # Preserving views is useful if old Worker queries them, provided all refs exist.
            destination.execute(ddl)
        else:
            destination.execute(ddl)


def prepare_one(name: str, spec: dict, export_path: Path, stage_dir: Path, cutoff: str) -> dict:
    src = sqlite3.connect(':memory:')
    src.row_factory = sqlite3.Row
    src.execute('PRAGMA foreign_keys=OFF')
    # Original Wrangler export is executed in a sandboxed in-memory SQLite, never against production.
    data = export_path.read_text(encoding='utf-8')
    if 'ATTACH DATABASE' in data.upper() or 'LOAD_EXTENSION' in data.upper():
        raise ValueError('Unsafe SQL construct found in export')
    src.executescript(data)
    dst = sqlite3.connect(':memory:')
    dst.row_factory = sqlite3.Row
    dst.execute('PRAGMA foreign_keys=OFF')
    allow, exclude = set(spec['allow']), set(spec['exclude'])
    safe_schema(src, dst, allow, exclude)
    counts = {}
    for table in sorted(allow):
        cols = [r['name'] for r in src.execute(f'PRAGMA table_info({qi(table)})')]
        if not cols:
            raise ValueError(f'Table has no fields: {name}.{table}')
        placeholders = ','.join('?' for _ in cols)
        sql = f'INSERT INTO {qi(table)} ({", ".join(qi(c) for c in cols)}) VALUES ({placeholders})'
        kept, skipped = 0, 0
        cursor = src.execute('SELECT * FROM ' + qi(table))
        while True:
            batch = cursor.fetchmany(400)
            if not batch:
                break
            inserts = []
            for row in batch:
                if not allow_row(name, table, row, cutoff):
                    skipped += 1
                    continue
                inserts.append(fix_row(table, cols, row))
            if inserts:
                dst.executemany(sql, inserts)
                kept += len(inserts)
        counts[table] = {'kept': kept, 'skipped': skipped}
    import_indexes_and_triggers(src, dst, allow, exclude)
    fk_errors = list(dst.execute('PRAGMA foreign_key_check'))
    if fk_errors:
        # Do not print FK values containing private ids.
        raise ValueError(f'{name}: {len(fk_errors)} FK integrity errors, aborting import')
    if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise ValueError(f'{name}: failed local SQLite integrity check')

    output = stage_dir / f'{spec["target"]}.sql'
    output.parent.mkdir(parents=True, exist_ok=True)
    # sqlite3 .iterdump() safely quotes all actual row values. Imports cannot use BEGIN/COMMIT
    # nor PRAGMA foreign_keys=OFF in Cloudflare D1.
    lines = list(dst.iterdump())
    safe = []
    for line in lines:
        s = line.strip().upper()
        if s in {'BEGIN TRANSACTION;', 'COMMIT;', 'PRAGMA FOREIGN_KEYS=OFF;',
                 'PRAGMA FOREIGN_KEYS=ON;'}:
            continue
        if re.search(r'\b_CF_KV\b', line, re.I):
            continue
        safe.append(line)
    output.write_text('PRAGMA defer_foreign_keys=ON;\n' + '\n'.join(safe) + '\n', encoding='utf-8')
    # Parse the produced SQL in standalone SQLite so invalid generated SQL fails early.
    sanity = sqlite3.connect(':memory:')
    sanity.executescript(output.read_text(encoding='utf-8'))
    for table, record in counts.items():
        actual = sanity.execute('SELECT COUNT(*) FROM ' + qi(table)).fetchone()[0]
        if actual != record['kept']:
            raise ValueError(f'{name}.{table}: roundtrip count mismatch')
    src.close(); dst.close(); sanity.close()
    return {'source': name, 'target': spec['target'], 'tables': counts,
            'total_rows': sum(v['kept'] for v in counts.values()),
            'total_skipped': sum(v['skipped'] for v in counts.values()),
            'excluded_table_names': sorted(exclude)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--policy', required=True, type=Path)
    parser.add_argument('--exports', required=True, type=Path)
    parser.add_argument('--stage', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--cutoff', required=True, help='YYYY-MM-DD, Asia/Tashkent')
    args = parser.parse_args()
    dt.date.fromisoformat(args.cutoff)
    policy = json.loads(args.policy.read_text(encoding='utf-8'))
    reports = []
    for name, spec in policy['databases'].items():
        original = args.exports / (name + '.sql')
        if not original.exists():
            raise FileNotFoundError(f'Missing required Wrangler export: {original.name}')
        reports.append(prepare_one(name, spec, original, args.stage, args.cutoff))
    summary = {'migration_date': args.cutoff, 'reports': reports,
               'note': 'Private SQL files must never be uploaded as GitHub artifacts.'}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    for info in reports:
        print(f'{info["source"]} -> {info["target"]}: {len(info["tables"])} tables, '
              f'{info["total_rows"]} records retained, {info["total_skipped"]} cache/expired records discarded')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'Migration preparation stopped: {type(e).__name__}: {e}', file=sys.stderr)
        sys.exit(1)

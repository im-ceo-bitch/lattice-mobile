#!/usr/bin/env python3
"""PRIVATE, offline, additive D1 merge and parity verification. No network, no writes to Cloudflare.
Run once for each *explicit* source/target binding pair. Never commit input or output SQL.
"""
import argparse, sqlite3, json, sys
from pathlib import Path
from collections import Counter
from split_core_dump import q, literal

def load(path):
    db=sqlite3.connect(':memory:')
    db.executescript(Path(path).read_text(encoding='utf-8'))
    db.execute('PRAGMA foreign_keys=OFF')
    return db

def tables(db):
    return dict(db.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'"))

def columns(db,t): return list(db.execute(f'PRAGMA table_info({q(t)})'))
def rows(db,t,cols): return list(db.execute(f'SELECT {", ".join(q(c) for c in cols)} FROM {q(t)}'))

def prepare(src,dst,selected):
    source,target=tables(src),tables(dst)
    if not selected or set(selected)-source.keys(): raise ValueError('UNKNOWN_OR_EMPTY_SELECTION')
    statements=[]; new=[]; report={}
    for name in selected:
        if name not in target:
            statements.append(source[name].rstrip(';')+';');new.append(name)
    for statement in statements: dst.execute(statement)
    for name in selected:
        old_cols=columns(src,name); new_cols=columns(dst,name)
        cols=[c[1] for c in old_cols]; dst_cols={c[1] for c in new_cols}
        if not set(cols)<=dst_cols: raise ValueError('MISSING_DESTINATION_COLUMNS:'+name)
        old_pk=[c[1] for c in sorted(old_cols,key=lambda c:c[5]) if c[5]]
        new_pk=[c[1] for c in sorted(new_cols,key=lambda c:c[5]) if c[5]]
        if old_pk!=new_pk: raise ValueError('PRIMARY_KEY_MISMATCH:'+name)
        before=rows(src,name,cols); after=rows(dst,name,cols)
        missing=[]
        if old_pk:
            ix=[cols.index(c) for c in old_pk];key=lambda row:tuple(row[j] for j in ix)
            existing={key(r):r for r in after}
            if len(existing)!=len(after):raise ValueError('AMBIGUOUS_DESTINATION_KEYS:'+name)
            for r in before:
                if key(r) in existing:
                    if existing[key(r)]!=r:raise ValueError('ROW_CONFLICT:'+name)
                else:missing.append(r)
        elif not after: missing=before
        elif Counter(after)!=Counter(before):raise ValueError('NO_PRIMARY_KEY_CONFLICT:'+name)
        sql=f'INSERT INTO {q(name)} ({", ".join(q(c) for c in cols)}) VALUES '
        for row in missing:
            statement=sql+'('+', '.join(literal(v) for v in row)+');';dst.execute(statement);statements.append(statement)
        report[name]={'source':len(before),'already_present':len(before)-len(missing),'insert':len(missing),'target_only':len(after)-(len(before)-len(missing))}
    # Preserve sequence high-water marks, including IDs of deleted rows.
    if 'sqlite_sequence' in [r[0] for r in src.execute("SELECT name FROM sqlite_master")]:
        for t,seq in src.execute('SELECT name,seq FROM sqlite_sequence'):
            if t not in selected:continue
            current=dst.execute('SELECT seq FROM sqlite_sequence WHERE name=?',(t,)).fetchone()
            if current and current[0]>=seq:continue
            statement=(f'UPDATE sqlite_sequence SET seq={int(seq)} WHERE name={literal(t)};' if current else f'INSERT INTO sqlite_sequence(name,seq) VALUES({literal(t)},{int(seq)});')
            dst.execute(statement);statements.append(statement)
    # For new tables install original constraints/indexes/triggers after data insertion.
    for typ,name,t,sql in src.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('index','trigger') AND sql IS NOT NULL"):
        if t in new:
            statement=sql.rstrip(';')+';';dst.execute(statement);statements.append(statement)
    for t in selected:
        cols=[c[1] for c in columns(src,t)]
        if Counter(rows(src,t,cols))-Counter(rows(dst,t,cols)):raise ValueError('PARITY_FAILED:'+t)
    if list(dst.execute('PRAGMA foreign_key_check')):raise ValueError('FOREIGN_KEY_CHECK_FAILED')
    return statements,report

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('source');ap.add_argument('target');ap.add_argument('--tables',required=True,help='Comma-separated explicit tables, or ALL for an entire source database')
    mode=ap.add_mutually_exclusive_group(required=True);mode.add_argument('--plan',action='store_true');mode.add_argument('--verify',action='store_true');mode.add_argument('--output',type=Path)
    args=ap.parse_args()
    try:
        src,dst=load(args.source),load(args.target)
        selected=sorted(tables(src)) if args.tables=='ALL' else sorted(set(x.strip() for x in args.tables.split(',') if x.strip()))
        statements,report=prepare(src,dst,selected)
        print(json.dumps({'tables':report,'source_tables_not_selected':sorted(set(tables(src))-set(selected)),'private_sql_statements':len(statements),'remote_changes':False},indent=2))
        if args.verify and statements:raise ValueError('TARGET_NOT_YET_IDENTICAL_TO_SOURCE')
        if args.output:
            if args.output.exists():raise ValueError('OUTPUT_ALREADY_EXISTS')
            # No replacement, DELETE, DROP or overwrite of existing rows. Import using D1 tooling.
            with args.output.open('x',encoding='utf-8') as f:f.write('-- PRIVATE DATA: NEVER COMMIT\nPRAGMA defer_foreign_keys=TRUE;\n'+'\n'.join(statements)+'\n')
            args.output.chmod(0o600)
    except (ValueError,sqlite3.Error) as e:
        # SQLite errors may include customer data: emit only a sanitized category.
        print(str(e) if isinstance(e,ValueError) else 'SQLITE_MERGE_REFUSED',file=sys.stderr);sys.exit(1)
if __name__=='__main__':main()

#!/usr/bin/env python3
"""Validate the audited isolated module against its checked-in fingerprints.
Optional argument: path to the reference client Sources directory (with V3 applied).
This verifies source bytes, not visual rendering.
"""
import hashlib
import json
import sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'parity-manifest.json').read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
reference = Path(sys.argv[1]) if len(sys.argv) > 1 else None
errors = []
count = 0
for key in ('exact', 'adapted', 'module_only'):
    for item in manifest[key]:
        rel = item['path']
        path = root / 'Sources' / rel
        if not path.is_file() or sha(path) != item['business_sha256']:
            errors.append(f'Business source drift: {rel}')
        if reference is not None and 'client_sha256' in item:
            source = reference / rel
            if not source.is_file() or sha(source) != item['client_sha256']:
                errors.append(f'Client reference drift: {rel}')
        count += 1
if errors:
    print('\n'.join(errors), file=sys.stderr)
    raise SystemExit(1)
print(f'PASS: {count} module source fingerprints')

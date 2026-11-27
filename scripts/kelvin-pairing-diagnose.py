#!/usr/bin/env python3
"""Read-only diagnostics except an authenticated heartbeat (updates last_seen).
No secrets stored or printed. Never follows redirects or accepts a custom host.
Run on the actual MacBook from Terminal, not CI.
"""
import argparse
import getpass
import json
import re
import urllib.error
import urllib.request

URL = 'https://iumrah-backend.helloiumrah.workers.dev/api/internal/kelvin/heartbeat'
REVISION = 'kelvin-bridge-diagnostics-v5'
ERROR_CODES = {'UNAUTHORIZED', 'CROSS_ORIGIN_REQUEST', 'CORE_CUTOVER_PENDING',
               'KELVIN_UNAVAILABLE', 'METHOD_NOT_ALLOWED', 'NOT_FOUND',
               'KELVIN_OWNER_SESSION_REQUIRED', 'FORBIDDEN'}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def probe(token=None, opener=None):
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}
    if token is not None:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(URL, data=b'{}', headers=headers, method='POST')
    opener = opener or urllib.request.build_opener(NoRedirect())
    try:
        try:
            response = opener.open(req, timeout=20)
        except urllib.error.HTTPError as exc:
            response = exc
        with response as r:
            status = r.code
            raw = r.read(16384)
            h = r.headers
            report = {'http': status, 'content_type': h.get('Content-Type', '').split(';')[0]}
            for name, pattern in [('CF-Ray', r'[a-fA-F0-9-]{1,64}[A-Z0-9]*'),
                                  ('CF-Mitigated', r'challenge'),
                                  ('X-Kelvin-Bridge-Revision', r'kelvin-bridge-diagnostics-v5'),
                                  ('X-Kelvin-Request-Id', r'[a-f0-9-]{36}'),
                                  ('X-Kelvin-Stage', r'(origin|core-readiness|service-auth-handler|service-exception|staff-auth-handler)')]:
                value = h.get(name, '')
                if re.fullmatch(pattern, value):
                    report[name.lower()] = value
            try:
                obj = json.loads(raw)
            except (ValueError, UnicodeError):
                obj = None
            if isinstance(obj, dict):
                err = obj.get('error')
                if isinstance(err, str) and err in ERROR_CODES:
                    report['error'] = err
                if isinstance(obj.get('ok'), bool):
                    report['ok'] = obj['ok']
            else:
                report['non_json'] = True
            report['classification'] = classify(report, token is not None)
            return report
    except (urllib.error.URLError, OSError) as exc:
        return {'classification': 'NETWORK_OR_TLS_ERROR', 'exception_type': type(exc).__name__}

def classify(r, authenticated):
    code, error = r.get('http'), r.get('error')
    if code == 200 and r.get('ok') is True:
        return 'HEARTBEAT_OK' if authenticated else 'UNEXPECTED_UNAUTHENTICATED_SUCCESS'
    if code == 401 and error == 'UNAUTHORIZED':
        return 'KEY_REJECTED' if authenticated else 'SERVICE_AUTH_EXPECTED'
    if code == 403 and error == 'CROSS_ORIGIN_REQUEST':
        return 'WORKER_ORIGIN_REJECTED'
    if code == 503 and error == 'CORE_CUTOVER_PENDING':
        return 'CORE_NOT_READY'
    if code == 503 and error == 'KELVIN_UNAVAILABLE':
        return 'WORKER_SERVICE_UNAVAILABLE'
    if code == 404:
        return 'ENDPOINT_NOT_FOUND'
    if 300 <= code < 400:
        return 'REDIRECT_NOT_FOLLOWED_CHECK_ACCESS_OR_ENDPOINT'
    if code == 403:
        if r.get('cf-mitigated') == 'challenge':
            return 'CLOUDFLARE_CHALLENGE'
        return 'FORBIDDEN_SOURCE_UNCONFIRMED_CHECK_WORKER_AND_EDGE_LOGS'
    return 'UNEXPECTED_RESPONSE'

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--with-key', action='store_true', help='Prompt for current pairing key without echo; do not rotate it.')
    args = p.parse_args()
    public = probe()
    print(json.dumps({'probe':'without_key', **public}, ensure_ascii=False, indent=2))
    if not args.with_key:
        return 0 if public.get('classification') == 'SERVICE_AUTH_EXPECTED' else 1
    token = getpass.getpass('Current pairing key (not echoed): ').strip()
    if not re.fullmatch(r'[a-f0-9]{64}', token):
        print('INVALID_LOCAL_KEY_FORMAT: expected exactly 64 lowercase hex characters')
        return 2
    result = probe(token)
    print(json.dumps({'probe':'with_key', **result}, ensure_ascii=False, indent=2))
    return 0 if result.get('classification') == 'HEARTBEAT_OK' else 1

if __name__ == '__main__':
    raise SystemExit(main())

#!/usr/bin/env python3
"""Preflight for iumrah Root. Static check; requires no Apple credentials or Xcode."""
from pathlib import Path
import plistlib
import json
import sys
root = Path(__file__).resolve().parents[1]
errors = []

def check(test, message):
    if not test: errors.append(message)

project = (root / 'project.yml').read_text()
check('PRODUCT_BUNDLE_IDENTIFIER: com.iumrah.root' in project, 'Wrong XcodeGen bundle ID')
check('PRODUCT_BUNDLE_IDENTIFIER: com.iumrah.business' not in project, 'Old XcodeGen bundle ID remains')
check('MARKETING_VERSION: "1.0.0"' in project, 'Expected version 1.0.0')
check('TARGETED_DEVICE_FAMILY: "1,2"' in project, 'iPhone+iPad target missing')
check('DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER: NO' in project, 'Unexpected Catalyst ID derivation')
check('DEVELOPMENT_TEAM: ""' in project, 'Hardcoded Apple team detected')
check('com.iumrah.root.device-security' in (root/'Sources/Core/BusinessSessionSecurity.swift').read_text(), 'Keychain service old')
server = (root/'Backend/HotelsWorker/src/index.js').read_text()
check("const BUSINESS_APP_BUNDLE_ID = 'com.iumrah.root'" in server, 'Backend APNs topic is old')
check('VALUES (?, ?, ?, ?, 1, ?, ?, NULL, ?)' in server, 'Backend device registration topic hardcoded')
check('com.iumrah.app' in server, 'Client app topic unexpectedly removed')
for name in ('iumrahBusiness.entitlements', 'iumrahBusinessMac.entitlements'):
    with (root/'Resources'/name).open('rb') as f: ent = plistlib.load(f)
    key = 'com.apple.developer.aps-environment' if 'Mac' in name else 'aps-environment'
    check(ent.get(key)=='production', f'{name}: expected production push entitlement')
config_path = root/'Resources/EndpointConfig.json'
check(config_path.is_file() and isinstance(json.loads(config_path.read_text()),dict), 'Invalid endpoint config resource')
# Legacy signing files can remain tracked in an EXISTING repo until separate deletion;
# ios-root-testflight.yml must never read them.
ci = root/'.github/workflows/ios-root-testflight.yml'
if ci.is_file():
    body=ci.read_text()
    check('ROOT_IOS_PROFILE_B64' in body and 'ROOT_DISTRIBUTION_KEY_B64' in body, 'Root workflow missing new Team secret names')
    check('Signing/distribution-private-key.enc' not in body, 'Root workflow refers to legacy key')
    check('Signing/iumrah-business.mobileprovision' not in body, 'Root workflow refers to legacy profile')
if errors:
    for error in errors: print('ERROR:',error)
    sys.exit(1)
print('PASS: com.iumrah.root, iPhone/iPad, API resource, APNs entitlements, root CI isolation')

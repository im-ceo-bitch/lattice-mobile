"""Compile and execute the actual chat synchronization methods with a deterministic mock API.
Apple UI/Keychain/APNs are not exercised by this Foundation-only harness.
"""
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
source = (root / 'Sources/Views/ChatsView.swift').read_text()
start = source.index('    @MainActor private func syncMessages() async throws {')
end = source.index('    @MainActor private func poll() async {', start)
methods = source[start:end]
with tempfile.TemporaryDirectory() as tmp:
    target = Path(tmp) / 'ChatHarness.swift'
    template = (root / 'Tests/Performance/BusinessChatCacheHarness.swift').read_text()
    target.write_text(template.replace('    // INSERT_PRODUCTION_SYNC_METHODS', methods))
    compiler = shutil.which('swiftc')
    if not compiler:
        raise SystemExit('swiftc is required')
    models = sorted((root / 'Sources/Models').glob('*.swift'))
    models = [p for p in models if p.name != 'UmrahPackageDraft.swift']
    executable = Path(tmp) / 'chat-tests'
    subprocess.run([compiler, '-swift-version', '5', *map(str, models), str(target), '-o', str(executable)], check=True)
    subprocess.run([str(executable)], check=True)

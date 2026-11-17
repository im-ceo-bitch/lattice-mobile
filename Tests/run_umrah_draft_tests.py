"""Execute production draft logic with Swift Foundation, without SwiftUI or a simulator."""
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
swift = shutil.which('swift')
if not swift:
    raise SystemExit('Swift is unavailable. Run this check on macOS with Xcode installed.')
model = (root / 'Sources/Models/UmrahPackageDraft.swift').read_text().split('@MainActor')[0]
model = model.replace('import Combine\n', '').replace('import CryptoKit\n', '')
with tempfile.TemporaryDirectory() as directory:
    target = Path(directory) / 'main.swift'
    target.write_text((root / 'Sources/Models/FlightCurationModels.swift').read_text() + '\n' + (root / 'Sources/Models/BusinessManualBookingReceipt.swift').read_text() + '\n' + model + '\n' + (root / 'Sources/Core/BusinessConfiguratorPricePreview.swift').read_text() + '\n' + (root / 'Tests/UmrahPackageDraftTests.swift').read_text())
    subprocess.run([swift, str(target)], check=True)

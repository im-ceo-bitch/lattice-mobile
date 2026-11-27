# Official configurator regression coverage
Base: lattice-mobile-main 4.zip (16a759ed7d064b26a1622d21e05e9e09baf6c617).
Test-only update. No production source, migrations, deployment workflow or credentials changed.
- npm run package:check: 143/143 runtime tests pass (142 original + new adult party change test). TypeScript compilation passed.
- node --test tests/guide-catalog.test.mjs: 4/4 pass.
- New test uses mocked flight supplier and sandbox hotel cache, confirms 2 → 4 → 5 → 6 → 2 occupancy, server quote proof, hotel/flight amounts, guide charged once, final retail line reconciliation, 9% support, 2% payment and no private supplier cost exposure.
- Production API, real supplier availability and live employee profile not verified. No deployment needed for adding regression coverage.

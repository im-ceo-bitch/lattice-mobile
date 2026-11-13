import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig } from '../../scripts/render-config.mjs';
import { PACKAGE_CRON, packageJobsForTime, runPackageSchedule } from '../.runtime-dist/package-schedule.js';

const utc = (h, m) => Date.UTC(2026, 10, 12, h, m);

test('package schedule is staged without registering a duplicate production trigger', () => {
  const config = buildConfig({HOTELS_DB_ID:'11111111-1111-1111-1111-111111111111',BOOKINGS_DB_ID:'22222222-2222-2222-2222-222222222222',FLIGHTS_DB_ID:'33333333-3333-3333-3333-333333333333',BOOKINGS_DB_NAME:'iumrah-core',IUMRAH_ENABLE_SCHEDULED_JOBS:'1'});
  assert.equal(PACKAGE_CRON, '*/5 * * * *');
  assert.deepEqual(config.triggers.crons, ['*/5 * * * *']);
});

test('one UTC day retains all four job frequencies without duplicate runs', () => {
  const counts = {};
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 5) {
      const jobs = packageJobsForTime(utc(h, m));
      assert.equal(jobs.length, new Set(jobs).size);
      for (const job of jobs) counts[job] = (counts[job] ?? 0) + 1;
    }
  }
  assert.deepEqual(counts, {flushBookingEmails: 288, cleanupFlightCache: 1, refreshHotelCatalog: 24, refreshHotelPrices: 1});
  assert.deepEqual(packageJobsForTime(utc(0, 20)), ['flushBookingEmails', 'cleanupFlightCache']);
  assert.deepEqual(packageJobsForTime(utc(3, 0)), ['flushBookingEmails', 'refreshHotelPrices']);
  assert.deepEqual(packageJobsForTime(utc(13, 25)), ['flushBookingEmails', 'refreshHotelCatalog']);
  assert.deepEqual(packageJobsForTime(utc(13, 23)), []);
  assert.deepEqual(packageJobsForTime(NaN), []);
});

test('dispatch uses event time, ignores old triggers and isolates job failures', async () => {
  const calls = [];
  const jobs = {
    flushBookingEmails: async () => { calls.push('email'); throw new Error('email failed'); },
    refreshHotelCatalog: async () => { calls.push('catalog'); },
    refreshHotelPrices: async () => { calls.push('prices'); },
    cleanupFlightCache: async () => { calls.push('cleanup'); },
  };
  await runPackageSchedule({cron: '23 * * * *', scheduledTime: utc(13, 23)}, jobs);
  assert.deepEqual(calls, []);
  await assert.rejects(runPackageSchedule({cron: PACKAGE_CRON, scheduledTime: utc(3, 0)}, jobs), AggregateError);
  assert.deepEqual(calls, ['email', 'prices']);
});

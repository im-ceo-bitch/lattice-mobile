/** A single account-level Cron Trigger dispatches all Package Engine jobs. */
export const PACKAGE_CRON = "*/5 * * * *";

type PackageJob = "flushBookingEmails" | "refreshHotelCatalog" | "refreshHotelPrices" | "cleanupFlightCache";
type PackageJobs = Record<PackageJob, () => Promise<void>>;

export function packageJobsForTime(scheduledTime: number): PackageJob[] {
  // Use the scheduled UTC time, not wall-clock execution time: delivery can be delayed.
  const date = new Date(scheduledTime);
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  if (!Number.isFinite(scheduledTime) || !Number.isFinite(minute) || minute % 5 !== 0) return [];
  const jobs: PackageJob[] = ["flushBookingEmails"];
  if (minute === 25) jobs.push("refreshHotelCatalog");
  if (hour === 3 && minute === 0) jobs.push("refreshHotelPrices");
  if (hour === 0 && minute === 20) jobs.push("cleanupFlightCache");
  return jobs;
}

export async function runPackageSchedule(
  controller: { cron?: string; scheduledTime: number },
  jobs: PackageJobs,
): Promise<void> {
  // Ignore obsolete triggers while Cloudflare propagates the updated configuration.
  if (controller.cron !== PACKAGE_CRON) return;
  const due = packageJobsForTime(controller.scheduledTime);
  // An email failure must not prevent hotel/cache maintenance (or vice versa).
  const results = await Promise.allSettled(due.map(async (job) => jobs[job]()));
  const failures: unknown[] = [];
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error("package-schedule-job-failed", due[index], result.reason);
      failures.push(result.reason);
    }
  });
  if (failures.length) throw new AggregateError(failures, "Package Engine scheduled jobs failed");
}

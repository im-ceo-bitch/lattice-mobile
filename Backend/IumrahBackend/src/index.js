import { sendBookingSMSStatus, retryBookingSMSStatuses } from "../package-engine/src/booking-sms.ts";
// One Cloudflare Worker, with the existing implementations preserved as modules.
import hotels, { HotelImportWorkflow, materializeBookingIdentity, sendStaffPush, retryBookingPushOutbox, registerCreationPush } from '../../HotelsWorker/src/index.js';
import flights from '../../FlightHubWorker/src/index.js';
import packages from '../package-engine/src/index.ts';
import { requestAeroDataBox, aeroDataBoxConfiguration } from '../package-engine/src/flight-detail.ts';
import core from '../core/index.js';
import { verifyBookingQuote } from '../package-engine/src/booking-gateway.ts';
import { sendBookingEmailStatus, retryBookingStatusEmails, ensureBookingMailSchema } from '../package-engine/src/booking-email.ts';
import { bookingRewardsAmounts } from '../package-engine/src/booking-control.ts';
import { syncReferralForBooking } from '../package-engine/src/referral-rewards.ts';
import { dispatchCreationNotifications } from "../core/lib/booking-notifications.js";
import { createBackendRouter } from './router.js';
export { HotelImportWorkflow };
export default createBackendRouter({hotels,flights,packages,core,requestAeroDataBox,aeroDataBoxConfiguration,verifyBookingQuote,sendBookingEmailStatus,retryBookingStatusEmails,materializeBookingIdentity,syncReferralForBooking,bookingRewardsAmounts,sendStaffPush,sendBookingSMSStatus,retryBookingPushOutbox,retryBookingSMSStatuses,dispatchCreationNotifications:(env,id)=>dispatchCreationNotifications(env,{materializeBookingIdentity,ensureBookingMailSchema,sendBookingEmailStatus,sendBookingSMSStatus,registerCreationPush},id)});

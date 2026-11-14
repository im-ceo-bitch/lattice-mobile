// One Cloudflare Worker, with the existing implementations preserved as modules.
import hotels, { HotelImportWorkflow, materializeBookingIdentity } from '../../HotelsWorker/src/index.js';
import flights from '../../FlightHubWorker/src/index.js';
import packages from '../package-engine/src/index.ts';
import { requestAeroDataBox, aeroDataBoxConfiguration } from '../package-engine/src/flight-detail.ts';
import core from '../core/index.js';
import { verifyBookingQuote } from '../package-engine/src/booking-gateway.ts';
import { sendBookingEmailStatus, retryBookingStatusEmails } from '../package-engine/src/booking-email.ts';
import { createBackendRouter } from './router.js';
export { HotelImportWorkflow };
export default createBackendRouter({hotels,flights,packages,core,requestAeroDataBox,aeroDataBoxConfiguration,verifyBookingQuote,sendBookingEmailStatus,retryBookingStatusEmails,materializeBookingIdentity});

// One Cloudflare Worker, with the existing implementations preserved as modules.
import hotels, { HotelImportWorkflow } from '../../HotelsWorker/src/index.js';
import flights from '../../FlightHubWorker/src/index.js';
import { createBackendRouter } from './router.js';
export { HotelImportWorkflow };
export default createBackendRouter({hotels,flights});

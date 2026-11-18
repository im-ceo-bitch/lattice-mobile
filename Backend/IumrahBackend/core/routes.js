import { sharedPackage, packageThread, staffPackageThread, roomDecision, linkPackageBooking } from "./lib/package-lifecycle.js";
import { shareImage } from "./lib/package-share-image.js";
import { saveClientPackage, readClientPackage, reviseClientPackage } from "./lib/client-saved-packages.js";
import { readNativeOffer, acceptNativeOffer, nativeOfferPage } from "./lib/business-offer-native.js";
import { offerPage, readOffer, acceptOffer, listOffers, createOffer, offerDetail, updateOffer, staffAcceptOffer } from "./lib/business-offers.js";
import { sharePage, shareRead, manualBookingInfo, rotateManualShare } from "./lib/business-manual-booking.js";
import * as r0 from "./app/api/account/apple/sign-in/route.js";
import * as r1 from "./app/api/account/dashboard/route.js";
import * as r2 from "./app/api/account/google/sign-in/route.js";
import * as r3 from "./app/api/account/login/route.js";
import * as r4 from "./app/api/account/logout/route.js";
import * as r5 from "./app/api/account/public/[id]/route.js";
import * as r6 from "./app/api/account/public-card/route.js";
import * as r7 from "./app/api/account/recovery/confirm/route.js";
import * as r8 from "./app/api/account/recovery/start/route.js";
import * as r9 from "./app/api/account/register/confirm/route.js";
import * as r10 from "./app/api/account/register/start/route.js";
import * as r11 from "./app/api/account/session/route.js";
import * as r12 from "./app/api/admin/bookings/[id]/documents/[documentId]/route.js";
import * as r13 from "./app/api/admin/bookings/[id]/route.js";
import * as r14 from "./app/api/admin/bookings/route.js";
import * as r15 from "./app/api/admin/chats/[id]/route.js";
import * as r16 from "./app/api/admin/chats/route.js";
import * as r17 from "./app/api/airports/route.js";
import * as r18 from "./app/api/auth/staff/login/route.js";
import * as r19 from "./app/api/auth/staff/logout/route.js";
import * as r20 from "./app/api/auth/staff/session/route.js";
import * as r21 from "./app/api/bookings/[id]/route.js";
import * as r22 from "./app/api/bookings/route.js";
import * as r23 from "./app/api/chat/[id]/route.js";
import * as r24 from "./app/api/flights/data/route.js";
import * as r25 from "./app/api/generate/route.js";
import * as r26 from "./app/api/internal/telegram/retry/route.js";
import * as r27 from "./app/api/reprice/route.js";
import * as r28 from "./app/api/storefront/flight-choices/route.js";
import * as r29 from "./app/api/storefront/flight-recommendations/route.js";
import * as r30 from "./app/api/storefront/flight-resolve/route.js";
import * as r31 from "./app/api/storefront/hotel-detail/route.js";
import * as r32 from "./app/api/storefront/hotel-rooms/route.js";
import * as r33 from "./app/api/storefront/hotels/route.js";
import * as r34 from "./app/api/storefront/package-quote/route.js";
import * as r35 from "./app/api/storefront/packages/[id]/route.js";
import * as r36 from "./app/api/storefront/packages/route.js";
import * as r37 from "./app/api/storefront/packages/snapshot/route.js";
import * as r38 from "./app/api/storefront/primary-hotel/route.js";
import * as r39 from "./app/api/storefront/requote/route.js";
import * as r40 from "./app/api/telegram/consent/attach/route.js";
import * as r41 from "./app/api/telegram/consent/challenge/route.js";
import * as r42 from "./app/api/telegram/consent/verify/route.js";
import * as r43 from "./app/api/telegram/link/route.js";
import * as seoCatalog from "./app/api/seo/catalog/route.js";
import * as seoStatus from "./app/api/seo/status/route.js";
import * as telegramWebhook from "./app/api/telegram/webhook/route.js";
import { startStaffRecovery, finishStaffRecovery } from "./lib/staff-recovery.js";
import {nativeMini,nativeTelegramSetup} from "./lib/telegram-native.js";
export const routes = [
  {pattern:/^\/offer\/saved-image$/,keys:[],handlers:{GET:shareImage}},
  {pattern:/^\/offer\/saved\/([a-f0-9]{64})\/(\d+)$/,keys:["token","revision"],handlers:{GET:sharedPackage}},
  {pattern:/^\/api\/offers\/shared\/([a-f0-9]{64})\/(\d+)$/,keys:["token","revision"],handlers:{GET:sharedPackage}},
  {pattern:/^\/api\/offers\/saved\/([^/]+)\/thread$/,keys:["id"],handlers:{GET:packageThread,POST:packageThread}},
  {pattern:/^\/api\/offers\/saved\/([^/]+)\/booking$/,keys:["id"],handlers:{POST:linkPackageBooking}},
  {pattern:/^\/api\/admin\/offers\/([^/]+)\/thread$/,keys:["id"],handlers:{GET:staffPackageThread,POST:staffPackageThread}},
  {pattern:/^\/api\/admin\/offers\/([^/]+)\/room-request$/,keys:["id"],handlers:{POST:roomDecision}},
  {pattern:/^\/api\/offers\/saved$/,keys:[],handlers:{POST:saveClientPackage}},
  {pattern:/^\/api\/offers\/saved\/([^/]+)$/,keys:["id"],handlers:{GET:readClientPackage,PATCH:reviseClientPackage}},
  {pattern:/^\/api\/bookings\/offers\/([a-f0-9]{64})\/accept$/,keys:["token"],handlers:{POST:acceptNativeOffer}},
  {pattern:/^\/api\/bookings\/offers\/([a-f0-9]{64})$/,keys:["token"],handlers:{GET:readNativeOffer}},
  {pattern:/^\/offer\/([a-f0-9]{64})$/,keys:["token"],handlers:{GET:nativeOfferPage}},
  { pattern: /^\/api\/offers$/, keys: [], handlers: { GET: offerPage, POST: readOffer } },
  { pattern: /^\/api\/offers\/accept$/, keys: [], handlers: { POST: acceptOffer } },
  { pattern: /^\/api\/admin\/offers$/, keys: [], handlers: { GET: listOffers, POST: createOffer } },
  { pattern: /^\/api\/admin\/offers\/([^\/]+)$/, keys: ["id"], handlers: { GET: offerDetail, PATCH: updateOffer } },
  { pattern: /^\/api\/admin\/offers\/([^\/]+)\/accept$/, keys: ["id"], handlers: { POST: staffAcceptOffer } },
  {pattern:/^\/api\/internal\/telegram\/setup$/,keys:[],handlers:{POST:nativeTelegramSetup}},
  {pattern:/^\/telegram\/(?:mini(?:\/.*)?|mini-asset\/[^/]+|status-image\/[^/]+|support-image\/[^/]+)$/,keys:[],handlers:{GET:nativeMini,POST:nativeMini}},
  {pattern:/^\/api\/auth\/staff\/recovery\/start$/,keys:[],handlers:{POST:startStaffRecovery}},
  {pattern:/^\/api\/auth\/staff\/recovery\/confirm$/,keys:[],handlers:{POST:finishStaffRecovery}},
  {pattern:/^\/api\/telegram\/webhook$/,keys:[],handlers:telegramWebhook},
  {pattern:/^\/api\/seo\/catalog$/,keys:[],handlers:seoCatalog},
  {pattern:/^\/api\/seo\/status$/,keys:[],handlers:seoStatus},
  { pattern: /^\/api\/account\/apple\/sign-in$/, keys: [], handlers: r0 },
  { pattern: /^\/api\/account\/dashboard$/, keys: [], handlers: r1 },
  { pattern: /^\/api\/account\/google\/sign-in$/, keys: [], handlers: r2 },
  { pattern: /^\/api\/account\/login$/, keys: [], handlers: r3 },
  { pattern: /^\/api\/account\/logout$/, keys: [], handlers: r4 },
  { pattern: /^\/api\/account\/public\/([^\/]+)$/, keys: ["id"], handlers: r5 },
  { pattern: /^\/api\/account\/public-card$/, keys: [], handlers: r6 },
  { pattern: /^\/api\/account\/recovery\/confirm$/, keys: [], handlers: r7 },
  { pattern: /^\/api\/account\/recovery\/start$/, keys: [], handlers: r8 },
  { pattern: /^\/api\/account\/register\/confirm$/, keys: [], handlers: r9 },
  { pattern: /^\/api\/account\/register\/start$/, keys: [], handlers: r10 },
  { pattern: /^\/api\/account\/session$/, keys: [], handlers: r11 },
  { pattern: /^\/api\/admin\/bookings\/([^\/]+)\/manual$/, keys: ["id"], handlers: { GET: manualBookingInfo } },
  { pattern: /^\/api\/admin\/bookings\/([^\/]+)\/share$/, keys: ["id"], handlers: { POST: rotateManualShare } },
  { pattern: /^\/api\/admin\/bookings\/([^\/]+)\/documents\/([^\/]+)$/, keys: ["id","documentId"], handlers: r12 },
  { pattern: /^\/api\/admin\/bookings\/([^\/]+)$/, keys: ["id"], handlers: r13 },
  { pattern: /^\/api\/admin\/bookings$/, keys: [], handlers: r14 },
  { pattern: /^\/api\/admin\/chats\/([^\/]+)$/, keys: ["id"], handlers: r15 },
  { pattern: /^\/api\/admin\/chats$/, keys: [], handlers: r16 },
  { pattern: /^\/api\/airports$/, keys: [], handlers: r17 },
  { pattern: /^\/api\/auth\/staff\/login$/, keys: [], handlers: r18 },
  { pattern: /^\/api\/auth\/staff\/logout$/, keys: [], handlers: r19 },
  { pattern: /^\/api\/auth\/staff\/session$/, keys: [], handlers: r20 },
  { pattern: /^\/api\/bookings\/share$/, keys: [], handlers: { GET: sharePage, POST: shareRead } },
  { pattern: /^\/api\/bookings\/([^\/]+)$/, keys: ["id"], handlers: r21 },
  { pattern: /^\/api\/bookings$/, keys: [], handlers: r22 },
  { pattern: /^\/api\/chat\/([^\/]+)$/, keys: ["id"], handlers: r23 },
  { pattern: /^\/api\/flights\/data$/, keys: [], handlers: r24 },
  { pattern: /^\/api\/generate$/, keys: [], handlers: r25 },
  { pattern: /^\/api\/internal\/telegram\/retry$/, keys: [], handlers: r26 },
  { pattern: /^\/api\/reprice$/, keys: [], handlers: r27 },
  { pattern: /^\/api\/storefront\/flight-choices$/, keys: [], handlers: r28 },
  { pattern: /^\/api\/storefront\/flight-recommendations$/, keys: [], handlers: r29 },
  { pattern: /^\/api\/storefront\/flight-resolve$/, keys: [], handlers: r30 },
  { pattern: /^\/api\/storefront\/hotel-detail$/, keys: [], handlers: r31 },
  { pattern: /^\/api\/storefront\/hotel-rooms$/, keys: [], handlers: r32 },
  { pattern: /^\/api\/storefront\/hotels$/, keys: [], handlers: r33 },
  { pattern: /^\/api\/storefront\/package-quote$/, keys: [], handlers: r34 },
  { pattern: /^\/api\/storefront\/packages\/([^\/]+)$/, keys: ["id"], handlers: r35 },
  { pattern: /^\/api\/storefront\/packages$/, keys: [], handlers: r36 },
  { pattern: /^\/api\/storefront\/packages\/snapshot$/, keys: [], handlers: r37 },
  { pattern: /^\/api\/storefront\/primary-hotel$/, keys: [], handlers: r38 },
  { pattern: /^\/api\/storefront\/requote$/, keys: [], handlers: r39 },
  { pattern: /^\/api\/telegram\/consent\/attach$/, keys: [], handlers: r40 },
  { pattern: /^\/api\/telegram\/consent\/challenge$/, keys: [], handlers: r41 },
  { pattern: /^\/api\/telegram\/consent\/verify$/, keys: [], handlers: r42 },
  { pattern: /^\/api\/telegram\/link$/, keys: [], handlers: r43 },
].sort((a,b)=>a.keys.length-b.keys.length);

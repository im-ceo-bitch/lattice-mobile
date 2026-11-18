export type ClientTripSummary = {version:string; currency:string; components:Array<{code:string;label:string;amountUsd:number;cancellationPolicy:string}>;servicesSubtotalUsd:number;supportRate:number;supportAmountUsd:number;paymentRate:number;paymentAmountUsd:number;roundingUsd:number;totalUsd:number;perPilgrimUsd:number};
export type InternalTripSummary = {components:Array<{code:string;label:string;supplierCostUsd:number;retailUsd:number;marginUsd:number}>;supplierCostUsd:number;componentMarginUsd:number;supportAmountUsd:number;paymentAmountUsd:number;roundingUsd:number;estimatedMarginUsd:number};
export type TripSummaryReport = {client:ClientTripSummary;internal:InternalTripSummary};
export function tripSummaryForSnapshot(snapshot:unknown,addOns?:Record<string,number>):TripSummaryReport|null;
export function tripSummaryForManual(cost:unknown,totalUsd:number,travelers:number):TripSummaryReport|null;
export function adultRoomPolicy(adults:number,rooms:number):{minimumRooms:number;requiresAdultException:boolean};

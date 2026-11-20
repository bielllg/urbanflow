import type { FeatureCollection } from 'geojson';

export type Source = {id:string; name:string; url:string; status:'available'|'unavailable'; license?:string; coverage?:string; observedAt?:string; importedAt?:string; detail?:string};
export type Accident = {id:string; date:string; hour:number|null; type:string; region:string; lat:number|null; lng:number|null; fatal:boolean|null; neighborhood?:string;neighborhoodId?:string};
export type Traffic = {id:string; date:string; hour:number|null; region:string; road:string; speed?:number; volume?:number; lat?:number; lng?:number; distanceMeters?:number; durationSeconds?:number; samples?:number};
export type TransitRoute = {id:string; name:string; shortName:string; color?:string; trips?:number; shape?:number[][]; stops?:string[]; stopCount?:number; hours?:number[]; calendar?:Record<string,number[]>};
export type Stop = {id:string; name:string; lat:number; lng:number};
export type Transit = {routes:TransitRoute[]; stops:Stop[]; start?:string; end?:string; version?:string; scheduleDate?:string; scheduleStart?:string; scheduleEnd?:string};
export type Count = {label:string; value:number|null};
export type Operations = {month:string;records:number;passengers:number;byLine:Count[];byDay:Count[];resource:string};
export type Region = {name:string; accidents:number; population:number|null; rate:number|null};
export type Period = {start:string; end:string};
export type DashboardData = {
  period:Period; coverage:Period|null; trafficCoverage:Period|null; sources:Source[];
  totals:{accidents:number; previousAccidents:number|null; trafficCount:number; averageSpeed:number|null; volume:number|null; routes:number; stops:number; plannedTrips:number|null};
  accidentHours:Count[]; accidentMonths:Count[]; accidentTypes:Count[]; accidentWeekdays:Count[];
  trafficHours:Count[]; trafficRoads:Count[]; trafficWeekdays:Count[]; trafficRegions:string[];
  trafficVolumeMonths:Count[]; trafficSpeedMonths:Count[];
  regions:Region[]; regionOptions?:string[]; accidents:Accident[]; routes:TransitRoute[];
  transitValidity:Period|null; unmappedAccidents:number; comparison?:{period:Period; accidents:number; trafficCount:number};
  operations:Operations|null;
  plannedPeriod:Period|null;
};
export type MapData = {collection:FeatureCollection; observedAt:string|null; fresh:boolean; status:'current'|'stale'|'unavailable'};

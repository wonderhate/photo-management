import type {MapResult} from './photo-map.ts';

/** Scope totals are independent of the viewport; an empty view is not an empty library. */
export function locationGuidance(result:Pick<MapResult,'total'|'located'|'in_view'>|null,filtered:boolean){
  if(!result)return null;
  if(!result.total)return filtered?'filtered':'import';
  if(!result.located)return 'coordinates';
  if(!result.in_view)return 'viewport';
  return null;
}

export type LocationFields={latitude:string;longitude:string;country:string;city:string;label:string;accuracy_m:string};
export type LocationFieldIssue='latitude'|'longitude'|'pair'|'accuracy'|'accuracyCoordinates'|'empty';
/** User-facing validation only. manualLocation remains the storage boundary. */
export function locationFieldIssue(value:LocationFields):LocationFieldIssue|null{
  const lat=value.latitude.trim(),lon=value.longitude.trim(),accuracy=value.accuracy_m.trim();
  if(lat&&(!Number.isFinite(Number(lat))||Number(lat)<-90||Number(lat)>90))return 'latitude';
  if(lon&&(!Number.isFinite(Number(lon))||Number(lon)<-180||Number(lon)>180))return 'longitude';
  if(Boolean(lat)!==Boolean(lon))return 'pair';
  if(accuracy&&(!Number.isFinite(Number(accuracy))||Number(accuracy)<0||Number(accuracy)>20040000))return 'accuracy';
  if(accuracy&&!lat)return 'accuracyCoordinates';
  if(!lat&&!value.country.trim()&&!value.city.trim()&&!value.label.trim())return 'empty';
  return null;
}

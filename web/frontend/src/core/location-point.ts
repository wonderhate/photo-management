export type LocationPoint={latitude:number;longitude:number};

/** An empty field is not zero; keep unlocated photos unselected until a choice. */
export function locationPointFromFields(latitude:string,longitude:string):LocationPoint|null{
  if(!latitude.trim()||!longitude.trim())return null;
  const lat=Number(latitude),lon=Number(longitude);
  return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?{latitude:lat,longitude:lon}:null;
}
/** Leaflet can return a longitude from an adjacent wrapped world. */
export function pickedLocationPoint(latitude:number,longitude:number):LocationPoint|null{
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90)return null;
  const round=(value:number)=>Number(value.toFixed(6));
  return {latitude:round(latitude),longitude:round(((longitude+180)%360+360)%360-180)};
}

export async function api<T>(path:string, method='GET', body?:unknown):Promise<T> {
  const response = await fetch('/api'+path, {method, headers:body===undefined?undefined:{'Content-Type':'application/json'}, body:body===undefined?undefined:JSON.stringify(body)});
  if (!response.ok) {
    const error = await response.json().catch(()=>({detail:'请求失败'})) as {detail:unknown};
    throw new Error(typeof error.detail==='string'?error.detail:JSON.stringify(error.detail));
  }
  return response.json() as Promise<T>;
}
export function message(error:unknown):string {return error instanceof Error?error.message:String(error)}
export function query(values:Record<string,string|number|undefined>):string {return new URLSearchParams(Object.entries(values).filter(([,v])=>v!==undefined&&v!=='').map(([k,v])=>[k,String(v)])).toString()}

import type { MapPhoto, TimelineData, FacePerson, BatchEditPayload } from './types';

export async function getMapPhotos(): Promise<MapPhoto[]> {
  return api<MapPhoto[]>('/map/photos');
}

export async function getTimeline(): Promise<TimelineData> {
  return api<TimelineData>('/timeline');
}

export async function getTimelineYear(year: string): Promise<{photos: any[]; total: number}> {
  return api(`/timeline/${year}`);
}

export async function getTimelineMonth(year: string, month: string): Promise<{photos: any[]; total: number}> {
  return api(`/timeline/${year}/${month}`);
}

export async function getTimelineDay(year: string, month: string, day: string): Promise<{photos: any[]; total: number}> {
  return api(`/timeline/${year}/${month}/${day}`);
}

export async function getTimelineHeatmap(year: string): Promise<Record<string, number>> {
  return api(`/timeline/heatmap/${year}`);
}

export async function getComparePhotos(ids: string[]): Promise<{photos: any[]}> {
  return api(`/compare?ids=${ids.join(',')}`);
}

export async function batchEditPhotos(payload: BatchEditPayload): Promise<{updated: number}> {
  return api('/photos/batch-edit', 'POST', payload);
}

export async function detectFaces(photoId: string): Promise<{faces: number; face_data: any}> {
  return api(`/photos/${photoId}/detect-faces`, 'POST');
}

export async function getFacePersons(): Promise<FacePerson[]> {
  return api('/faces/persons');
}

export async function createFacePerson(name: string): Promise<FacePerson> {
  return api('/faces/persons', 'POST', {name});
}

export async function renameFacePerson(id: string, name: string): Promise<FacePerson> {
  return api(`/faces/persons/${id}`, 'PATCH', {name});
}

export async function deleteFacePerson(id: string): Promise<void> {
  return api(`/faces/persons/${id}`, 'DELETE');
}

export async function getFaceStatus(): Promise<{available: boolean}> {
  return api('/faces/status');
}

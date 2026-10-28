import type {LocalAlbum,LocalPhoto} from './storage';
import {compilePhotoQuery} from '../core/photo-query.ts';
import {photoOrder} from '../core/photo-order.ts';

/** Evaluate against the supplied snapshot, including during a public export. */
export function albumMemberIds(album:LocalAlbum,photos:LocalPhoto[]):string[]{
  return album.type==='rule'?photos.filter(compilePhotoQuery(album.query)).sort(photoOrder('date_taken','desc')).map(p=>p.id):album.photo_ids;
}

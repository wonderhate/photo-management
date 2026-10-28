import {validateFacetPreferences} from './photo-facets';
import {IS_BROWSER} from '../runtime';
import {api} from '../api';
import {validateGalleryPreferences,validateDocumentPreferences,validateToolPreferenceValues,validateToolPreferences} from './preferences';
import type {PreferenceStore} from './preferences';
import {validateAlbumListPreferences} from './album-list';

export async function createPreferenceStore():Promise<PreferenceStore>{
  if(IS_BROWSER){
    const {current,commit,directory,librarySession,isBrowsing,requireLibrary}=await import('../browser/storage'),snapshot=current(),libraryId=snapshot.id,generation=librarySession();
    if(isBrowsing()){
      // Preview settings stay with this empty read model and never reach disk.
      const active=()=>isBrowsing()&&current().id===libraryId&&librarySession()===generation;
      return {libraryId,facets:validateFacetPreferences(snapshot.facet_preferences||{}),gallery:validateGalleryPreferences(snapshot.view_preferences||{}),tools:validateToolPreferenceValues(snapshot.tool_preferences||{}),albums:validateAlbumListPreferences(snapshot.album_preferences||{}),
        async saveFacets(patch){validateFacetPreferences(patch);if(active())snapshot.facet_preferences={...snapshot.facet_preferences,...patch};},
        async saveAlbums(patch){validateAlbumListPreferences(patch);if(active())snapshot.album_preferences={...snapshot.album_preferences,...patch};},
        async saveTool(kind,patch){validateToolPreferences(kind,patch);if(active())snapshot.tool_preferences={...snapshot.tool_preferences,[kind]:{...snapshot.tool_preferences?.[kind],...patch}};},
        async saveGallery(patch){validateGalleryPreferences(patch);if(active())snapshot.view_preferences={...snapshot.view_preferences,...patch};},
        async document(){return {};},async saveDocument(){requireLibrary();}};
    }
    const base=directory();
    const same=(id:string)=>{if(id!==libraryId||librarySession()!==generation||directory()!==base)throw new Error('Library changed. Reopen the current library.');};
    return {libraryId,facets:validateFacetPreferences(snapshot.facet_preferences||{}),
      async saveFacets(patch){validateFacetPreferences(patch);same(current().id);await commit(s=>{same(s.id);s.facet_preferences={...s.facet_preferences,...patch};});},gallery:validateGalleryPreferences(snapshot.view_preferences||{}),tools:validateToolPreferenceValues(snapshot.tool_preferences||{}),albums:validateAlbumListPreferences(snapshot.album_preferences||{}),
      async saveAlbums(patch){validateAlbumListPreferences(patch);same(current().id);await commit(s=>{same(s.id);s.album_preferences={...s.album_preferences,...patch};});},
      async saveTool(kind,patch){validateToolPreferences(kind,patch);same(current().id);await commit(s=>{same(s.id);s.tool_preferences={...s.tool_preferences,[kind]:{...s.tool_preferences?.[kind],...patch}};});},
      async saveGallery(patch){validateGalleryPreferences(patch);same(current().id);await commit(s=>{same(s.id);s.view_preferences={...s.view_preferences,...patch};});},
      async document(id){same(current().id);const record=current().edits?.find(e=>e.id===id);if(!record)throw new Error('Record not found.');return validateDocumentPreferences(record.view_preferences||{});},
      async saveDocument(id,patch){validateDocumentPreferences(patch);same(current().id);await commit(s=>{same(s.id);const record=s.edits?.find(e=>e.id===id);if(!record)throw new Error('Record not found.');record.view_preferences=patch;});}};
  }
  const state=await api<{library_id:string;preferences:unknown;tool_preferences?:unknown;album_preferences?:unknown;facet_preferences?:unknown}>('/workspace'),libraryId=state.library_id;
  return {libraryId,facets:validateFacetPreferences(state.facet_preferences||{}),
    async saveFacets(patch){validateFacetPreferences(patch);await api('/workspace/facets','PATCH',{library_id:libraryId,values:patch});},gallery:validateGalleryPreferences(state.preferences),tools:validateToolPreferenceValues(state.tool_preferences||{}),albums:validateAlbumListPreferences(state.album_preferences||{}),
    async saveAlbums(patch){validateAlbumListPreferences(patch);await api('/workspace/albums','PATCH',{library_id:libraryId,values:patch});},
    async saveTool(kind,patch){validateToolPreferences(kind,patch);await api('/workspace/tools/'+kind,'PATCH',{library_id:libraryId,values:patch});},
    async saveGallery(patch){validateGalleryPreferences(patch);await api('/workspace/preferences','PATCH',{library_id:libraryId,values:patch});},
    async document(id){return validateDocumentPreferences(await api('/workspace/documents/'+encodeURIComponent(id)+'/view?library_id='+encodeURIComponent(libraryId)));},
    async saveDocument(id,patch){validateDocumentPreferences(patch);await api('/workspace/documents/'+encodeURIComponent(id)+'/view','PATCH',{library_id:libraryId,values:patch});}};
}

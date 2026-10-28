import {createPreferenceStore} from './preference-store';
export async function createFacetPreferenceStore(){const store=await createPreferenceStore();return {libraryId:store.libraryId,value:store.facets,save:store.saveFacets};}

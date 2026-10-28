import type {EditRecipe,EditRecipeV5} from './editing.ts';
import {withLayerStack,recipeLayers} from './layer-recipe.ts';
import type {Size} from './composition-geometry.ts';
import {validateLutSelection} from './lut-contract.ts';
import type {LutSelection} from './lut-contract.ts';
export function withLut(recipe:EditRecipe,source:Size,lut?:LutSelection):EditRecipeV5{
  if(lut!==undefined)validateLutSelection(lut);
  const layered=withLayerStack(recipe,source,recipeLayers(recipe));
  const {lut:_,...base}=layered as EditRecipeV5;
  return {...base,version:5,...(lut?{lut}:{})};
}

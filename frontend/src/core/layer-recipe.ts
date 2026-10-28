import type {EditRecipe,EditRecipeV4,EditRecipeV5} from './editing.ts';
import {composeRecipe} from './composition-recipe.ts';
import type {Size} from './composition-geometry.ts';
import {validateLayerStack} from './layer-stack.ts';
import type {LayerDocument} from './layer-stack.ts';
export function recipeLayers(recipe:EditRecipe):LayerDocument{return (recipe.version===4||recipe.version===5)?recipe.layer_stack:recipe.version===3?recipe.text_layers:{version:1,layers:[]};}
export function withLayerStack(recipe:EditRecipe,source:Size,layer_stack:LayerDocument):EditRecipeV4|EditRecipeV5{if(recipe.version===5){validateLayerStack(layer_stack);return {...recipe,layer_stack};}validateLayerStack(layer_stack);const composed=composeRecipe(recipe,source),base=composed.version===3?(({text_layers:_,...rest})=>rest)(composed):composed;return {...base,version:4,layer_stack};}
// Once a format has been saved, undo may remove its layers but must not send
// an older writer contract. Preserve the entire undo/redo sequence's contents.
export function keepLayerFormat(recipe:EditRecipe,source:Size,minimum:EditRecipe['version']):EditRecipe{
  if(recipe.version>=minimum)return recipe;
  if(minimum===5){const base=withLayerStack(recipe,source,recipeLayers(recipe));return {...base,version:5};}
  if(minimum===4)return withLayerStack(recipe,source,recipeLayers(recipe));
  if(minimum===3)return {...composeRecipe(recipe,source),version:3,text_layers:{version:1,layers:[]}};
  return recipe;
}

// Display-only provenance. Never used as a filesystem destination.
export type LutContext={groups:string[];comments:string[]};
export function validateLutContext(value:unknown):asserts value is LutContext{
 const v=value as LutContext;
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==2||!Array.isArray(v.groups)||v.groups.length>9||v.groups.some(s=>typeof s!=='string'||!s.trim()||s==='.'||s==='..'||s.length>255||/[\\/:\x00-\x1f\x7f\uD800-\uDFFF]/u.test(s))||v.groups.join('/').length>2048||!Array.isArray(v.comments)||v.comments.length>32||v.comments.some(s=>typeof s!=='string'||s.length>512||/[\x00-\x1f\x7f]/.test(s)))throw new Error('Invalid LUT source context.');
}
export function lutInputComments(text:string){return text.split(/\r\n|\r|\n/).filter(l=>/^\s*#/.test(l)&&/\binput\b/i.test(l)).slice(0,32).map(l=>l.replace(/^\s*#\s*/,'').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,512).replace(/[\uD800-\uDBFF]$/,''));}
export function lutImportGroups(file:Pick<File,'name'|'webkitRelativePath'>){
 const path=file.webkitRelativePath||'',parts=path.split('/'),groups=path?parts.slice(0,-1):[];
 if(path&&parts.at(-1)!==file.name)throw new Error('Invalid LUT source context.');validateLutContext({groups,comments:[]});return groups;
}

export function lutRootLabel(name:string){return name.split(/[\\/:]+/).filter(Boolean).join(' · ').slice(0,255).replace(/[\uD800-\uDBFF]$/,'')||'LUT';}

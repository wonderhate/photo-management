// The host browser decides whether its local decoder supports these containers.
// Do not send a source photo to a conversion service as a fallback.
export const restrictedImageFormat=(file:Blob)=>/image\/(heic|heif|tiff)/i.test(file.type)||file instanceof File&&/\.(heic|heif|tiff?)$/i.test(file.name);
export const FORMAT_DECODE_ERROR='This browser cannot decode this HEIC/HEIF/TIFF file. Use the Windows desktop app or import a JPEG/PNG copy. The original was not uploaded or changed.';
export async function browserImageBitmap(file:Blob):Promise<ImageBitmap>{
  try{return await createImageBitmap(file);}
  catch(error){if(restrictedImageFormat(file))throw new Error(FORMAT_DECODE_ERROR);throw error;}
}

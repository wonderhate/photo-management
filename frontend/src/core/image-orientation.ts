/** Canvas transforms for EXIF's eight pixel orientations (after decoder rotation). */
export function imageOrientation(width:number,height:number,orientation=1){
  if(!Number.isInteger(orientation)||orientation<1||orientation>8)throw new Error('Invalid image orientation.');
  const transforms:Record<number,[number,number,number,number,number,number]>={
    1:[1,0,0,1,0,0],2:[-1,0,0,1,width,0],3:[-1,0,0,-1,width,height],4:[1,0,0,-1,0,height],
    5:[0,1,1,0,0,0],6:[0,1,-1,0,height,0],7:[0,-1,-1,0,height,width],8:[0,-1,1,0,0,width],
  };
  return {width:orientation>=5?height:width,height:orientation>=5?width:height,transform:transforms[orientation]};
}

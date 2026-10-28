import {forwardRef} from 'react';
import type {HTMLAttributes} from 'react';

// react-window disables its inner hit targets during scroll debounce. A focus
// scroll between two presses can otherwise consume the second click entirely.
const GalleryContent=forwardRef<HTMLDivElement,HTMLAttributes<HTMLDivElement>>(function GalleryContent({style,...props},ref){
  return <div {...props} ref={ref} style={{...style,pointerEvents:'auto'}}/>;
});
export default GalleryContent;

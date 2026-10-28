import {useState} from 'react';
import type {AnchorHTMLAttributes,MouseEvent} from 'react';
import {isLocalFileURL} from '../core/local-file-reference';
import {message} from '../api';

export default function DownloadLink({href='',download=true,onClick,...props}:AnchorHTMLAttributes<HTMLAnchorElement>){
  const [error,setError]=useState('');
  async function click(event:MouseEvent<HTMLAnchorElement>){
    onClick?.(event);if(event.defaultPrevented||!isLocalFileURL(href)||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();setError('');
    try{await (await import('../browser/local-file-service')).downloadFile(href,typeof download==='string'?download:'');}catch(reason){setError(message(reason));}
  }
  return <><a {...props} href={href} download={download} onClick={event=>void click(event)}/>{error&&<span className="error-box" role="alert">{error}</span>}</>;
}

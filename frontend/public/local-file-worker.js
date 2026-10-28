async function localFile(event){
  const unavailable=status=>new Response('Local file unavailable.',{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  const client=event.clientId&&await self.clients.get(event.clientId);if(!client)return unavailable(404);
  const channel=new MessageChannel();
  const result=await new Promise(resolve=>{
    const finish=value=>{clearTimeout(timer);channel.port1.close();resolve(value);};
    const timer=setTimeout(()=>finish({status:409}),15000);
    channel.port1.onmessage=message=>finish(message.data);
    try{client.postMessage({type:'photocollection-local-file',url:event.request.url},[channel.port2]);}catch{finish({status:409});}
  });
  if(!(result?.file instanceof Blob))return unavailable(result?.status===404?404:409);
  const file=result.file,headers=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Type':file.type||'application/octet-stream','Accept-Ranges':'bytes'});
  const range=event.request.headers.get('Range');let body=file,status=200;
  if(range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);let start=Number(match?.[1]||0),end=match?.[2]?Number(match[2]):file.size-1;
    if(match&&!match[1]){start=Math.max(0,file.size-end);end=file.size-1;}
    if(!match||!match[1]&&!match[2]||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=file.size||start>end){headers.set('Content-Range','bytes */'+file.size);return new Response(null,{status:416,headers});}
    end=Math.min(end,file.size-1);body=file.slice(start,end+1);status=206;headers.set('Content-Range',`bytes ${start}-${end}/${file.size}`);
  }
  headers.set('Content-Length',String(body.size));return new Response(body,{status,headers});
}

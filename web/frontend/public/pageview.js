// First-party pageview beacon: production domain only, one image request per page load.
// No cookies, no identifiers; the host writes an ordinary access-log line (path + time).
(function(){
  if(!/(^|\.)photomanagement\.online$/.test(location.hostname))return;
  if(location.search.indexOf('local=1')>=0||location.hash.indexOf('#/')===0)return;
  var path=(location.pathname.replace(/[^A-Za-z0-9/._-]/g,'').slice(0,64))||'/';
  var img=new Image();
  img.referrerPolicy='no-referrer';
  img.src='https://ai.photomanagement.online/hit?p='+encodeURIComponent(path)+'&t='+Date.now();
})();

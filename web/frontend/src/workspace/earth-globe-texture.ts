/** A local texture on an orthographic globe. No external renderer or map SDK. */
export function createEarthGlobe(image:HTMLImageElement){
  const canvas=document.createElement('canvas');canvas.width=720;canvas.height=720;
  const gl=canvas.getContext('webgl',{alpha:true,antialias:true,preserveDrawingBuffer:true});if(!gl)return null;
  const compile=(type:number,source:string)=>{const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);throw Error('Globe shader unavailable');}return shader;};
  let vertex:WebGLShader|undefined,fragment:WebGLShader|undefined;
  try{
    vertex=compile(gl.VERTEX_SHADER,'attribute vec2 p; varying vec2 v; void main(){v=p;gl_Position=vec4(p,0.,1.);}');
    fragment=compile(gl.FRAGMENT_SHADER,`precision mediump float; varying vec2 v; uniform sampler2D earth; uniform vec2 pose;
      void main(){vec2 p=v/.861111;float q=dot(p,p);if(q>1.){gl_FragColor=vec4(0.);return;}float z=sqrt(1.-q);float lat=asin(clamp(p.y*cos(pose.y)+z*sin(pose.y),-1.,1.));float lon=atan(p.x,z*cos(pose.y)-p.y*sin(pose.y))+pose.x;vec2 uv=vec2(fract(lon/6.2831853+.5),.5-lat/3.14159265);vec3 color=texture2D(earth,uv).rgb;float light=.55+.45*max(0.,dot(vec3(p,z),normalize(vec3(-.4,.5,1.))));gl_FragColor=vec4(color*light,1.);}`);
    const program=gl.createProgram()!;gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Globe program unavailable');gl.useProgram(program);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const p=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);gl.uniform1i(gl.getUniformLocation(program,'earth'),0);const pose=gl.getUniformLocation(program,'pose');
    return {draw(context:CanvasRenderingContext2D,lon:number,lat:number){if(gl.isContextLost())return;gl.uniform2f(pose,lon*Math.PI/180,lat*Math.PI/180);gl.drawArrays(gl.TRIANGLES,0,6);context.drawImage(canvas,0,0);},dispose(){gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vertex!);gl.deleteShader(fragment!);gl.getExtension('WEBGL_lose_context')?.loseContext();}};
  }catch{if(vertex)gl.deleteShader(vertex);if(fragment)gl.deleteShader(fragment);gl.getExtension('WEBGL_lose_context')?.loseContext();return null;}
}

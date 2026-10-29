import type {Directory} from './storage';

type Node={name:string;parent:Folder|null;handle:FileSystemHandle};
type Folder=Node&{kind:'directory';children:Map<string,Entry>};
type Document=Node&{kind:'file';blob:Blob;modified:number;writing:boolean};
type Entry=Folder|Document;
type Chunk=FileSystemWriteChunkType;
const roots=new WeakSet<FileSystemDirectoryHandle>();
const nodes=new WeakMap<FileSystemHandle,Entry>();
const problem=(message:string,name:string)=>new DOMException(message,name);
function safeName(name:string){if(!name||name==='.'||name==='..'||/[\/\\\x00-\x1f]/.test(name))throw new TypeError('Invalid temporary file name.');}

/** A private, window-memory filesystem. It never calls a picker, OPFS or IDB. */
export function createMemoryDirectory(name='Lumina temporary session',maxBytes=1024*1024*1024){
  safeName(name);if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new TypeError('Invalid temporary storage limit.');
  let closed=false,bytes=0;
  const check=()=>{if(closed)throw problem('The temporary session has ended.','AbortError');};
  function attached(node:Entry){check();let item:Entry=node;while(item.parent){if(item.parent.children.get(item.name)!==item)throw problem('Temporary file no longer exists.','NotFoundError');item=item.parent;}}
  function clear(node:Entry){if(node.kind==='directory'){for(const child of node.children.values())clear(child);node.children.clear();}else{bytes-=node.blob.size;node.blob=new Blob();}}
  function common(node:Entry){return {kind:node.kind,name:node.name,async isSameEntry(other:FileSystemHandle){check();return node.handle===other;},async queryPermission(){check();return 'granted' as PermissionState;},async requestPermission(){check();return 'granted' as PermissionState;}};}
  function fileNode(name:string,parent:Folder):Document{
    const node={kind:'file' as const,name,parent,blob:new Blob(),modified:Date.now(),writing:false,handle:null as unknown as FileSystemFileHandle};
    node.handle={...common(node),async getFile(){attached(node);return new File([node.blob],node.name,{type:node.blob.type,lastModified:node.modified});},async createWritable(options?:FileSystemCreateWritableOptions){
      attached(node);if(node.writing)throw problem('A temporary file already has a writer.','NoModificationAllowedError');node.writing=true;
      let data=options?.keepExistingData?node.blob:new Blob(),position=0,ended=false;
      const live=()=>{attached(node);if(ended)throw problem('The temporary writer is closed.','InvalidStateError');};
      const offset=(value:number)=>{if(!Number.isSafeInteger(value)||value<0||value>maxBytes)throw new TypeError('Invalid temporary file position.');};
      async function write(chunk:Chunk){
        live();
        if(typeof chunk==='object'&&chunk!==null&&'type' in chunk&&!(chunk instanceof Blob)&&!ArrayBuffer.isView(chunk)&&!(chunk instanceof ArrayBuffer)){
          const command=chunk as WriteParams;
          if(command.type==='seek'){seek(command.position!);return;}
          if(command.type==='truncate'){truncate(command.size!);return;}
          if(command.type!=='write'||command.data===undefined||command.data===null)throw new TypeError('Invalid temporary file write.');
          if(command.position!==undefined&&command.position!==null){offset(command.position);position=command.position;}
          chunk=command.data;
        }
        const value=chunk instanceof Blob?chunk:new Blob([chunk as BlobPart]);
        if(position+value.size>maxBytes)throw problem('Temporary session storage is full.','QuotaExceededError');
        const padding=position>data.size?new Uint8Array(position-data.size):new Uint8Array();
        data=new Blob([data.slice(0,position),padding,value,data.slice(position+value.size)],{type:data.type||value.type});position+=value.size;
      }
      function seek(value:number){live();offset(value);position=value;}
      function truncate(value:number){live();offset(value);data=value<=data.size?data.slice(0,value,data.type):new Blob([data,new Uint8Array(value-data.size)],{type:data.type});if(position>value)position=value;}
      function finish(){try{live();if(bytes-node.blob.size+data.size>maxBytes)throw problem('Temporary session storage is full.','QuotaExceededError');bytes+=data.size-node.blob.size;node.blob=data;node.modified=Date.now();}finally{ended=true;node.writing=false;data=new Blob();}}
      function abort(){ended=true;node.writing=false;data=new Blob();}
      const stream=new WritableStream<Chunk>({write,close:finish,abort});
      // Existing browser services use the filesystem stream's direct methods.
      return Object.assign(stream,{write,seek:async(value:number)=>seek(value),truncate:async(value:number)=>truncate(value)}) as FileSystemWritableFileStream;
    }} as FileSystemFileHandle;
    nodes.set(node.handle,node);return node;
  }
  function folderNode(name:string,parent:Folder|null):Folder{
    const node:Folder={kind:'directory',name,parent,children:new Map(),handle:null as unknown as Directory};
    const handle={...common(node),async getDirectoryHandle(name:string,options?:FileSystemGetDirectoryOptions){
      attached(node);safeName(name);let found=node.children.get(name);if(found&&found.kind!=='directory')throw problem('Entry is a file.','TypeMismatchError');
      if(!found){if(!options?.create)throw problem('Temporary directory not found.','NotFoundError');found=folderNode(name,node);node.children.set(name,found);}return found.handle as FileSystemDirectoryHandle;
    },async getFileHandle(name:string,options?:FileSystemGetFileOptions){
      attached(node);safeName(name);let found=node.children.get(name);if(found&&found.kind!=='file')throw problem('Entry is a directory.','TypeMismatchError');
      if(!found){if(!options?.create)throw problem('Temporary file not found.','NotFoundError');found=fileNode(name,node);node.children.set(name,found);}return found.handle as FileSystemFileHandle;
    },async removeEntry(name:string,options?:FileSystemRemoveOptions){
      attached(node);safeName(name);const found=node.children.get(name);if(!found)throw problem('Temporary entry not found.','NotFoundError');if(found.kind==='directory'&&found.children.size&&!options?.recursive)throw problem('Temporary directory is not empty.','InvalidModificationError');clear(found);node.children.delete(name);
    },async resolve(other:FileSystemHandle){
      attached(node);let target=nodes.get(other);if(!target)return null;const path:string[]=[];while(target!==node){if(!target.parent||target.parent.children.get(target.name)!==target)return null;path.unshift(target.name);target=target.parent;}return path;
    },async *values(){attached(node);for(const child of [...node.children.values()]){attached(node);yield child.handle;}},async *entries(){attached(node);for(const child of [...node.children.values()]){attached(node);yield [child.name,child.handle] as [string,FileSystemHandle];}},async *keys(){attached(node);for(const child of [...node.children.values()]){attached(node);yield child.name;}}};
    node.handle=Object.assign(handle,{[Symbol.asyncIterator]:handle.entries}) as Directory;nodes.set(node.handle,node);return node;
  }
  const root=folderNode(name,null),directory=root.handle as Directory;roots.add(directory);
  return {directory,dispose(){if(closed)return;clear(root);closed=true;roots.delete(directory);}};
}
export function isMemoryDirectory(handle:FileSystemDirectoryHandle){return roots.has(handle);}

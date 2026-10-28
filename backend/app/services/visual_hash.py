"""Versioned local appearance fingerprints, independent of semantic scores."""
import numpy as np
import math
import re
from PIL import Image

ENGINE='pc-phash-dct32-v1'
_DCT=np.cos(np.pi*(np.arange(32)[None,:]+.5)*np.arange(8)[:,None]/32)
_DCT[0]*=1/np.sqrt(2)


def valid_record(record):
    if not isinstance(record,dict) or type(record.get('version')) is not int or record.get('version')!=1 or record.get('engine')!=ENGINE:return False
    for key,length in [('phash',16),('source_hash',64),('preview_hash',64)]:
        if not isinstance(record.get(key),str) or not re.fullmatch('[a-f0-9]{'+str(length)+'}',record[key]):return False
    for key in ('source_signature','preview_signature'):
        if not isinstance(record.get(key),str) or not re.fullmatch(r'\d+:\d+:\d+',record[key]):return False
    colors=record.get('palette');contrast=record.get('contrast')
    return (isinstance(colors,list) and 1<=len(colors)<=6 and all(isinstance(c,str) and re.fullmatch(r'#[a-f0-9]{6}',c) for c in colors)
            and type(contrast) in (int,float) and math.isfinite(contrast) and 0<=contrast<=255)


def fingerprint(image):
    with image.convert('RGB') as rgb:
        with rgb.resize((32,32),Image.Resampling.LANCZOS) as sample:
            pixels=np.asarray(sample,dtype=np.float64)
            gray=pixels @ np.array([.299,.587,.114])
            low=(_DCT @ gray @ _DCT.T).flatten()
            # Round negligible floating point residue for flat-color inputs.
            low=np.round(low,6);threshold=float(np.median(low[1:]))
            bits=low>threshold;bits[0]=False
            value=sum(int(bit)<<index for index,bit in enumerate(bits))
            quantized=np.minimum((pixels//32).astype(np.int16),7)
            keys=quantized[:,:,0]*64+quantized[:,:,1]*8+quantized[:,:,2]
            colors,counts=np.unique(keys,return_counts=True)
            order=sorted(zip(colors.tolist(),counts.tolist()),key=lambda item:(-item[1],item[0]))[:6]
            palette=['#'+''.join(f'{component:02x}' for component in (key//64*32+16,key//8%8*32+16,key%8*32+16)) for key,_ in order]
            return dict(version=1,engine=ENGINE,phash=f'{value:016x}',contrast=float(np.std(gray)),palette=palette)


class HashIndex:
    """BK tree searches exact Hamming-radius candidates; ties use stable IDs."""
    def __init__(self,items):
        self.root=None
        for identifier,value in sorted(items):
            value=int(value,16)
            if self.root is None:self.root=[value,[identifier],{}];continue
            node=self.root
            while True:
                distance=(node[0]^value).bit_count()
                if not distance:node[1].append(identifier);break
                if distance not in node[2]:node[2][distance]=[value,[identifier],{}];break
                node=node[2][distance]

    def candidates(self,value,maximum_distance=6):
        if type(maximum_distance) is not int or not 0<=maximum_distance<=16:raise ValueError('Invalid appearance distance.')
        value=int(value,16);pending=[self.root] if self.root else [];result=[]
        while pending:
            node=pending.pop();distance=(node[0]^value).bit_count()
            if distance<=maximum_distance:result.extend((distance,identifier) for identifier in node[1])
            pending.extend(child for edge,child in node[2].items() if distance-maximum_distance<=edge<=distance+maximum_distance)
        return sorted(result)

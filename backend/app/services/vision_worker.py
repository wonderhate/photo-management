"""Spawned CPU-only inference. Parent termination physically cancels inference."""
import json
import os
from pathlib import Path

def infer(model_path,kind,input_path,output_path,instances):
    folder=Path(output_path)
    try:
        # No ambient Hub credentials or model downloads are allowed in this child.
        os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',DO_NOT_TRACK='1')
        import torch
        import numpy as np
        from PIL import Image,ImageFilter
        torch.set_num_threads(min(4,os.cpu_count() or 1))
        with Image.open(input_path) as opened:image=opened.convert('RGB')
        image.thumbnail((2048,2048),Image.Resampling.LANCZOS)
        report=[]
        if kind=='depth':
            from transformers import DPTImageProcessor,AutoModelForDepthEstimation
            processor=DPTImageProcessor.from_pretrained(model_path,local_files_only=True,trust_remote_code=False)
            model=AutoModelForDepthEstimation.from_pretrained(model_path,local_files_only=True,trust_remote_code=False,use_safetensors=True).eval()
            with torch.inference_mode():
                output=model(**processor(images=image,return_tensors='pt')).predicted_depth
                values=torch.nn.functional.interpolate(output.unsqueeze(1),size=(image.height,image.width),mode='bicubic',align_corners=False).squeeze().cpu().numpy()
            if not np.isfinite(values).all():raise ValueError()
            low,high=float(values.min()),float(values.max());values=(values-low)/max(1e-12,high-low)
            Image.fromarray(np.rint(np.clip(values,0,1)*255).astype('uint8')).save(folder/'depth.png')
            report.append(dict(file='depth.png',instance_id=None))
        else:
            from transformers import SamModel,SamProcessor
            processor=SamProcessor.from_pretrained(model_path,local_files_only=True,trust_remote_code=False)
            model=SamModel.from_pretrained(model_path,local_files_only=True,trust_remote_code=False,use_safetensors=True).eval()
            for index,instance in enumerate(instances):
                points=[[[p['x']*image.width,p['y']*image.height] for p in instance['points']]]
                labels=[[p['label'] for p in instance['points']]]
                inputs=processor(image,input_points=points,input_labels=labels,return_tensors='pt')
                with torch.inference_mode():
                    output=model(**inputs)
                    masks=processor.image_processor.post_process_masks(output.pred_masks.cpu(),inputs['original_sizes'].cpu(),inputs['reshaped_input_sizes'].cpu(),binarize=False)[0]
                best=int(output.iou_scores[0,0].argmax());mask=masks[0,best].numpy()
                if not np.isfinite(mask).all():raise ValueError()
                # SAM returns classification logits, not an alpha matte. Keep
                # only a narrow soft transition around its zero decision edge;
                # a sigmoid across all logits leaves distant background ghosts.
                edge=np.clip(mask*.5+.5,0,1)
                alpha=Image.fromarray(np.rint(255*edge*edge*(3-2*edge)).astype('uint8'))
                if instance['feather']>0:alpha=alpha.filter(ImageFilter.GaussianBlur(instance['feather']))
                rgba=image.convert('RGBA');rgba.putalpha(alpha);bbox=alpha.point(lambda x:255 if x>3 else 0).getbbox()
                if bbox is None:raise ValueError()
                rgba=rgba.crop(bbox);rgba.info.clear();file=f'subject-{index}.png';rgba.save(folder/file)
                report.append(dict(file=file,instance_id=instance['id']))
        (folder/'result.json').write_text(json.dumps(dict(items=report)),encoding='utf-8')
    except Exception:
        # Never return model paths, library paths or arbitrary third-party errors.
        (folder/'result.json').write_text('{"error":"Local vision inference failed. Check the model files and available memory."}',encoding='utf-8')

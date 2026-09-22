"""Deterministic layout only. All pose pixels originate from imagegen outputs."""
from PIL import Image
from pathlib import Path
import json,hashlib
root=Path(__file__).resolve().parent
specs=[('pat','pat-v2.png',648,[0,1,2,3],[140,180,220,180]),('happy','happy-v2.png',627,[0,1,2,3],[140,160,180,220]),('dragged','dragged.png',633,[0,2,3],[180,180,220])]
animations=[]; qa=[]
for name,source,split,indices,durations in specs:
 im=Image.open(root/'sources'/source).convert('RGBA'); w,h=im.size
 boxes=[(0,0,w//2,split),(w//2,0,w,split),(0,split,w//2,h),(w//2,split,w,h)]
 poses=[]
 for index in indices:
  cell=im.crop(boxes[index]); box=cell.getchannel('A').point(lambda v:255 if v>32 else 0).getbbox(); assert box
  assert box[0]>0 and box[1]>0 and box[2]<cell.width and box[3]<cell.height,(name,index,box)
  poses.append(cell.crop(box))
 # One scale per animation preserves intentional head-bow and bounce sizes.
 scale=min(154/max(p.width for p in poses),198/max(p.height for p in poses))
 atlas=Image.new('RGBA',(192*len(poses),208)); frames=[]
 for i,pose in enumerate(poses):
  pose=pose.resize((round(pose.width*scale),round(pose.height*scale)),Image.Resampling.LANCZOS)
  frame=Image.new('RGBA',(192,208));frame.alpha_composite(pose,((192-pose.width)//2,203-pose.height));atlas.alpha_composite(frame,(i*192,0));frames.append(frame)
  qa.append({'animation':name,'sourceIndex':indices[i],'bounds':frame.getbbox(),'sha256':hashlib.sha256(frame.tobytes()).hexdigest()})
 atlas.save(root/(name+'.png'));atlas.save(root/(name+'.webp'),lossless=True)
 frames[0].save(root/(name+'-preview.webp'),save_all=True,append_images=frames[1:],duration=durations,loop=0,lossless=True)
 animations.append({'id':name,'atlasPath':name+'.webp','cellWidth':192,'cellHeight':208,'frames':[{'column':i,'row':0} for i in range(len(poses))],'durationsMs':durations,'loop':name=='dragged'})
manifest={'schemaVersion':1,'animations':animations,'triggers':{'head-tap':'pat','long-press':'pat','body-tap':'happy','drag':'dragged'},'fallbacks':{'pat':'waving','happy':'jumping','dragged':'running-right'},'idleVariants':[]}
(root/'interactions.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
(root/'visual-record.json').write_text(json.dumps({'generator':'built-in imagegen','deterministicAssembly':'shared-scale crop only; no generated or duplicated pose pixels','excluded':['pat.png: frame boundary crossing','happy.png: frame boundary crossing','dragged.png: top-right mirrored accessories'],'frames':qa,'visualAcceptance':'PENDING_NORMAL_SIZE_REVIEW'},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
files=['interactions.json']+[a['atlasPath'] for a in animations]+[name+'.png' for name, *_ in specs]
(root/'checksums.json').write_text(json.dumps({'schemaVersion':1,'files':[{'file':f,'bytes':(root/f).stat().st_size,'sha256':hashlib.sha256((root/f).read_bytes()).hexdigest()} for f in files]},indent=2)+'\n',encoding='utf8')
contact=Image.new('RGBA',(768,624),(40,43,49,255))
for r,(name,*_) in enumerate(specs):contact.alpha_composite(Image.open(root/(name+'.png')),(0,r*208))
contact.save(root/'contact-sheet.png')
print('Assembled independent pat(4), happy(4), dragged(3); base atlas unchanged')

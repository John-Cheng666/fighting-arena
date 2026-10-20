"""Run with Blender 4.5+ after opening the original REME material reconstruction.
blender --background source.blend --python scripts/bake-cinematic-v3-normals.py
Only derived PNGs are written; the source .blend is never saved.
"""
import bpy, json, pathlib, hashlib
root=pathlib.Path(__file__).resolve().parents[1]
output=root/'.local/sf6-v3/normals'; output.mkdir(parents=True,exist_ok=True)
prefixes=('Group_21_Sub_0_','Group_21_Sub_3_','Group_21_Sub_4_','Group_21_Sub_5_','Group_23_Sub_0_','Group_23_Sub_1_')
targets=[o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith(prefixes)]
assert len(targets)==6, [o.name for o in targets]
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=1
scene.render.bake.use_selected_to_active=False
for obj in bpy.data.objects:
    if obj.type=='MESH': obj.hide_render=obj not in targets;obj.hide_set(False)
results=[]
for obj in targets:
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    original=obj.data.materials[0];material=original.copy();material.use_nodes=True;obj.data.materials[0]=material
    image=bpy.data.images.new(obj.name+'-normal-v3',width=1024,height=1024,alpha=False,float_buffer=False)
    image.colorspace_settings.name='Non-Color'
    for node in material.node_tree.nodes: node.select=False
    node=material.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;node.select=True;material.node_tree.nodes.active=node
    bpy.ops.object.bake(type='NORMAL',normal_space='TANGENT',normal_r='POS_X',normal_g='POS_Y',normal_b='POS_Z',use_clear=True,margin=8)
    dest=output/(obj.name+'-normal.png');image.filepath_raw=str(dest);image.file_format='PNG';image.save()
    results.append({'mesh':obj.name,'normal':str(dest),'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'normalSpace':'TANGENT','channelConvention':'+X,+Y,+Z','sourceMaterial':original.name,'source':'Evaluated original REME shader normal graph'})
    obj.data.materials[0]=original
    print('BAKED_V3_NORMAL',obj.name,flush=True)
(output/'normal-bakes-v3.json').write_text(json.dumps(results,indent=2)+'\n',encoding='utf-8')

"""Low-thread offline geometry preview. This is NOT a browser screenshot."""
import bpy, json, math, os, sys
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
source = args[0]
output = args[1]
data = json.load(open(source))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 24
scene.cycles.use_denoising = False
scene.render.threads_mode = 'FIXED'
scene.render.threads = 2
scene.render.resolution_x = 1100
scene.render.resolution_y = 760
scene.render.resolution_percentage = 100
scene.world.color = (0.17, 0.20, 0.22)
scene.view_settings.view_transform = 'AgX'
scene.render.image_settings.file_format = 'JPEG' if output.lower().endswith(('.jpg', '.jpeg')) else 'PNG'
scene.render.image_settings.quality = 90

def xyz(values):
    # Three Y up, Blender Z up. Preserve handedness.
    return [(values[i], -values[i+2], values[i+1]) for i in range(0,len(values),3)]

for item in data['meshes']:
    mesh=bpy.data.meshes.new(item['name'])
    indices=item['indices']
    mesh.from_pydata(xyz(item['positions']), [], [indices[i:i+3] for i in range(0,len(indices),3)])
    mesh.update()
    if item.get("uvs"):
        uv_layer = mesh.uv_layers.new(name="UVMap")
        for loop in mesh.loops:
            index = loop.vertex_index * 2
            uv_layer.data[loop.index].uv = item["uvs"][index:index+2]
    color=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
    for i in range(len(color.data)): color.data[i].color=item['colors'][4*i:4*i+4]
    for polygon in mesh.polygons: polygon.use_smooth=True
    # Preserve authored hard edges and curved surface normals from the Three meshes.
    try: mesh.normals_split_custom_set_from_vertices(xyz(item['normals']))
    except Exception: pass
    obj=bpy.data.objects.new(item['name'],mesh)
    bpy.context.collection.objects.link(obj)
    material=bpy.data.materials.new(item['name']+'-material')
    material.use_nodes=True
    nodes=material.node_tree.nodes
    shader=nodes.get('Principled BSDF')
    attr=nodes.new('ShaderNodeVertexColor');attr.layer_name='Color'
    if item['material'].get('texture'):
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = bpy.data.images.load(item['material']['texture'])
        material.node_tree.links.new(texture.outputs['Color'],shader.inputs['Base Color'])
    else:
        material.node_tree.links.new(attr.outputs['Color'],shader.inputs['Base Color'])
    shader.inputs['Roughness'].default_value=item['material']['roughness']
    shader.inputs['Metallic'].default_value=item['material']['metalness']
    shader.inputs['Emission Color'].default_value=(*item['material']['emissive'],1)
    shader.inputs['Emission Strength'].default_value=item['material']['emissiveIntensity']
    obj.data.materials.append(material)

mode=data['metadata']['mode']
if mode == 'collection':
    scene.render.resolution_x=1200
    scene.render.resolution_y=1000
if mode not in ['arena', 'battle']:
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-0.03))
    floor=bpy.context.object
    material=bpy.data.materials.new('matte display floor');material.diffuse_color=(0.035,0.07,0.065,1)
    floor.data.materials.append(material)

def point_at(obj, target): obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
def area(name,location,energy,size,color):
    light=bpy.data.lights.new(name,'AREA');light.energy=energy;light.shape='DISK';light.size=size;light.color=color
    obj=bpy.data.objects.new(name,light);bpy.context.collection.objects.link(obj);obj.location=location;point_at(obj,(0,0,0.6))

if mode in ['arena', 'battle']:
    area('warm key',(-6,-5,12),1700,6,(1.0,0.82,0.61))
    area('cool fill',(6,2,9),1200,7,(0.52,0.75,1.0))
    area('rim',(-1,7,7),1700,5,(0.60,1.0,0.82))
else:
    area('warm key',(-4,-4,7),650,4,(1.0,0.83,0.63))
    area('cool fill',(5,-1,5),450,4,(0.66,0.78,1.0))
    area('rim',(1,4,6),800,3,(0.68,1.0,0.79))
bpy.ops.object.camera_add(location=(0,-16.8,14.7) if mode=='arena' else (0,-13.0,14.0) if mode=='collection' else (0,-10.0,5.6))
camera=bpy.context.object;camera.data.type='PERSP';camera.data.lens=35 if mode=='arena' else 48
point_at(camera,(0,0,0) if mode=='arena' else (0,0,0.75) if mode=='collection' else (0,0,0.95));scene.camera=camera
if mode=='battle':
    camera_spec=data['metadata']['camera']
    scene.render.resolution_x=camera_spec['width']
    scene.render.resolution_y=camera_spec['height']
    position=camera_spec['position'];target=camera_spec['target']
    camera.location=(position[0],-position[2],position[1])
    point_at(camera,(target[0],-target[2],target[1]))
    camera.data.sensor_fit='VERTICAL'
    camera.data.sensor_height=24
    camera.data.lens=24/(2*math.tan(math.radians(camera_spec['verticalFovDegrees'])/2))
    camera.data.clip_start=.1
    camera.data.clip_end=90
scene.render.filepath=output
bpy.ops.wm.save_as_mainfile(filepath=os.path.splitext(output)[0]+'.blend')
bpy.ops.render.render(write_still=True)
print('OFFLINE MODEL PREVIEW:',output)

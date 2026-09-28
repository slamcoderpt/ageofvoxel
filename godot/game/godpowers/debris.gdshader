// Voxel debris (crater chunks, char rims, earth / turf whirled by the storm):
// lit cubes, COLOR.rgb = linear albedo.
shader_type spatial;
render_mode diffuse_lambert, specular_disabled;
varying vec3 v_col;
void vertex() { v_col = COLOR.rgb; }
void fragment() {
	ALBEDO = v_col;
	ROUGHNESS = 1.0;
}

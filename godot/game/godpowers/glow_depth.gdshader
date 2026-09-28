// Depth-tested back lights: set just behind a unit, so his body masks the
// centre and only an electric rim shows round his silhouette.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;
#include "res://game/godpowers/glow.gdshaderinc"

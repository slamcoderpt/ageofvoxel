#include <gdextension_interface.h>

#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/core/defs.hpp>
#include <godot_cpp/godot.hpp>

#include "aov_sim.h"
#include "unit_view.h"
#include "econ_view.h"
#include "godpower_view.h"

using namespace godot;

static void initialize_aov(ModuleInitializationLevel p_level) {
	if (p_level != MODULE_INITIALIZATION_LEVEL_SCENE) return;
	GDREGISTER_CLASS(AovSim);
	GDREGISTER_CLASS(AovUnitView); // units / combat render data (unit_view.h)
	GDREGISTER_CLASS(AovEconView); // economy render data (econ_view.h)
	GDREGISTER_CLASS(AovGodpowerView); // god powers render data (godpower_view.h)
}

static void uninitialize_aov(ModuleInitializationLevel p_level) {
	if (p_level != MODULE_INITIALIZATION_LEVEL_SCENE) return;
}

extern "C" {
GDExtensionBool GDE_EXPORT aov_library_init(GDExtensionInterfaceGetProcAddress p_get_proc_address,
		const GDExtensionClassLibraryPtr p_library, GDExtensionInitialization *r_initialization) {
	godot::GDExtensionBinding::InitObject init_obj(p_get_proc_address, p_library, r_initialization);
	init_obj.register_initializer(initialize_aov);
	init_obj.register_terminator(uninitialize_aov);
	init_obj.set_minimum_library_initialization_level(MODULE_INITIALIZATION_LEVEL_SCENE);
	return init_obj.init();
}
}

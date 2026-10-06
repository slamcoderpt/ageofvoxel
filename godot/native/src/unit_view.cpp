// AovUnitView (see unit_view.h): units + combat rendering data, visual only.
#include "unit_view.h"

#include <godot_cpp/core/class_db.hpp>

#include <algorithm>
#include <cmath>
#include <cstring>

#include "sim/sim.h"

using namespace godot;

namespace {

constexpr double PI = 3.14159265358979323846;
enum Kind { K_HUMAN, K_ARCHER, K_BEAST, K_HORSE, K_CENTAUR, K_MEDUSA, K_FLYER, K_SIEGE };
// rig "pose" (scripts/export-egypt-units.mjs): a variant of the kind's motion
enum Pose { P_NONE, P_SPEAR, P_SLASH, P_SLING, P_SERPENT, P_CHARIOT, P_STAFF, P_MOUNT };

// pose channels (anim names of src/units/models.js)
enum Ch {
	CH_legL, CH_shinL, CH_legR, CH_shinR, CH_torso, CH_head, CH_armL, CH_armR, CH_weapon, CH_shield, CH_arrow,
	CH_foreL, CH_foreR, CH_body, CH_neck, CH_tail, CH_legFL, CH_cannonFL, CH_legFR, CH_cannonFR, CH_legBL,
	CH_cannonBL, CH_legBR, CH_cannonBR, CH_tailA, CH_tailB, CH_tailC, CH_coil,
	CH_wheel, CH_wingL, CH_wingR, // (Godot-only: chariots / siege, wings)
	CH_COUNT
};
const char *CH_NAMES[CH_COUNT] = { "legL", "shinL", "legR", "shinR", "torso", "head", "armL", "armR", "weapon", "shield",
	"arrow", "foreL", "foreR", "body", "neck", "tail", "legFL", "cannonFL", "legFR", "cannonFR", "legBL", "cannonBL",
	"legBR", "cannonBR", "tailA", "tailB", "tailC", "coil", "wheel", "wingL", "wingR" };

// show(u) rules of the conditional parts (src/units/models.js)
enum Rule { R_ALWAYS, R_HAMMER, R_TOOL, R_CARRY, R_ARROW, R_HELM, R_HAT, R_CLOAK, R_KIT, R_PENNANT, R_SHIELD, R_VARY };

const double CORPSE_TIME = 26, FADE_START = 22.5;
const double JITTER = 0.18, PRESS_RATE = 3, STAGGER = 0.5, STUCK_TIME = 9;
const double COATS[6][3] = { { 1, 1, 1 }, { 1.08, 1.08, 1.07 }, { 0.97, 0.9, 0.78 }, { 0.86, 0.86, 0.88 }, { 1.04, 1.02, 0.98 }, { 0.92, 0.9, 0.86 } };
// Units.heightOf (health bar height), by type index
const double HEIGHT_OF[aov::U_TYPE_COUNT] = { 2.0, 2.25, 2.05, 2.75, 3.4, 3.7, 5.0, 2.9, 2.6,
	2.0, 2.25, 2.25, 2.05, 2.75, 2.9, 4.2, 5.0, 2.6, 2.25, 2.75, 2.0, 2.3, 1.4, // (the Egyptian types: sim/civ)
	1.6, 1.4, 4.0, 1.0, 1.8, 2.0, 3.6, 1.6, 1.2, // (the Animals of Set)
	2.5, 2.6, 2.6, 1.4, 3.5, 2.0, 2.8, 2.4, 2.6, 3.2, 1.4, 2.2, 3.0, 1.0 }; // (the Egyptian gods' myth units, sim/godpowers)

inline double clamp01(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
inline double smooth(double v) { v = clamp01(v); return v * v * (3 - 2 * v); }
inline double ease(double a, double b, double k) { return a + (b - a) * k; }
inline double S(double x) { return std::sin(x); }
inline double C(double x) { return std::cos(x); }

// anim.js uhash(u, k)
inline double uhash(int32_t id, int k) {
	const uint32_t a = (uint32_t)(id + 1) * 2654435761u;
	const uint32_t b = (uint32_t)(k + 7) * 40503u;
	return (double)((a ^ b) % 10007u) / 10007.0;
}

struct Gear { int kit, helm, cloak, shield, hat, pennant; };
Gear gear_of(int32_t id, int type, int kit_col) {
	const double h = uhash(id, 20), c = uhash(id, 21), s = uhash(id, 22);
	Gear g;
	g.kit = type == aov::U_HOPLITE ? (kit_col != 255 ? kit_col : (uhash(id, 24) < 0.3 ? 1 : 0)) : 0;
	g.helm = g.kit == 1 ? 2 : h < 0.42 ? 0 : h < 0.84 ? 1 : 3;
	g.cloak = c < 0.12 ? 1 : c < 0.42 ? 2 : 0;
	g.shield = s < 0.25 ? 0 : s < 0.45 ? 1 : s < 0.8 ? 2 : 3;
	g.hat = h < 0.4 ? 0 : h < 0.72 ? 1 : 2;
	g.pennant = uhash(id, 23) < 0.22 ? 1 : 0;
	return g;
}

// small visual RNG (never the sim's): mulberry32
struct VRng {
	uint32_t s;
	explicit VRng(uint32_t seed) : s(seed) {}
	double next() {
		uint32_t t = (s += 0x6D2B79F5u);
		t = (t ^ (t >> 15)) * (t | 1u);
		t ^= t + (t ^ (t >> 7)) * (t | 61u);
		return (double)((t ^ (t >> 14))) / 4294967296.0;
	}
	double range(double a, double b) { return a + (b - a) * next(); }
	int irange(int a, int b) { return a + (int)std::floor(next() * (b - a + 1)); }
	bool chance(double p) { return next() < p; }
};

struct Col { float r, g, b; };
Col hex_lin(uint32_t h) {
	auto lin = [](double c) { return (float)(c <= 0.04045 ? c / 12.92 : std::pow((c + 0.055) / 1.055, 2.4)); };
	return { lin(((h >> 16) & 255) / 255.0), lin(((h >> 8) & 255) / 255.0), lin((h & 255) / 255.0) };
}
// full-saturation dye (index.js render): crush the minor channels, keep the peak
Col crush(Col c) {
	const float mx = std::max(std::max(c.r, c.g), std::max(c.b, 1e-4f));
	return { mx * (c.r / mx) * (c.r / mx), mx * (c.g / mx) * (c.g / mx), mx * (c.b / mx) * (c.b / mx) };
}

inline Basis euler(double x, double y, double z) { return Basis::from_euler(Vector3((real_t)x, (real_t)y, (real_t)z), EULER_ORDER_XYZ); }
inline Transform3D xl(double x, double y, double z) { return Transform3D(Basis(), Vector3((real_t)x, (real_t)y, (real_t)z)); }
inline Transform3D rot_x(double a) { return Transform3D(Basis(Vector3(1, 0, 0), (real_t)a), Vector3()); }
inline Transform3D rot_z(double a) { return Transform3D(Basis(Vector3(0, 0, 1), (real_t)a), Vector3()); }
// basis whose +z points along d (quaternion setFromUnitVectors(+z, d))
Basis look_z(Vector3 d) {
	d.normalize();
	const Vector3 z(0, 0, 1);
	const real_t c = z.dot(d);
	if (c < -0.99999f) return Basis(Vector3(1, 0, 0), (real_t)PI);
	Vector3 ax = z.cross(d);
	const real_t s = ax.length();
	if (s < 1e-6f) return Basis();
	return Basis(ax / s, std::atan2(s, c));
}

} // namespace

void AovUnitView::Buf::push(const Transform3D &t, float r, float g, float b, float a, float c0, float c1, float c2, float c3) {
	const Basis &B = t.basis;
	const float v[20] = { B.rows[0].x, B.rows[0].y, B.rows[0].z, t.origin.x, B.rows[1].x, B.rows[1].y, B.rows[1].z,
		t.origin.y, B.rows[2].x, B.rows[2].y, B.rows[2].z, t.origin.z, r, g, b, a, c0, c1, c2, c3 };
	d.insert(d.end(), v, v + 20);
	n++;
}

PackedFloat32Array AovUnitView::pack(const Buf &b) {
	int cap = 16;
	while (cap < b.n) cap <<= 1;
	PackedFloat32Array out;
	out.resize((int64_t)cap * 20);
	float *w = out.ptrw();
	if (!b.d.empty()) memcpy(w, b.d.data(), b.d.size() * sizeof(float));
	memset(w + b.d.size(), 0, ((size_t)cap * 20 - b.d.size()) * sizeof(float));
	return out;
}

void AovUnitView::_bind_methods() {
	ClassDB::bind_method(D_METHOD("setup", "sim", "rigs"), &AovUnitView::setup);
	ClassDB::bind_method(D_METHOD("update", "dt", "alpha", "local_player", "frustum", "lod_origin", "lod_dist"), &AovUnitView::update, DEFVAL(Array()), DEFVAL(Vector3()), DEFVAL(0.0));
	ClassDB::bind_method(D_METHOD("add_rig", "rig"), &AovUnitView::add_rig);
	ClassDB::bind_method(D_METHOD("set_rig_override", "unit_id", "rig"), &AovUnitView::set_rig_override);
	ClassDB::bind_static_method("AovUnitView", D_METHOD("lod_mesh", "arrays", "factor", "shadow_only"), &AovUnitView::lod_mesh, DEFVAL(2), DEFVAL(false));
}

// (round 24) the Mummy's idle blade angles (CH_weapon pitch about the fist)
static constexpr double IDLE_BLADE_LOW = 0.9, IDLE_BLADE_SHOULDER = -1.2, IDLE_BLADE_ACROSS = 0.35;

AovUnitView::Rig AovUnitView::parse_rig(const Dictionary &R, int t) {
	Rig rig;
	const String kind = R.get("anim", "human");
	rig.kind = kind == "archer" ? K_ARCHER : kind == "beast" ? K_BEAST : kind == "horse" ? K_HORSE : kind == "centaur" ? K_CENTAUR : kind == "medusa" ? K_MEDUSA
		: kind == "flyer" ? K_FLYER : kind == "siege" ? K_SIEGE : K_HUMAN;
	const String pose = R.get("pose", "");
	rig.pose = pose == "spear" ? P_SPEAR : pose == "slash" ? P_SLASH : pose == "sling" ? P_SLING : pose == "serpent" ? P_SERPENT
		: pose == "chariot" ? P_CHARIOT : pose == "staff" ? P_STAFF : pose == "mount" ? P_MOUNT : P_NONE;
	rig.gait = (float)(double)R.get("gait", 1.0);
	rig.stride = (float)(double)R.get("stride", 1.0);
	rig.hover = (float)(double)R.get("hover", 0.0);
	rig.graze = (bool)R.get("graze", true);
	rig.upright = (bool)R.get("upright", false);
	rig.sprawl = (bool)R.get("sprawl", false);
	rig.sting = (bool)R.get("sting", false);
	rig.idles = (bool)R.get("idles", false);
	{ const Variant sv = R.get("stance", 0.0); rig.stance = sv.get_type() == Variant::BOOL ? ((bool)sv ? 1.0f : 0.0f) : (float)(double)sv; }
	rig.voxel = (float)(double)R.get("voxel", 0.07);
	const Array parts = R.get("parts", Array());
	for (int64_t i = 0; i < parts.size(); i++) {
		const Dictionary P = parts[i];
		Part p;
		p.name = String(P.get("name", "")).utf8().get_data();
		const std::string anim = String(P.get("anim", "")).utf8().get_data();
		for (int c = 0; c < CH_COUNT; c++)
			if (anim == CH_NAMES[c]) p.channel = c;
		p.weapon = anim == "weapon";
		if (p.channel == CH_shield) rig.has_shield = true;
		if (p.channel == CH_armR) rig.has_armR = true;
		p.parent = (int)(int64_t)P.get("parentIdx", -1);
		const Array j = P.get("joint", Array());
		if (j.size() >= 3) p.joint = Vector3((real_t)(double)j[0], (real_t)(double)j[1], (real_t)(double)j[2]) * rig.voxel;
		const Array rest = P.get("rest", Array());
		if (rest.size() >= 3) { p.has_rest = true; p.rest = euler((double)rest[0], (double)rest[1], (double)rest[2]); }
		p.coat = (bool)P.get("coat", false);
		const bool cond = (bool)P.get("conditional", false);
		const std::string &n = p.name;
		const Array vary = P.get("vary", Array());
		if (vary.size() >= 2) { p.rule = R_VARY; p.rule_v = (int)(int64_t)vary[0]; p.rule_n = std::max(1, (int)(int64_t)vary[1]); }
		else if (cond) {
			if (n == "toolHammer") p.rule = R_HAMMER;
			else if (n == "toolAxe") { p.rule = R_TOOL; p.rule_v = aov::RES_WOOD; }
			else if (n == "toolPick") { p.rule = R_TOOL; p.rule_v = aov::RES_GOLD; }
			else if (n == "toolSickle") { p.rule = R_TOOL; p.rule_v = aov::RES_FOOD; }
			else if (n == "carryWood") { p.rule = R_CARRY; p.rule_v = aov::RES_WOOD; }
			else if (n == "carryGold") { p.rule = R_CARRY; p.rule_v = aov::RES_GOLD; }
			else if (n == "carryFood") { p.rule = R_CARRY; p.rule_v = aov::RES_FOOD; }
			else if (n == "arrow") p.rule = R_ARROW;
			else if (n.rfind("head", 0) == 0) { p.rule = (String(R.get("style", "")) == "hoplite" || t == aov::U_HOPLITE) ? R_HELM : R_HAT; p.rule_v = n.size() > 4 ? n[4] - '0' : 0; }
			else if (n == "cloakLong") { p.rule = R_CLOAK; p.rule_v = 1; }
			else if (n == "cloakShort") { p.rule = R_CLOAK; p.rule_v = 2; }
			else if (n == "weapon") { p.rule = R_KIT; p.rule_v = 0; }
			else if (n == "sword" || n == "thureos") { p.rule = R_KIT; p.rule_v = 1; }
			else if (n == "pennant") p.rule = R_PENNANT;
			else if (n.rfind("shield", 0) == 0) { p.rule = R_SHIELD; p.rule_v = n.size() > 6 ? n[6] - '0' : 0; }
		}
		rig.parts.push_back(p);
	}
	return rig;
}

int64_t AovUnitView::add_rig(const Dictionary &R) {
	Rig rig = parse_rig(R, -1);
	rig.first = (int)part_bufs_.size();
	part_bufs_.resize(part_bufs_.size() + rig.parts.size());
	rigs_.push_back(rig);
	return (int64_t)rigs_.size() - 1;
}

void AovUnitView::set_rig_override(int64_t unit_id, int64_t rig) {
	if (rig < 0 || rig >= (int64_t)rigs_.size()) rig_override_.erase((int32_t)unit_id);
	else rig_override_[(int32_t)unit_id] = (int)rig;
}

void AovUnitView::setup(const Ref<AovSim> &sim, const Array &rigs) {
	sim_ref_ = sim;
	rigs_.clear();
	rig_override_.clear();
	int first = 0;
	for (int64_t t = 0; t < rigs.size(); t++) {
		Rig rig = parse_rig(rigs[t], (int)t);
		rig.first = first;
		first += (int)rig.parts.size();
		rigs_.push_back(rig);
	}
	part_bufs_.assign(first, Buf());
	hits_ = std::make_shared<std::vector<HitRec>>();
	dropped_ = std::make_shared<std::vector<DropRec>>();
	seq_ = std::make_shared<uint32_t>(0);
	cell_of_.clear(); cell_key_.clear(); cell_pos_.clear(); cell_val_.clear();
	scarred_seq_ = 0; scene_scars_ = 0; last_scan_ = -1; scar_clock_ = -1; scar_upload_ = -1;
	if (sim.is_null()) return;
	cell_of_.assign((size_t)sim->sim().map().cols * sim->sim().map().cols, 0);
	// BattleFX.hit / death, stamped with the sim time (the subscriber only
	// reads the sim; it owns shared buffers so it outlives this view safely)
	aov::Sim *S = &sim->sim();
	auto hits = hits_;
	auto dropped = dropped_;
	auto seq = seq_;
	S->events.on(aov::EV_UNIT_DAMAGED, [S, hits, seq](const aov::Event &ev) {
		const aov::Entities &E = S->entities;
		HitRec h{};
		h.time = S->time;
		h.seed = (uint32_t)ev.id * 2654435761u ^ (uint32_t)(S->tick_count * 40503u) ^ (uint32_t)hits->size() * 97u;
		if (ev.kind == aov::K_BUILDING) {
			const int b = E.building_slot(ev.id);
			if (b < 0) return;
			h.kind = 2;
			h.x = (float)E.buildings.x[b];
			h.z = (float)E.buildings.z[b];
			h.y = (float)S->map().height_at(h.x, h.z) + 1.5f;
		} else {
			const int t = E.unit_slot(ev.id);
			if (t < 0) return;
			const aov::UnitStore &U = E.units;
			const aov::UnitDef &td = aov::unit_def(U.type[t]);
			const int a = E.unit_slot(ev.other);
			const aov::UnitDef *ad = a >= 0 ? &aov::unit_def(U.type[a]) : nullptr;
			const bool melee = ad && ad->has_attack && !ad->attack.projectile;
			h.kind = melee ? 0 : 1;
			h.big = (td.myth || td.hero || (ad && (ad->myth || ad->hero))) ? 1 : 0;
			double x = U.x[t], z = U.z[t], bx = 0, bz = 0;
			if (melee) {
				const double dx = U.x[a] - x, dz = U.z[a] - z;
				double d = std::hypot(dx, dz);
				if (d == 0) d = 1;
				bx = -dx / d;
				bz = -dz / d;
			}
			h.x = (float)x;
			h.z = (float)z;
			h.bx = (float)bx;
			h.bz = (float)bz;
			VRng r(h.seed);
			h.y = (float)(S->map().height_at(x, z) + HEIGHT_OF[U.type[t]] * (0.45 + 0.3 * r.next()));
			const aov::Player *p = S->player(U.owner[t]);
			const Col c = hex_lin(p ? p->color : 0x888888);
			h.tr = c.r;
			h.tg = c.g;
			h.tb = c.b;
			h.scale = (float)td.radius;
		}
		h.seq = ++*seq;
		if (hits->size() > 30000) hits->erase(hits->begin(), hits->begin() + 15000);
		hits->push_back(h);
	});
	S->events.on(aov::EV_ENTITY_DIED, [S, hits, dropped, seq](const aov::Event &ev) {
		if (ev.kind != aov::K_UNIT) return;
		const aov::Entities &E = S->entities;
		const int u = E.unit_slot(ev.id);
		if (u < 0) return;
		const aov::UnitStore &U = E.units;
		const aov::UnitDef &d = aov::unit_def(U.type[u]);
		HitRec h{};
		h.time = S->time;
		h.kind = 3;
		h.x = (float)U.x[u];
		h.z = (float)U.z[u];
		h.y = (float)S->map().height_at(h.x, h.z);
		h.seed = (uint32_t)ev.id * 2246822519u ^ 0x9e3779b9u;
		h.scale = (float)(d.myth ? 1.8 : d.cls == aov::CLS_CAVALRY ? 1.4 : 1.0);
		h.rot = (float)U.rot[u];
		h.seq = ++*seq;
		if (hits->size() > 30000) hits->erase(hits->begin(), hits->begin() + 15000);
		hits->push_back(h);
		// BattleFX.dropGear (life 40)
		const int cls = d.cls;
		if (cls != aov::CLS_INFANTRY && cls != aov::CLS_CAVALRY && cls != aov::CLS_ARCHER) return;
		VRng r(h.seed ^ 0x51ed27u);
		const double side = ev.id % 2 ? 1 : -1, rot = U.rot[u];
		const double c = std::cos(rot), s = std::sin(rot);
		auto at = [&](double lat, double fwd, float &x, float &z) {
			x = (float)(U.x[u] + c * lat * side + s * fwd);
			z = (float)(U.z[u] - s * lat * side + c * fwd);
		};
		const double die = S->time + 40;
		if (dropped->size() > 1500) dropped->erase(dropped->begin(), dropped->begin() + 500);
		if (cls == aov::CLS_INFANTRY && r.chance(0.4)) {
			DropRec g{ aov::DROP_SHIELD, 0, 0, 0, 0, 0, 0, U.owner[u], die };
			at(r.range(-0.7, -0.3), r.range(-0.3, 0.4), g.x, g.z);
			g.rot = (float)r.range(0, 6.28);
			g.tilt = (float)(r.chance(0.3) ? r.range(0.2, 0.5) : r.range(-0.08, 0.08));
			g.roll = (float)r.range(-0.1, 0.1);
			dropped->push_back(g);
		}
		if (cls != aov::CLS_ARCHER && r.chance(0.25)) {
			DropRec g{ aov::DROP_SPEAR, 0, 0, 0, 0, 0, 0, U.owner[u], die };
			at(r.range(0.3, 0.8), r.range(-0.4, 0.5), g.x, g.z);
			g.kind = r.chance(0.3) ? aov::DROP_STUB : aov::DROP_SPEAR;
			g.rot = (float)(rot + r.range(-1.2, 1.2));
			g.tilt = (float)r.range(-0.05, 0.05);
			dropped->push_back(g);
		}
		if (r.chance(0.2)) {
			DropRec g{ aov::DROP_HELMET, 0, 0, 0, 0, 0, 0, U.owner[u], die };
			at(r.range(-0.5, 0.5), r.range(0.4, 0.8), g.x, g.z);
			g.rot = (float)r.range(0, 6.28);
			g.tilt = (float)r.range(-0.5, 0.5);
			g.roll = (float)r.range(1.2, 1.7);
			g.lift = 0.12f;
			dropped->push_back(g);
		}
	});
}

// ---- src/units/anim.js pose() ---------------------------------------------------

void AovUnitView::pose_unit(int row, int ri, float out[][3], float &bob_out, float &fwd_out) {
	const aov::Sim &SM = sim_ref_->sim();
	const aov::UnitStore &U = SM.entities.units;
	const int32_t id = U.id[row];
	const int type = U.type[row];
	const aov::UnitDef &def = aov::unit_def(type);
	const Rig &rig = rigs_[ri];
	const int kind = rig.kind;
	const int pose = rig.pose;
	const bool dead = U.dead[row];
	const int st = dead ? aov::A_DIE : U.anim_state[row];
	const double phase = std::fmod(id * 0.618034, 1.0) * PI * 2;
	const double t = U.anim_t[row] * (0.85 + uhash(id, 40) * 0.3) + phase * 0.5;
	for (int c = 0; c < CH_COUNT; c++) out[c][0] = out[c][1] = out[c][2] = 0;
	auto set = [&](int c, double x, double y = 0, double z = 0) { out[c][0] = (float)x; out[c][1] = (float)y; out[c][2] = (float)z; };
	auto add = [&](int c, double x, double y = 0, double z = 0) { out[c][0] += (float)x; out[c][1] += (float)y; out[c][2] += (float)z; };
	const int v = (int)std::floor(uhash(id, 1) * 3);
	const double ah = uhash(id, 9);
	const int av = type == aov::U_HOPLITE ? (ah < 0.5 ? 1 : ah < 0.75 ? 0 : ah < 0.88 ? 2 : 3) : (int)std::floor(ah * 4);
	const double rec = st == aov::A_DIE ? 0 : smooth(U.flash_t[row] / 0.15);
	const double die_t = U.anim_die_t[row];
	const bool attacking = st == aov::A_ATTACK;

	// attackPhase
	const double cd = def.has_attack ? def.attack.cooldown : 1.2;
	const double a_ = U.anim_attack_t[row] * (0.9 + uhash(id, 41) * 0.2);
	const double ext0 = a_ < 0.1 ? smooth(a_ / 0.1) : 1 - smooth((a_ - 0.1) / 0.35);
	const double wind0 = smooth((a_ - 0.45) / std::max(0.2, (cd - 0.55) * 0.45));
	const double extend = a_ < 0.45 ? ext0 : 0, wind = a_ < 0.45 ? 0 : wind0;

	auto archer_upper = [&](int vv) -> bool {
		if (pose == P_CHARIOT) {
			// (Egyptian chariot archer: arms split at the elbow, foreL / foreR)
			// at rest the bow is held upright before the body on a bent left
			// arm, the right hand on the string with the elbow bent; to shoot
			// the bow arm goes out straight at the target and the right elbow
			// draws back to shoulder height, the hand at the cheek
			if (st == aov::A_DIE) return false;
			if (attacking) {
				const double span = std::max(0.35, cd * 0.8 - 0.45);
				const double draw = a_ < 0.45 ? 1.0 - smooth(a_ / 0.2) : smooth((a_ - 0.45) / span);
				set(CH_torso, 0.02, 0.45, 0);
				set(CH_head, 0, -0.4);
				set(CH_armL, -1.5, -0.25, 0.08); set(CH_foreL, -0.05);
				set(CH_weapon, 1.5);
				set(CH_armR, ease(-1.25, -0.2, draw), ease(0.55, -0.55, draw), ease(0.0, -1.35, draw));
				set(CH_foreR, ease(-0.5, -2.1, draw));
				set(CH_arrow, 1.57);
				return true;
			}
			const double b = S(t * 1.7) * 0.03;
			set(CH_armL, -0.25 + b, 0, 0.3); set(CH_foreL, -0.95);
			set(CH_weapon, 1.2, 0, -0.3);
			set(CH_armR, -0.35 + b, 0.95, -0.05); set(CH_foreR, -1.45);
			return true;
		}
		if (pose == P_SLING) {
			// (Egyptian slinger) whirl the sling over the head, then a long
			// overarm release towards the target; the free arm points at it
			if (attacking) {
				const double spin = t * 15;
				set(CH_armL, -1.35, -0.2, 0.1);
				set(CH_torso, 0.05 + extend * 0.25, 0.35 - extend * 0.6, 0);
				set(CH_head, 0, -0.3 + extend * 0.4);
				if (a_ < 0.45) { set(CH_armR, -2.9 + 1.9 * extend, 0.1, -0.2); set(CH_weapon, 0.3 + 1.6 * extend); }
				else { set(CH_armR, -2.75, 0.2, -0.35); set(CH_weapon, 1.3 + S(spin) * 0.9, 0, C(spin) * 0.9); }
				return true;
			}
			return false;
		}
		if (attacking) {
			const double span = std::max(0.35, cd * (0.75 + uhash(id, 57) * 0.25) - 0.45);
			const double draw = a_ < 0.45 ? 0 : smooth((a_ - 0.45) / span);
			const double high = vv == 1 ? -0.25 : 0;
			set(CH_torso, 0.02 + high * 0.3, 0.55, 0);
			set(CH_head, high * 0.4, -0.45);
			set(CH_armL, -1.5 + high, -0.45, 0.05);
			set(CH_weapon, 1.5, 0, 0);
			set(CH_armR, (a_ < 0.45 ? ease(-1.4, -2.5, smooth((a_ - 0.08) / 0.3)) : ease(-1.55, -1.5, draw)) + high, a_ < 0.45 ? 0 : ease(0.25, 0.9, draw), 0);
			return true;
		}
		if (st == aov::A_IDLE) {
			const double b = S(t * 1.7);
			if (vv == 1) {
				set(CH_armL, -0.95, -0.3, 0.06); set(CH_weapon, 1.3); set(CH_armR, -1.0, 0.4, 0);
				set(CH_torso, 0.04, 0.3 + S(t * 0.4) * 0.15); set(CH_head, -0.05, -0.2 + S(t * 0.6) * 0.3);
			} else { set(CH_armL, -0.25 + b * 0.03, 0, 0.08); set(CH_weapon, 0.25); }
			return true;
		}
		return false;
	};

	auto horse_pose = [&]() -> double {
		double bob = 0;
		const bool moving = st == aov::A_WALK;
		if (moving) {
			const double p = t * 12 * rig.gait, A = rig.stride;
			set(CH_wheel, std::fmod(t * 7 * rig.gait, PI * 2));
			auto leg = [&](int up, int cannon, double ph, bool hind) {
				const double s = S(p + ph), c = C(p + ph);
				set(up, (hind ? 0.1 : -0.05) - s * (hind ? 0.55 : 0.75) * A);
				set(cannon, (hind ? std::max(0.0, c) * 1.1 + 0.1 : std::max(0.0, c) * 1.5 + 0.05) * A);
			};
			leg(CH_legBL, CH_cannonBL, 0, true);
			leg(CH_legBR, CH_cannonBR, 0.5, true);
			leg(CH_legFL, CH_cannonFL, 2.2, false);
			leg(CH_legFR, CH_cannonFR, 2.7, false);
			set(CH_body, S(p + 1.2) * 0.07);
			set(CH_neck, 0.05 - S(p + 1.2) * 0.14);
			set(CH_tail, -0.7 + S(p * 0.5) * 0.1, S(p) * 0.15);
			bob = (1.2 + S(p + 2.8) * 1.3) * A;
			if (rig.sprawl) {
				// (the Petsuchos) a sprawling crocodile walk: each upper limb,
				// reaching out sideways, sweeps forward and back about the
				// vertical (yaw) and lifts its elbow (roll) as it swings forward,
				// the forearm planting the foot; diagonal pairs move together and
				// the body, head and tail sway in an S, with almost no bob
				auto sleg = [&](int up, int cannon, double ph, double side) {
					const double s = S(p + ph), c = C(p + ph);
					set(up, 0, -side * s * 0.55 * A * 1.6, side * std::max(0.0, c) * 0.35 * A * 1.6);
					set(cannon, -std::max(0.0, c) * 0.4 * A);
				};
				sleg(CH_legFL, CH_cannonFL, 0, 1);
				sleg(CH_legBR, CH_cannonBR, 0, -1);
				sleg(CH_legFR, CH_cannonFR, PI, -1);
				sleg(CH_legBL, CH_cannonBL, PI, 1);
				set(CH_body, 0, S(p) * 0.07);
				set(CH_neck, 0.0, -S(p) * 0.1);
				set(CH_tailA, 0, -S(p - 0.8) * 0.18);
				set(CH_tailB, 0, -S(p - 1.6) * 0.24);
				set(CH_tailC, 0, -S(p - 2.4) * 0.3);
				bob = 0.15 * (1 + C(p * 2)) * A;
			}
			set(CH_torso, 0.12 - S(p + 1.2) * 0.1 * A);
			set(CH_head, -0.05);
		} else {
			set(CH_neck, 0.05 + S(t * 0.8) * 0.04);
			if (st == aov::A_IDLE) {
				const double g = rig.graze ? smooth((S(t * 0.19 + id) - 0.7) * 5) : 0.0;
				add(CH_neck, g * 0.75);
				set(CH_legFL, -0.05); set(CH_legBR, 0.08); set(CH_cannonBR, 0.35);
				if (pose == P_CHARIOT) {
					// (Egyptian chariot horse) stands mid-stride, head high: a
					// foreleg lifted and pawing, a hind leg set back
					const double paw = S(t * 1.1 + id) * 0.08;
					set(CH_legFL, -0.62 + paw); set(CH_cannonFL, 1.35 + paw);
					set(CH_legFR, 0.12); set(CH_legBL, -0.18); set(CH_legBR, 0.22); set(CH_cannonBR, 0.3);
					set(CH_neck, -0.04 + S(t * 0.8) * 0.04);
				}
			}
			set(CH_tail, -0.2 + S(t * 1.3) * 0.05, S(t * 0.9) * 0.25);
			set(CH_torso, 0.02 + S(t * 1.6) * 0.015);
			if (rig.sprawl) {
				// (the Petsuchos) at rest: belly down, the tail's tip curling
				// slowly from side to side, the head now and then lifting
				set(CH_legFL, 0); set(CH_legBR, 0); set(CH_cannonBR, 0);
				set(CH_neck, -0.06 * smooth((S(t * 0.23 + id) - 0.6) * 4), S(t * 0.4 + id) * 0.06);
				set(CH_tailA, 0, S(t * 0.5 + id) * 0.04);
				set(CH_tailB, 0, S(t * 0.5 + id - 0.9) * 0.08);
				set(CH_tailC, 0, S(t * 0.5 + id - 1.8) * 0.14);
			}
			set(CH_head, 0, S(t * 0.5) * 0.25);
		}
		if (attacking) {
			const double arm = -2.3 - wind * 0.3 + extend * 0.6;
			set(CH_armR, arm, 0.1, -0.15);
			set(CH_weapon, 1.57 + 0.45 - arm);
			set(CH_torso, 0.05 + extend * 0.25, -0.2 + extend * 0.35);
			set(CH_body, -0.12 * wind + 0.05 * extend);
			set(CH_legFL, -0.6 * wind); set(CH_cannonFL, 1.4 * wind);
			set(CH_neck, -0.2 * wind);
		} else if (st == aov::A_DIE) {
			const double k = smooth(die_t / 0.8);
			set(CH_legFL, -0.8 * k); set(CH_legFR, -0.5 * k); set(CH_legBL, 0.6 * k); set(CH_legBR, 0.4 * k);
			set(CH_neck, 0.6 * k); set(CH_armR, -2 * k); set(CH_armL, -1.5 * k);
		} else {
			set(CH_armR, moving ? -0.35 : -0.25, 0, -0.12);
			set(CH_weapon, moving ? 0.9 : 0.25);
		}
		if (st != aov::A_DIE) { set(CH_armL, -0.75, 0.2, 0.25); set(CH_shield, 0.1, 1.1, 0); }
		if (rig.sting) {
			// (the Scorpion Man) its legs splay sideways: the left four (FL, BR)
			// and right four (FR, BL) channels sweep fore / aft (yaw) and lift
			// (roll) in alternating fours, the knees (cannons) never pitch; the
			// tail sways a little and, attacking, cocks back then strikes forward
			const double p = t * 12 * rig.gait, A = rig.stride;
			auto sleg = [&](int up, int cannon, double ph, double side) {
				const double s = moving ? S(p + ph) : 0, c = moving ? C(p + ph) : 0;
				set(up, 0, -side * s * 0.5 * A * 1.6, side * std::max(0.0, c) * 0.3 * A * 1.6);
				set(cannon, 0);
			};
			sleg(CH_legFL, CH_cannonFL, 0, 1);
			sleg(CH_legBR, CH_cannonBR, PI, 1);
			sleg(CH_legFR, CH_cannonFR, PI, -1);
			sleg(CH_legBL, CH_cannonBL, 0, -1);
			const double sw = moving ? S(p * 0.5) : S(t * 0.7 + id);
			set(CH_tailA, 0.02 * sw, 0.04 * sw);
			set(CH_tailB, 0.03 * sw, 0.05 * sw);
			set(CH_tailC, 0.05 * sw, 0.06 * sw);
			set(CH_body, moving ? S(p * 2) * 0.02 : 0);
			if (attacking) {
				set(CH_tailA, -0.12 * wind + 0.2 * extend); set(CH_tailB, -0.15 * wind + 0.3 * extend); set(CH_tailC, -0.2 * wind + 0.45 * extend);
				set(CH_neck, -0.1 * wind + 0.15 * extend);
			} else if (st == aov::A_DIE) {
				const double k = smooth(die_t / 0.8);
				for (int ch : { CH_legFL, CH_legBR }) set(ch, 0, 0, -0.5 * k);
				for (int ch : { CH_legFR, CH_legBL }) set(ch, 0, 0, 0.5 * k);
				for (int ch : { CH_cannonFL, CH_cannonBR }) set(ch, 0, 0, -0.6 * k);
				for (int ch : { CH_cannonFR, CH_cannonBL }) set(ch, 0, 0, 0.6 * k);
				set(CH_tailA, -0.35 * k); set(CH_tailB, -0.3 * k); set(CH_tailC, -0.25 * k);
				set(CH_neck, 0.2 * k);
			}
			bob = moving ? 0.1 * (1 + C(p * 2)) * A : 0;
		}
		if (pose == P_MOUNT && st != aov::A_DIE) {
			// (Egyptian riders, "mount") elbows in at the sides, both forearms
			// bent forward: the left fist on the reins before the lap, the right
			// carrying the weapon forward (raised and swung through when attacking)
			set(CH_armL, -0.12, 0.1, 0.05); set(CH_foreL, -0.85);
			if (!attacking) { set(CH_armR, moving ? -0.4 : -0.3, 0, -0.06); set(CH_foreR, -1.0); set(CH_weapon, moving ? 0.5 : 0.2); }
			else set(CH_foreR, -0.35 - 0.4 * wind);
		}
		if (rig.sprawl && (attacking || st == aov::A_DIE)) {
			// (the Petsuchos) its level sprawled limbs only lift a little (roll),
			// never the horse's pitch, so the feet stay planted; attacking, the
			// head rears, the jaws opening at the target; dying it sinks flat,
			// limbs and head slack, the tail laid out on the ground
			const double k = attacking ? wind : smooth(die_t / 0.8);
			for (int c : { CH_cannonFL, CH_cannonFR, CH_cannonBL, CH_cannonBR }) set(c, 0);
			if (attacking) {
				for (int c : { CH_legFL, CH_legFR, CH_legBL, CH_legBR }) set(c, 0);
				set(CH_body, -0.06 * k); set(CH_neck, -0.3 * k + 0.1 * extend);
			} else {
				set(CH_legFL, 0, 0, 0.2 * k); set(CH_legFR, 0, 0, -0.2 * k);
				set(CH_legBL, 0, 0, 0.2 * k); set(CH_legBR, 0, 0, -0.2 * k);
				set(CH_body, 0, 0, 0.05 * k); set(CH_neck, 0.04 * k, 0.25 * k);
				set(CH_tailA, 0, -0.15 * k); set(CH_tailB, 0, -0.2 * k); set(CH_tailC, 0, 0.25 * k);
			}
		}
		fwd_out = attacking ? (float)(0.25 * extend) : 0;
		return bob;
	};

	if (kind == K_HORSE) { bob_out = (float)horse_pose(); return; }
	if (kind == K_CENTAUR) {
		const double bob = horse_pose();
		set(CH_shield, 0);
		if (!archer_upper(v % 2)) { if (st != aov::A_DIE) { set(CH_armL, -0.3, 0, 0.1); set(CH_weapon, 0.3); set(CH_armR, -0.2, 0, -0.1); } }
		if (attacking && pose != P_CHARIOT) set(CH_arrow, 1.55 - out[CH_armR][0], 0, 0);
		add(CH_torso, -0.3 * rec);
		bob_out = (float)bob;
		fwd_out = (float)(-0.1 * rec);
		return;
	}
	if (kind == K_MEDUSA) {
		const bool moving = st == aov::A_WALK;
		const double f = moving ? 5 : 1.6, amp = moving ? 0.6 : 0.3;
		set(CH_tailA, 0, S(t * f) * amp);
		set(CH_tailB, 0, S(t * f - 1.1) * amp * 1.2);
		set(CH_tailC, 0, S(t * f - 2.2) * amp * 1.4);
		set(CH_coil, 0, S(t * f * 0.5) * 0.05);
		double bob = S(t * f) * 0.3;
		if (st == aov::A_DIE) {
			const double k = smooth(die_t / 0.6);
			set(CH_torso, 0.9 * k, 0, 0.2 * k); set(CH_head, 0.4 * k); set(CH_armL, -0.6 * k, 0, 0.5 * k); set(CH_armR, -0.4 * k, 0, -0.6 * k);
			bob = -6 * k;
		} else if (pose == P_SERPENT) {
			// (wadjet) the hood sways and rears, then strikes forward to spit
			set(CH_torso, 0.05 - (attacking ? 0.35 * wind - 0.55 * extend : 0), S(t * 1.9) * 0.15);
		} else if (!archer_upper(v % 2)) {
			set(CH_torso, 0.05, S(t * 2.5) * 0.12); set(CH_armL, -0.4, 0, 0.1); set(CH_weapon, 0.3); set(CH_armR, -0.3, 0, -0.1);
		}
		{
			// wings (wadjet): a slow beat at rest, faster on the move, spread wide to strike
			const double f = moving ? 7 : 2.4, fl = S(t * f) * (moving ? 0.45 : 0.18);
			const double up = st == aov::A_DIE ? -0.6 * smooth(die_t / 0.6) : 0.55 + fl + (attacking ? 0.35 * wind : 0);
			set(CH_wingL, 0.1, 0, up); set(CH_wingR, 0.1, 0, -up);
		}
		if (attacking) set(CH_arrow, 1.55 - out[CH_armR][0], 0, 0);
		add(CH_torso, -0.35 * rec);
		bob_out = (float)bob;
		fwd_out = (float)(-0.08 * rec);
		return;
	}

	if (kind == K_FLYER) {
		// (phoenix, roc) hover at rig.hover, wings beating (faster on the move),
		// a dive with the talons forward to strike, a fall when killed
		// (round 20) the wings are an arm and a hand (channels foreL / foreR):
		// the arm beats from a slight dihedral, the hand follows a quarter beat
		// late so the wing bends at the wrist; the idle is a slow soaring beat
		const bool moving = st == aov::A_WALK;
		const double f = moving ? 5.5 : 2.6;
		const double fl = S(t * f), amp = moving ? 0.42 : 0.2;
		const double hl = S(t * f - 1.1) * (moving ? 0.3 : 0.12);
		double bob = rig.hover + S(t * f * 0.5 + 1) * 1.2;
		set(CH_wingL, 0, 0, 0.14 + fl * amp); set(CH_wingR, 0, 0, -0.14 - fl * amp);
		set(CH_foreL, 0, 0, 0.06 + hl); set(CH_foreR, 0, 0, -0.06 - hl);
		set(CH_body, moving ? 0.12 : 0.02 + S(t * 0.7) * 0.04, 0, S(t * 0.5) * 0.06);
		set(CH_tail, -0.1 + S(t * f * 0.5) * 0.08, S(t * 0.9) * 0.15);
		set(CH_legL, 0.7); set(CH_legR, 0.7);
		if (attacking) {
			set(CH_body, 0.15 + 0.45 * extend - 0.2 * wind);
			set(CH_legL, 0.7 - 1.6 * extend); set(CH_legR, 0.7 - 1.6 * extend);
			set(CH_wingL, 0, 0, 0.5 * wind + fl * 0.3); set(CH_wingR, 0, 0, -0.5 * wind - fl * 0.3);
			set(CH_foreL, 0, 0, -0.25 * wind); set(CH_foreR, 0, 0, 0.25 * wind);   // the hands cupped down as it stoops
			bob -= 5 * extend;
			fwd_out = (float)(0.3 * extend);
		} else if (st == aov::A_DIE) {
			const double k = smooth(die_t / 0.9);
			bob = rig.hover * (1 - k);
			set(CH_wingL, 0, 0, -0.5 * k + fl * (1 - k) * amp); set(CH_wingR, 0, 0, 0.5 * k - fl * (1 - k) * amp);
			set(CH_foreL, 0, 0, -0.3 * k); set(CH_foreR, 0, 0, 0.3 * k);
			set(CH_body, 0.4 * k, 0, 0.3 * k);   // (round 20) a smaller roll, so both wings sag to the ground
		}
		bob_out = (float)bob;
		return;
	}
	if (kind == K_SIEGE) {
		// (catapult, siege tower) wheels roll on the move; the catapult's arm
		// ("weapon") lies cocked back and throws on each attack
		if (st == aov::A_WALK) set(CH_wheel, std::fmod(t * 4, PI * 2));
		set(CH_weapon, attacking ? -1.25 + 1.65 * extend : -1.25);
		bob_out = 0;
		return;
	}

	const bool beast = kind == K_BEAST;
	const bool archer = kind == K_ARCHER;
	// (the Egyptian spearmen / axemen / mercenaries fight with the hoplite's
	// stances: rig pose spear | slash)
	const bool hoplite = type == aov::U_HOPLITE || type == aov::U_HERO || pose == P_SPEAR || pose == P_SLASH;
	const bool hero = type == aov::U_HERO;
	double bob = 0, fwd = 0;

	if (st == aov::A_WALK) {
		const double p = t * (beast ? 7 : 10);
		const double sw = beast ? 0.5 : 0.6;
		set(CH_legL, -S(p) * sw); set(CH_legR, S(p) * sw);
		set(CH_shinL, 0.1 + std::max(0.0, C(p)) * 0.9); set(CH_shinR, 0.1 + std::max(0.0, -C(p)) * 0.9);
		bob = (1 - std::abs(C(p))) * (beast ? 1.2 : 0.8);
		set(CH_torso, beast ? 0.12 : 0.06, S(p) * 0.08, S(p) * 0.03);
		set(CH_head, beast ? -0.08 : -0.03, -S(p) * 0.06);
		set(CH_armL, S(p) * 0.5, 0, 0.06); set(CH_armR, -S(p) * 0.5, 0, -0.06);
		if (hoplite) {
			set(CH_armL, -0.55 + S(p) * 0.05, 0.25, 0.1);
			set(CH_armR, -0.15 - S(p) * 0.2, 0, -0.08);
			set(CH_weapon, 0.15 + S(p) * 0.2);
		}
		if (archer && pose != P_SLING) { set(CH_armL, -0.25 + S(p) * 0.3, 0, 0.08); set(CH_weapon, 0.2); }
		if (beast) { set(CH_armL, S(p) * 0.4, 0, 0.15); set(CH_armR, -S(p) * 0.4 - 0.2, 0, -0.15); set(CH_weapon, 0.6); }
		// (round 12, Egyptian men) the elbows soft on the walk, the forward
		// swinging forearm bending more, so the arms are not stiff sticks
		if (rig.stance > 0 && !beast) {
			set(CH_foreL, -0.2 - std::max(0.0, -S(p)) * 0.35); set(CH_foreR, -0.2 - std::max(0.0, S(p)) * 0.35);
		}
	} else if (st == aov::A_GATHER || st == aov::A_BUILD) {
		const int res = U.econ_res_type[row];
		if (st == aov::A_BUILD) {
			const double p = t * 9;
			const double s = std::max(0.0, S(p));
			set(CH_legL, -0.9); set(CH_shinL, 1.5); set(CH_legR, 0.25); set(CH_shinR, 1.2);
			bob = -3;
			set(CH_torso, 0.45); set(CH_head, -0.25);
			set(CH_armR, -1.0 - s * 1.1, 0, -0.1);
			set(CH_armL, -0.9, 0.3, 0.1);
		} else if (res == aov::RES_FOOD) {
			const double p = t * 4;
			set(CH_legL, -0.45); set(CH_shinL, 0.7); set(CH_legR, -0.2); set(CH_shinR, 0.5);
			bob = -1.2;
			set(CH_torso, 0.75 + S(p) * 0.06); set(CH_head, -0.5);
			set(CH_armR, -1.0 + S(p) * 0.45, 0, -0.2 + C(p) * 0.2);
			set(CH_armL, -1.1 - S(p + 1.5) * 0.35, 0, 0.1);
		} else {
			const double cyc = std::fmod(t * 0.9, 1.0);
			const double k = cyc < 0.7 ? smooth(cyc / 0.7) : 1 - smooth((cyc - 0.7) / 0.12);
			const double lift = res == aov::RES_GOLD ? 2.5 : 2.3;
			set(CH_legL, -0.35); set(CH_shinL, 0.25); set(CH_legR, 0.2); set(CH_shinR, 0.15);
			set(CH_torso, 0.35 - k * 0.45, -0.15);
			set(CH_head, 0.1 - k * 0.15);
			set(CH_armR, -0.6 - k * lift, 0, -0.05);
			set(CH_armL, -0.7 - k * (lift - 0.2), 0, 0.2);
			bob = -0.5 + k * 0.3;
		}
		if (rig.stance > 0 && !beast) {
			// (round 12, Egyptian men: rig "stance", arms split at the elbow)
			// work poses that carry weight: the hips dropped onto bent knees
			// (each leg solved so its foot or knee meets the ground: thigh 7 +
			// shin 7 rig voxels), the elbows bent, the shoulders driving into
			// every blow; the Greek villagers keep the poses above
			if (st == aov::A_BUILD) {
				// (round 13, unit_11) standing square to the scaffold, feet
				// apart, the front knee soft and the back leg braced; the free
				// hand steadies the beam, the mallet is lifted behind the head
				// on a bent elbow and driven in at chest height, the shoulders
				// and hips following it (a slow lift, a fast blow)
				const double cyc = std::fmod(t * 1.35 + uhash(id, 70), 1.0);
				const double k = cyc < 0.62 ? smooth(cyc / 0.62) : 1 - smooth((cyc - 0.62) / 0.14);
				set(CH_legL, -0.42, 0, 0.07); set(CH_shinL, 0.38);
				set(CH_legR, 0.3, 0, -0.07); set(CH_shinR, 0.14);
				set(CH_torso, 0.22 - k * 0.14, -0.1 - k * 0.12);
				set(CH_head, -0.18 - k * 0.1);
				set(CH_armR, ease(-1.2, -2.75, k), 0, -0.1); set(CH_foreR, ease(-0.3, -1.15, k));
				set(CH_armL, -0.95 + k * 0.1, 0.2, 0.18); set(CH_foreL, -0.7);
				bob = -0.85 - (1 - k) * 0.15;
			} else if (res == aov::RES_FOOD) {
				// squatting at the bush, both knees deep, reaching in and
				// pulling back with bent arms
				const double p = t * 4;
				set(CH_legL, -1.15, 0, 0.1); set(CH_shinL, 1.85);
				set(CH_legR, -0.6, 0, -0.1); set(CH_shinR, 1.6);
				set(CH_torso, 0.55 + S(p) * 0.06); set(CH_head, -0.35);
				set(CH_armR, -1.25 + S(p) * 0.35, 0, -0.15); set(CH_foreR, -0.45 - S(p) * 0.35);
				set(CH_armL, -1.2 - S(p + 1.5) * 0.3, 0, 0.12); set(CH_foreL, -0.5);
				bob = -5.8;
			} else {
				// chopping / mining in a lunge: the front knee bent over the
				// foot, the back leg braced; at the top of the swing the body
				// rises a little and the tool is cocked behind the head on bent
				// elbows, at the blow the hips drop and the shoulders follow the
				// tool down into the trunk or the rock
				const double cyc = std::fmod(t * 0.9, 1.0);
				const double k = cyc < 0.7 ? smooth(cyc / 0.7) : 1 - smooth((cyc - 0.7) / 0.12);
				const double tor = 0.55 - k * 0.5;
				set(CH_legL, -0.75 - (1 - k) * 0.1, 0, 0.08); set(CH_shinL, 1.0 + (1 - k) * 0.15);
				set(CH_legR, 0.4 + (1 - k) * 0.08, 0, -0.08); set(CH_shinR, 0.25 + (1 - k) * 0.1);
				set(CH_torso, tor, -0.15);
				set(CH_head, -0.2 - tor * 0.4);
				set(CH_armR, ease(-1.45, -2.95, k) , 0, -0.06); set(CH_foreR, ease(-0.15, -0.95, k));
				set(CH_armL, ease(-1.3, -2.8, k), 0, 0.16); set(CH_foreL, ease(-0.25, -0.9, k));
				bob = -2.1 - (1 - k) * 0.7;
			}
		}
	} else if (st == aov::A_WORSHIP) {
		const double s = S(t * 2);
		set(CH_armL, -2.7 + s * 0.15, 0, 0.35); set(CH_armR, -2.7 + s * 0.15, 0, -0.35);
		set(CH_head, -0.35); set(CH_torso, -0.1 + s * 0.03);
	} else if (attacking) {
		const double a = a_;
		if (archer) {
			archer_upper(v % 2);
			set(CH_arrow, 1.55 - out[CH_armR][0], 0, 0);
			set(CH_legL, -0.25); set(CH_legR, 0.25); set(CH_shinR, 0.15);
		} else if (beast && v == 1) {
			const double arc = -1.5 * wind + 1.2 * extend;
			set(CH_armR, -1.35 - 0.3 * wind, 0, -0.4 + arc * 0.9); set(CH_armL, -0.9 + 0.3 * extend, 0, 0.3);
			set(CH_weapon, 1.1, 0, 0);
			set(CH_foreR, -0.7 * wind - 0.2); set(CH_foreL, -0.6);
			set(CH_torso, 0.15 + 0.2 * extend, -0.6 * wind + 0.7 * extend, 0);
			set(CH_head, 0.1, 0.3 * wind - 0.3 * extend);
			set(CH_legL, -0.5); set(CH_shinL, 0.35); set(CH_legR, 0.45); set(CH_shinR, 0.3);
			bob = -1.2;
			fwd = 0.3 * extend - 0.1 * wind;
		} else if (beast) {
			const double up = wind * 1.0, down = extend;
			const double arm = -1.1 - up * 1.9 + down * 0.7;
			set(CH_armR, arm, 0, -0.15); set(CH_armL, arm + 0.1, 0, 0.35);
			set(CH_weapon, 0.4 + down * 0.4);
			set(CH_foreR, -0.3 - up * 0.6 + down * 0.25); set(CH_foreL, -0.35 - up * 0.5 + down * 0.2);
			set(CH_torso, -0.15 * up + 0.4 * down, 0.1);
			set(CH_head, 0.2 * down - 0.1 * up);
			set(CH_legL, -0.45); set(CH_shinL, 0.3); set(CH_legR, 0.35); set(CH_shinR, 0.25);
			bob = -1.5 * down;
			fwd = 0.35 * down - 0.12 * up;
		} else if (hoplite && !hero && (pose == P_SLASH || gear_of(id, type, U.kit[row]).kit == 1)) {
			const double arm = ease(ease(-1.5, -2.85, wind), -1.15, extend);
			const double tot = ease(ease(1.3, -0.55, wind), 2.1, extend);
			set(CH_armR, arm, 0.1 - 0.2 * wind + 0.35 * extend, -0.3 - 0.25 * wind + 0.3 * extend);
			set(CH_weapon, tot - arm);
			set(CH_armL, -1.35 + 0.15 * wind - 0.2 * extend, 0.55 - 0.25 * extend, 0.2);
			set(CH_torso, 0.1 + extend * 0.45 - wind * 0.15, -0.1 - wind * 0.4 + extend * 0.55);
			set(CH_head, -0.1 - extend * 0.15, 0.2 * wind - 0.2 * extend);
			set(CH_legL, -0.55 - extend * 0.35); set(CH_shinL, 0.4); set(CH_legR, 0.4 + extend * 0.3); set(CH_shinR, 0.4);
			bob = -1.4 - extend * 0.8;
			fwd = 0.38 * extend - 0.12 * wind;
		} else if (hoplite && av == 3) {
			const double arm = -1.2 - extend * 0.5 + wind * 0.3;
			set(CH_armR, arm, 0.2, -0.25);
			set(CH_weapon, 1.57 - arm - 0.35);
			set(CH_armL, -2.0 + extend * 0.2, 0.3, 0.35);
			set(CH_torso, 0.35 + extend * 0.15, 0.25 - extend * 0.4);
			set(CH_head, -0.3);
			set(CH_legL, -0.9 - extend * 0.2); set(CH_shinL, 0.9); set(CH_legR, 0.6); set(CH_shinR, 0.7);
			bob = -2.6;
			fwd = (hero ? 0.4 : 0.22) * extend - 0.06 * wind;
		} else if (hoplite && av == 1) {
			const double arm = -0.85 + wind * 0.45 - extend * 0.75;
			set(CH_armR, arm, 0.15, -0.2);
			set(CH_weapon, 1.57 - arm - 0.1);
			set(CH_armL, -1.3 + extend * 0.2, 0.6, 0.2);
			set(CH_torso, 0.25 + extend * 0.5 - wind * 0.2, 0.35 - extend * 0.6 + wind * 0.3);
			set(CH_head, -0.2 - extend * 0.2);
			set(CH_legL, -0.75 - extend * 0.3); set(CH_shinL, 0.55); set(CH_legR, 0.5 + extend * 0.3); set(CH_shinR, 0.5);
			bob = -2.0 - extend * 0.6;
			fwd = (hero ? 0.55 : 0.4) * extend - 0.14 * wind;
		} else if (hoplite && av == 2) {
			const double bash = smooth((a - 0.45) / 0.25) * (1 - wind);
			const double arm = -2.6 - wind * 0.45 + extend * 0.6;
			set(CH_armR, arm, 0.1, -0.15 - wind * 0.15);
			set(CH_weapon, 1.57 + 0.45 - arm);
			set(CH_armL, -1.2 - bash * 0.55, 0.45 - bash * 0.3, 0.15);
			set(CH_torso, 0.2 + extend * 0.5 + bash * 0.2 - wind * 0.15, -0.1 + extend * 0.25);
			set(CH_head, -0.1);
			set(CH_legL, -0.6); set(CH_shinL, 0.45); set(CH_legR, 0.4); set(CH_shinR, 0.4);
			bob = -1.5;
			fwd = (hero ? 0.45 : 0.25) * std::max(extend, bash) - 0.05 * wind;
		} else if (hoplite) {
			const double arm = -2.2 - wind * 0.85 + extend * 0.75;
			set(CH_armR, arm, 0.1 - wind * 0.15, -0.12 - wind * 0.2);
			set(CH_weapon, 1.57 + 0.18 - arm + wind * 0.55);
			set(CH_armL, -1.15 + wind * 0.2, 0.45, 0.15 + wind * 0.15);
			set(CH_torso, 0.08 + extend * 0.5 - wind * 0.22, -0.2 + extend * 0.4 - wind * 0.25);
			set(CH_head, -0.05 - extend * 0.2 + wind * 0.1);
			set(CH_legL, -0.5 - extend * 0.35); set(CH_shinL, 0.35); set(CH_legR, 0.35 + extend * 0.3); set(CH_shinR, 0.35);
			bob = -1.2 - extend * 0.8;
			fwd = (hero ? 0.6 : 0.42) * extend - 0.14 * wind;
		} else {
			const double arm = -1.0 - wind * 1.6 + extend * 0.8;
			set(CH_armR, arm, 0, -0.1); set(CH_armL, -0.8, 0, 0.15);
			set(CH_torso, 0.15 + extend * 0.2);
			set(CH_legL, -0.3); set(CH_legR, 0.25);
		}
		if (hoplite) {
			const double step = extend - 0.5 * wind;
			add(CH_legL, -0.3 * step); add(CH_shinL, 0.2 * std::max(0.0, step)); add(CH_legR, 0.25 * step); add(CH_shinR, 0.25 * std::max(0.0, -step));
		}
	} else if (st == aov::A_DIE) {
		const double dT = die_t;
		const double hit = smooth(dT / 0.1) * (1 - smooth((dT - 0.1) / 0.2));
		const double buckle = smooth(dT / 0.32);
		const double side = id % 2 ? 1 : -1;
		if (beast) {
			const double curl = smooth((dT - 0.3) / 0.6);
			set(CH_legL, -0.95 * buckle - 0.45 * curl, 0, 0.1 * curl); set(CH_shinL, 1.55 * buckle + 0.35 * curl);
			set(CH_legR, -0.6 * buckle - 0.8 * curl, 0, -0.1 * curl); set(CH_shinR, 1.35 * buckle + 0.5 * curl);
			set(CH_torso, -0.35 * hit + 0.45 * buckle + 0.25 * curl, 0.15 * side * curl, 0);
			set(CH_head, -0.3 * hit + 0.5 * buckle - 0.2 * curl, 0.35 * side * curl, -0.25 * side * curl);
			set(CH_armL, -0.9 * buckle - 0.5 * curl, 0, 0.25 + 0.5 * hit + 0.35 * curl);
			set(CH_armR, -0.4 * buckle - 1.4 * curl, 0, -0.3 - 0.6 * hit - 0.2 * curl);
			set(CH_weapon, 0.3 + 0.6 * curl);
			bob = -7 * buckle;
		} else {
			const double fall = smooth((dT - 0.18) / 0.5);
			const double up = 1 - fall;
			const double sp = 0.8 + uhash(id, 71) * 0.5;
			set(CH_legL, -0.95 * buckle * up - 0.08 * fall, 0, 0.1 + 0.22 * fall); set(CH_shinL, 1.55 * buckle * up + 0.2 * fall * uhash(id, 72));
			set(CH_legR, -0.6 * buckle * up + 0.1 * fall, 0, -0.1 - 0.28 * fall); set(CH_shinR, 1.35 * buckle * up + 0.35 * fall * uhash(id, 73));
			set(CH_torso, -0.35 * hit + 0.45 * buckle * up, 0.12 * side * fall, 0);
			set(CH_head, -0.3 * hit + 0.5 * buckle * up, 0.75 * side * fall, 0.15 * side * fall);
			set(CH_armL, -0.9 * buckle * up - 0.35 * fall, 0, 0.25 + 0.5 * hit + 1.1 * sp * fall);
			set(CH_armR, -0.4 * buckle * up - 0.6 * fall * uhash(id, 74), 0, -0.3 - 0.6 * hit - 1.0 * sp * fall);
			set(CH_weapon, 0.3);
			bob = -4.2 * buckle * up;
		}
		set(CH_shield, 0);
		set(CH_arrow, 0);
	} else {
		// idle
		const double b = S(t * 1.7);
		set(CH_torso, 0.02 + b * 0.015, S(t * 0.37) * 0.06);
		set(CH_head, S(t * 0.9) * 0.04, S(t * 0.53) * 0.3 * clamp01(S(t * 0.21) * 3));
		set(CH_armL, b * 0.03, 0, 0.07); set(CH_armR, -b * 0.03, 0, -0.07);
		set(CH_legL, -0.04, 0, 0.03); set(CH_legR, 0.04, 0, -0.03);
		// (the Egyptian spear / slash rigs stand at ease: the haft upright and
		// held out from the body, the shield low at the side, so in a crowd no
		// man's levelled spear or raised shield covers his neighbour)
		const bool eg_ease = pose == P_SPEAR || pose == P_SLASH;
		if (hoplite && eg_ease) {
			set(CH_armL, -0.25, 0.15, 0.16); set(CH_armR, -0.22 - b * 0.02, 0, -0.32); set(CH_weapon, 0.12, 0, 0.3);
		} else if (hoplite && v == 1) {
			set(CH_armL, -1.1, 0.45, 0.15); set(CH_armR, -2.2 + b * 0.04, 0.1, -0.12); set(CH_weapon, 1.57 + 0.2 + 2.2);
			set(CH_torso, 0.12 + b * 0.02, -0.2); set(CH_legL, -0.45); set(CH_shinL, 0.35); set(CH_legR, 0.3); set(CH_shinR, 0.3);
			bob = -1.1;
		} else if (hoplite && v == 2) {
			set(CH_armR, -0.55, 0, -0.25); set(CH_weapon, 0.55, 0, 0.25);
			set(CH_armL, -0.15, 0.1, 0.12); set(CH_torso, 0.06, 0.2 + S(t * 0.37) * 0.1, -0.04);
			set(CH_legL, -0.15, 0, 0.1); set(CH_legR, 0.12, 0, -0.02);
		} else if (hoplite) { set(CH_armL, -0.45, 0.2, 0.32); set(CH_armR, -0.3, 0, -0.3); set(CH_weapon, 0.2, 0, 0.18); }
		if (rig.stance > 0 && !beast) {
			// (Egyptian men, rig "stance") a relaxed stride: one foot forward, the
			// weight on the back leg, the hips turned a little; the slinger lets
			// the sling hang and sway from a fist held off the hip
			const bool mr = (id & 1) != 0;
			const double k = rig.stance;
			set(CH_legL, (mr ? -0.22 : 0.14) * k, 0, 0.04); set(CH_shinL, (mr ? 0.2 : 0.05) * k);
			set(CH_legR, (mr ? 0.14 : -0.22) * k, 0, -0.04); set(CH_shinR, (mr ? 0.05 : 0.2) * k);
			add(CH_torso, 0, (mr ? 0.1 : -0.1) * k, 0);
			bob = -0.2 * k;
			if (pose == P_SLING) { set(CH_armR, -0.35 + b * 0.03, 0, -0.26); set(CH_weapon, 0.6 + S(t * 1.6) * 0.25, 0, -0.4); set(CH_armL, -0.12, 0, 0.16); }
			else if (!hoplite) { add(CH_armL, -0.08, 0, 0.07); add(CH_armR, 0.06, 0, -0.07); }
		}
		if (rig.idles && !beast) {
			// (round 24, rig "idles": the Mummy) four idles by the unit id, so a
			// group never stands in one stiff pose: 0 the weight on the right leg,
			// the left knee bent, the hip dropped, the blade hanging low; 1 the
			// blade resting on the right shoulder, the weight on the left leg;
			// 2 slumped forward, the arms dangling, one foot back; 3 the weight on
			// the left leg, the blade held low across the body
			const int iv = (int)((id * 3 + 1) & 3);
			const double sw = S(t * 0.8 + id) * 0.03;
			if (iv == 0) {
				set(CH_legR, 0.03, 0, -0.07); set(CH_shinR, 0.02);
				set(CH_legL, -0.2, 0.2, 0.12); set(CH_shinL, 0.42);
				set(CH_torso, 0.04, 0.15, 0.08); set(CH_head, 0.04 + sw, -0.25, -0.1);
				set(CH_armR, 0.04 + sw, 0, -0.16); set(CH_foreR, -0.15); set(CH_weapon, IDLE_BLADE_LOW);
				set(CH_armL, -0.05, 0, 0.12); set(CH_foreL, -0.35);
				bob = -0.25;
			} else if (iv == 1) {
				set(CH_legL, 0.03, 0, 0.07); set(CH_shinL, 0.02);
				set(CH_legR, -0.18, -0.2, -0.12); set(CH_shinR, 0.4);
				set(CH_torso, 0.02, -0.18, -0.08); set(CH_head, 0.02, 0.3 + sw, 0.08);
				set(CH_armR, -0.55, 0.2, -0.32); set(CH_foreR, -2.0); set(CH_weapon, IDLE_BLADE_SHOULDER);
				set(CH_armL, -0.1 + sw, 0, 0.1); set(CH_foreL, -0.2);
				bob = -0.25;
			} else if (iv == 2) {
				set(CH_legL, -0.04, 0, 0.06); set(CH_shinL, 0.22);
				set(CH_legR, 0.2, 0, -0.06); set(CH_shinR, 0.28);
				set(CH_torso, 0.16 + sw, 0.1, 0.05); set(CH_head, 0.18, -0.35, 0.2);
				set(CH_armL, -0.3 + sw, 0, 0.06); set(CH_foreL, -0.4);
				set(CH_armR, -0.28 - sw, 0, -0.1); set(CH_foreR, -0.45); set(CH_weapon, 0.5);
				bob = -0.5;
			} else {
				set(CH_legL, 0.02, 0, 0.06); set(CH_shinL, 0.02);
				set(CH_legR, -0.1, -0.12, -0.06); set(CH_shinR, 0.28);
				set(CH_torso, 0.04, -0.1, -0.05); set(CH_head, 0.05, 0.4, 0.06 + sw);
				set(CH_armR, -0.35, 0, 0.12); set(CH_foreR, -0.85); set(CH_weapon, IDLE_BLADE_ACROSS);
				set(CH_armL, -0.05, 0, 0.14); set(CH_foreL, -0.3 + sw);
				bob = -0.25;
			}
		}
		const bool ordered_attack = U.order_type[row] == aov::O_ATTACK;
		if (hoplite && (ordered_attack || U.combat_line[row]) && !hero) {
			const int rv = (int)std::floor(uhash(id, 60 + (int)std::floor(t / 2.7 + uhash(id, 61) * 5)) * 3);
			const double sw = S(t * 2.3) * 0.05;
			bob = 0;
			const bool holding = U.combat_line[row] && !ordered_attack;
			const int hv = holding ? (int)std::floor(uhash(id, 66 + (int)std::floor(t / 3.1 + uhash(id, 67) * 5)) * 4) : -1;
			if (hv == 0 || hv == 1) {
				set(CH_armL, -1.2 + sw, 0.45, 0.2); set(CH_armR, -0.55, 0, -0.28); set(CH_weapon, 0.7 - hv * 0.25, 0, 0.12);
				set(CH_torso, 0.12 + hv * 0.1, -0.15); set(CH_head, -0.05, (uhash(id, 68) - 0.5) * 0.6);
				set(CH_legL, -0.4); set(CH_shinL, 0.3); set(CH_legR, 0.3); set(CH_shinR, 0.3);
				bob = -0.8 - hv * 0.6;
			} else if (hv == 2) {
				set(CH_armL, -1.35 + sw, 0.5, 0.25); set(CH_armR, -0.75, 0.1, -0.3); set(CH_weapon, 1.15, 0, 0.1);
				set(CH_torso, 0.32, -0.2); set(CH_head, -0.2);
				set(CH_legL, -0.8); set(CH_shinL, 0.8); set(CH_legR, 0.55); set(CH_shinR, 0.7);
				bob = -2.2;
			} else if (rv == 0) {
				set(CH_armL, -1.75 + sw, 0.45, 0.35); set(CH_armR, -2.35, 0.15, -0.3); set(CH_weapon, 1.57 + 0.2 + 2.35);
				set(CH_torso, 0.2, -0.25); set(CH_head, -0.15);
				set(CH_legL, -0.6); set(CH_shinL, 0.5); set(CH_legR, 0.4); set(CH_shinR, 0.45);
				bob = -1.6;
			} else if (rv == 1) {
				set(CH_armR, -0.95, 0.2, -0.35); set(CH_weapon, 1.57 + 0.95 - 0.12, 0, 0.1);
				set(CH_armL, -1.25 + sw, 0.55, 0.35); set(CH_torso, 0.28, 0.3); set(CH_head, -0.25);
				set(CH_legL, -0.8); set(CH_shinL, 0.6); set(CH_legR, 0.55); set(CH_shinR, 0.35);
				bob = -2.0;
			} else {
				set(CH_armL, -1.05, 0.7, 0.2); set(CH_armR, -1.6 + sw, 0.1, -0.4); set(CH_weapon, 1.57 + 1.6 - 0.5);
				set(CH_torso, -0.12, -0.35); set(CH_head, 0.1, 0.3);
				set(CH_legL, -0.15); set(CH_shinL, 0.1); set(CH_legR, 0.7); set(CH_shinR, 0.8);
				bob = -1.2;
			}
		}
		if (archer && pose != P_SLING) archer_upper(v % 2);
		if (beast) {
			set(CH_torso, 0.1 + b * 0.03);
			set(CH_armR, -0.25, 0, -0.15); set(CH_armL, b * 0.05, 0, 0.18); set(CH_weapon, 0.4);
			set(CH_legL, -0.15, 0, 0.05); set(CH_shinL, 0.2); set(CH_legR, 0.1, 0, -0.05); set(CH_shinR, 0.2);
			set(CH_foreR, -0.55); set(CH_foreL, -0.3 + b * 0.05);
			bob = -0.3 + b * 0.2;
		}
	}
	if (beast && st == aov::A_WALK) { set(CH_foreR, -0.45 + S(t * 7) * 0.2); set(CH_foreL, -0.35 - S(t * 7) * 0.2); }

	// hit reactions (hitReact)
	const double ht = U.hit_t[row];
	if (st != aov::A_DIE && !std::isnan(ht)) {
		const int n = U.hit_n[row];
		const int hv0 = (int)std::floor(uhash(id, 30 + n * 3) * 4);
		const double dur = hv0 == 3 ? 1.25 : 0.75;
		if (ht < dur) {
			const double w = smooth(ht / 0.07) * (1 - smooth((ht - dur * 0.5) / (dur * 0.5)));
			const double sd = uhash(id, 31 + n * 3) < 0.5 ? 1 : -1;
			auto mix = [&](int c, double x, double y = 0, double z = 0) {
				out[c][0] += (float)((x - out[c][0]) * w); out[c][1] += (float)((y - out[c][1]) * w); out[c][2] += (float)((z - out[c][2]) * w);
			};
			const int hv = beast || hero ? (hv0 == 2 ? 2 : 0) : hv0;
			const double k = beast ? 0.5 : hero ? 0.6 : 1;
			if (hv == 0) {
				add(CH_torso, -0.5 * w * k); add(CH_head, -0.55 * w * k);
				add(CH_armR, 0.35 * w * k, 0, -0.55 * w * k); add(CH_armL, 0, 0, 0.35 * w * k);
				mix(CH_legR, 0.5 * k, 0, -0.05); mix(CH_shinR, 0.4 * k); mix(CH_legL, -0.25 * k);
				fwd -= 0.34 * w * k;
			} else if (hv == 1) {
				add(CH_torso, 0.15 * w, 0.75 * sd * w, 0.3 * sd * w); add(CH_head, 0.25 * w, 0.45 * sd * w, 0.25 * sd * w);
				add(CH_armR, 0.3 * w, 0, -0.4 * w); add(CH_weapon, -0.5 * w, 0, 0.3 * sd * w);
				mix(CH_legL, -0.55); mix(CH_shinL, 0.9); mix(CH_legR, 0.4, 0, -0.15); mix(CH_shinR, 0.35);
				bob -= 1.6 * w; fwd -= 0.14 * w;
			} else if (hv == 2) {
				mix(CH_armL, -1.75 * (beast ? 0.6 : 1), 0.5, 0.2); mix(CH_legL, -0.8 * k); mix(CH_shinL, 1.0 * k); mix(CH_legR, 0.55 * k); mix(CH_shinR, 0.9 * k);
				mix(CH_torso, 0.5 * k, -0.25); mix(CH_head, -0.1);
				bob -= 2.8 * w * k; fwd -= 0.1 * w;
			} else {
				mix(CH_legL, -1.45, 0, 0.1); mix(CH_shinL, 1.45); mix(CH_legR, 0.25, 0, -0.1); mix(CH_shinR, 1.65);
				mix(CH_torso, 0.55, 0.2 * sd); mix(CH_head, 0.4); mix(CH_armR, -0.35, 0, -0.55); mix(CH_armL, -0.7, 0.2, 0.35);
				mix(CH_weapon, 0.95, 0, 0.2);
				bob -= 6.2 * w; fwd -= 0.16 * w;
			}
		}
	}
	if (type == aov::U_HOPLITE && st != aov::A_DIE) {
		add(CH_weapon, (uhash(id, 11) - 0.5) * 0.3, 0, (uhash(id, 12) - 0.5) * 0.16);
		add(CH_shield, (uhash(id, 13) - 0.5) * 0.25, (uhash(id, 14) - 0.5) * 0.5, (uhash(id, 15) - 0.5) * 0.3);
		add(CH_head, (uhash(id, 17) - 0.5) * 0.2, (uhash(id, 16) - 0.5) * 0.5, (uhash(id, 18) - 0.5) * 0.2);
	}
	if (!beast && (st == aov::A_IDLE || attacking) && type != aov::U_VILLAGER) {
		const double w = 0.13 + uhash(id, 62) * 0.1;
		if (rig.stance > 0) {
			// (round 12, Egyptian men) feet a little apart under the hips, the
			// shins straight under the knees: no knock-kneed, pigeon-toed A
			add(CH_legL, 0, 0, w * 0.35); add(CH_legR, 0, 0, -w * 0.35); add(CH_shinL, 0, 0, -w * 0.3); add(CH_shinR, 0, 0, w * 0.3);
			bob -= w * 0.5;
		} else {
			add(CH_legL, 0, 0, w); add(CH_legR, 0, 0, -w); add(CH_shinL, 0, 0, -w * 0.6); add(CH_shinR, 0, 0, w * 0.6);
			bob -= w * 2;
		}
	}
	if (st == aov::A_IDLE && !beast) {
		const double g = smooth((S(t * (0.3 + uhash(id, 42) * 0.25) + uhash(id, 43) * 6.28) - 0.55) * 3);
		const double sd = uhash(id, 44) < 0.5 ? 1 : -1;
		add(CH_torso, 0.04 * g, 0.35 * sd * g, 0.05 * sd * g); add(CH_head, 0, 0.4 * sd * g);
		add(CH_legL, -0.2 * g); add(CH_shinL, 0.15 * g); add(CH_legR, 0.1 * g, 0, -0.08 * g);
		add(CH_armR, -0.25 * g); add(CH_weapon, 0.2 * g);
		bob -= 0.4 * g;
	}
	if (hoplite && st != aov::A_DIE && rig.has_shield) out[CH_shield][0] -= out[CH_armL][0] + out[CH_torso][0] + 0.35f;
	if (archer && st != aov::A_DIE) {
		add(CH_torso, (uhash(id, 50) - 0.5) * 0.12, (uhash(id, 51) - 0.5) * 0.35, 0);
		add(CH_weapon, 0, (uhash(id, 52) - 0.5) * 0.3, (uhash(id, 53) - 0.5) * 0.4);
		add(CH_head, (uhash(id, 54) - 0.5) * 0.25, (uhash(id, 55) - 0.5) * 0.4);
		if (attacking) {
			const double wide = uhash(id, 56);
			add(CH_legL, -0.25 * wide, 0, 0.1 * wide); add(CH_legR, 0.2 * wide, 0, -0.12 * wide); add(CH_shinR, 0.2 * wide);
			bob -= wide * 0.5;
		}
	}
	bob_out = (float)bob;
	fwd_out = (float)fwd;
}

// ---- BattleFX.hit / death + Particles.emit, closed form -------------------------

namespace {
struct FxOut {
	AovUnitView::Buf *sparks, *dust, *chips;
	const aov::GameMap *map;
};
const size_t MAX_SPARK = 6000, MAX_DUST = 4000, MAX_CHIP = 8000;

inline Col hexc(uint32_t h) { return hex_lin(h); }

// drag k per second on x/z (and y for dust), gravity g: position after t seconds
inline double drift(double v0, double k, double t) { return k > 0 ? v0 * (1 - std::exp(-k * t)) / k : v0 * t; }
inline double drift_g(double v0, double k, double g, double t) {
	if (k <= 0) return v0 * t + 0.5 * g * t * t;
	const double vt = g / k;
	return vt * t + (v0 - vt) * (1 - std::exp(-k * t)) / k;
}
inline double vel_g(double v0, double k, double g, double t) {
	if (k <= 0) return v0 + g * t;
	const double vt = g / k;
	return vt + (v0 - vt) * std::exp(-k * t);
}

// BattleFX.spark
void spark(FxOut &o, VRng &r, double age, double x, double y, double z, int count, Col col, double bright, double size,
		double life, double speed, double up, double gravity, double dx, double dz, double cone) {
	const double base = (dx != 0 || dz != 0) ? std::atan2(dz, dx) : 0;
	for (int n = 0; n < count; n++) {
		const double a = (dx != 0 || dz != 0) ? base + r.range(-cone, cone) : r.range(0, PI * 2), sp = speed * r.range(0.45, 1);
		const double px = x + r.range(-0.06, 0.06), py = y + r.range(-0.06, 0.06), pz = z + r.range(-0.06, 0.06);
		const double vx = std::cos(a) * sp, vy = up * r.range(0.4, 1.3), vz = std::sin(a) * sp;
		const double sz = size * r.range(0.7, 1.3);
		const double lf = life * r.range(0.6, 1.3);
		if (age >= lf || o.sparks->n >= (int)MAX_SPARK) continue;
		const double t = 1 - (lf - age) / lf;
		const double X = px + drift(vx, 3, age), Z = pz + drift(vz, 3, age), Y = py + drift_g(vy, 3, gravity, age);
		const double VX = vx * std::exp(-3 * age), VZ = vz * std::exp(-3 * age), VY = vel_g(vy, 3, gravity, age);
		const double al = std::min(1.0, (1 - t) * 1.8);
		o.sparks->push(xl(X, Y, Z), (float)(col.r * bright), (float)(col.g * bright), (float)(col.b * bright), (float)al,
				(float)(sz * (1 - 0.3 * t)), (float)VX, (float)VY, (float)VZ);
	}
}

// BattleFX.puff
void puff(FxOut &o, VRng &r, double age, double x, double z, int count, double size, double life, double alpha, double speed,
		double up, uint32_t color, double spread, double y, double dx, double dz) {
	const double gy = o.map->height_at(x, z);
	const Col c = hexc(color);
	for (int n = 0; n < count; n++) {
		const double a = r.range(0, PI * 2), sp = speed * r.range(0.3, 1);
		const double px = x + r.range(-spread, spread), py = gy + y + r.range(0, 0.2), pz = z + r.range(-spread, spread);
		const double vx = std::cos(a) * sp + dx, vy = up * r.range(0.5, 1.2), vz = std::sin(a) * sp + dz;
		const double k = r.range(0.9, 1.08);
		const double base = size * r.range(0.75, 1.25);
		const double a0 = alpha * r.range(0.7, 1.1);
		const double lf = life * r.range(0.7, 1.2);
		if (age >= lf || o.dust->n >= (int)MAX_DUST) continue;
		const double t = 1 - (lf - age) / lf;
		const double al = a0 * std::min(1.0, t * 4) * (1 - t * t);
		o.dust->push(xl(px + drift(vx, 1.2, age), py + drift(vy, 1.2, age), pz + drift(vz, 1.2, age)),
				(float)(c.r * k), (float)(c.g * k), (float)(c.b * k), (float)al, (float)(base * (1 + 0.7 * std::sqrt(t))),
				(float)std::fmod(std::abs(px * 3.17 + pz * 1.91), 1.0), 0, 0);
	}
}

// Particles.emit (the solid pool: flat square chips)
void emit(FxOut &o, VRng &r, double age, double x, double y, double z, int count, Col c, double cv, double size, double life,
		double speed, double up, double gravity, double spread, double drag = 1) {
	for (int i = 0; i < count; i++) {
		const double a = r.range(0, PI * 2), sp = speed * r.range(0.3, 1);
		const double px = x + r.range(-spread, spread), py = y + r.range(-spread, spread) * 0.5, pz = z + r.range(-spread, spread);
		const double k = 1 + r.range(-cv, cv);
		const double sz = size * r.range(0.7, 1.3), lf = life * r.range(0.6, 1.2);
		const double vx = std::cos(a) * sp, vy = up * r.range(0.5, 1.5), vz = std::sin(a) * sp;
		if (age >= lf || o.chips->n >= (int)MAX_CHIP) continue;
		const double t = 1 - (lf - age) / lf;
		double Y = py + drift_g(vy, drag, gravity, age);
		const double gy = o.map->height_at(px, pz) + 0.03;
		if (Y < gy) Y = gy; // chips settle on the ground instead of sinking through it
		o.chips->push(xl(px + drift(vx, drag, age), Y, pz + drift(vz, drag, age)), (float)(c.r * k), (float)(c.g * k), (float)(c.b * k),
				(float)std::min(1.0, (1 - t) * 1.6), (float)sz, 0, 0, 0);
	}
}
} // namespace

void AovUnitView::emit_fx(const HitRec &h, double now) {
	const double age = now - h.time;
	if (age < 0) return;
	FxOut o{ &sparks_, &dust_, &chips_, &sim_ref_->sim().map() };
	VRng r(h.seed);
	const double x = h.x, z = h.z, y = h.y;
	if (h.kind == 3) {
		const double big = h.scale;
		puff(o, r, age, x, z, (int)std::lround(2 * big), 0.8 * big, 1.2, 0.25, 0.5, 0.05, 0x6e5236, 0.35, 0.05, 0, 0);
		emit(o, r, age, x, y + 0.3, z, 6, hexc(0x8a6e4e), 0.1, 0.22, 0.8, 1.8, 1.2, -6, 0.3);
		return;
	}
	if (h.kind == 4) { // BattleFX.scuff: dust and clods kicked up where a pair fights
		if (r.chance(0.55)) {
			const double sz = r.range(1.1, 1.7), al = r.range(0.26, 0.36);
			puff(o, r, age, x, z, 1, sz, 1.8, al, 0.25, 0.04, r.chance(0.6) ? 0xc9b48e : 0xa88c66, 0.4, 0.42, 0, 0);
		}
		if (r.next() < 0.6) emit(o, r, age, x, o.map->height_at(x, z) + 0.1, z, 4, hexc(r.chance(0.5) ? 0xd6c29a : 0x6e4e2e), 0.1, 0.12, 0.45, 1.4, 2.0, -13, 0.3);
		return;
	}
	if (h.kind == 5) { // charging cavalry
		puff(o, r, age, x + h.bx * 0.4, z + h.bz * 0.4, 1, 1.2, 1.6, 0.3, 0.3, 0.05, 0x6e5236, 0.35, 0.08, h.bx, h.bz);
		return;
	}
	if (h.kind == 2) {
		emit(o, r, age, x, y, z, 5, hexc(0xb8a888), 0.1, 0.16, 0.5, 2, 2.5, -12, 0.3);
		puff(o, r, age, x + r.range(-1, 1), z + r.range(-1, 1), 1, 1.2, 1.8, 0.3, 0.6, 0.05, 0xb0a48c, 0.35, 1.0, 0, 0);
		return;
	}
	if (h.kind == 1) {
		if (r.chance(0.5)) emit(o, r, age, x, y, z, 3, hexc(0x7a0c08), 0.1, 0.08, 0.4, 1.2, 1.2, -12, 0.05);
		else emit(o, r, age, x, y, z, 3, hexc(0xb08850), 0.1, 0.07, 0.4, 1.6, 1.6, -12, 0.05);
		return;
	}
	// melee
	const bool big = h.big;
	const double bx = h.bx, bz = h.bz;
	const double rad = h.scale;
	const double px = x - bx * rad * 0.8, pz = z - bz * rad * 0.8; // contact point, towards the attacker
	const bool landed = big || r.next() < 0.75;
	const double gy = o.map->height_at(x, z);
	if (landed) {
		const double k = big ? r.range(1.1, 1.3) : r.range(0.5, 1.15);
		const Col hot = hexc(r.chance(0.5) ? 0xffb040 : 0xffd060); // warm, never the victim's dye
		spark(o, r, age, px, y, pz, 1, hexc(0xfff0d0), 1.2 + 0.5 * k, 0.3 + 0.2 * k, 0.12 + 0.1 * k, 0.4, 0.2, 0, bx, bz, 0.2);
		// the flash where the blow lands: a small, brief white-hot core in an
		// orange glow, off both team colours so it reads as a strike
		// An impact burst (spark.gdshader burst mode, flagged by a negative
		// size): a 20-30 px star of a white-hot core, an orange-yellow glow
		// and a few rays, popping open and fading over ~0.35 s so two or
		// three stay on screen along a busy front line.
		{
			const double fl = 0.3 + 0.08 * k + (big ? 0.08 : 0.0);
			const float rays = (float)r.next();
			if (age < fl && o.sparks->n < (int)MAX_SPARK) {
				const double t = age / fl;
				o.sparks->push(xl(px, y + 0.05, pz), 0.7f, 0.17f, 0.012f, (float)(1.0 - t * t),
						(float)(-(big ? 1.3 : 1.0) * (0.85 + 0.25 * k)), (float)t, rays, 0);
			}
		}
		// 4-6 hot voxel sparks flying out of the burst (HDR-bright chips that
		// cool from yellow-white to orange as they fall)
		{
			const int nh = r.irange(4, 6);
			for (int q = 0; q < nh; q++) {
				const double cool = std::min(1.0, age / 0.5);
				const Col hc = { (float)(1.0 - 0.3 * cool), (float)(0.42 - 0.3 * cool), (float)(0.04 - 0.03 * cool) };
				emit(o, r, age, px, y + 0.05, pz, 1, hc, 0.08, 0.22, 0.65, 4.2, 3.6, -20, 0.05);
			}
		}
		// a small brown dust puff kicked up at the struck man's feet: darker
		// than the tan dirt so it reads against it
		puff(o, r, age, x, z, 4, 1.2 + 0.3 * k, 1.0, 0.7, 0.9, 0.35, r.chance(0.5) ? 0x6a4a2c : 0x7e5c38, 0.55, 0.5, bx * 0.5, bz * 0.5);
		// 3-5 voxel debris thrown off the struck man: bronze, splinters, his dye
		{
			const int nd = r.irange(3, 5);
			for (int q = 0; q < nd; q++) {
				const uint32_t dc = q == 0 ? 0xd8a048 : (q == 1 ? 0x6a4424 : 0);
				const Col c = dc ? hexc(dc) : Col{ h.tr, h.tg, h.tb };
				emit(o, r, age, px, y + 0.05, pz, 1, c, 0.12, 0.24, 0.7, 3.2, 3.4, -18, 0.06);
			}
		}
		const int n = (int)std::lround((big ? 10 : 5) + 6 * k * r.range(0.7, 1.2));
		const uint32_t c2 = r.chance(0.5) ? 0xff9a30 : 0xffc050;
		const double b2 = 1.8 + 1.2 * k, s2 = 1.2 + 1.2 * k, l2 = 0.3 + 0.25 * k, sp2 = r.range(5, 9) * (0.6 + 0.5 * k), u2 = r.range(1.5, 3.5), cn2 = r.range(0.35, 0.7);
		spark(o, r, age, px, y, pz, n, hexc(c2), b2, s2, l2, sp2, u2, -18, bx, bz, cn2);
		const int n3 = r.irange(4, 7);
		const double sp3 = r.range(4, 7);
		spark(o, r, age, px, y, pz, n3, hot, 2.2, 1.2 + 0.8 * k, 0.35 + 0.15 * k, sp3, 2.2, -16, bx, bz, 0.8);
		const int n4 = r.irange(2, 3);
		const double sp4 = r.range(3, 5);
		spark(o, r, age, px, y, pz, n4, hexc(0xffd890), 1.6, 0.9, 0.25, sp4, 2.8, -18, -bx, -bz, 0.6);
		for (int q = 0; q < 4; q++) {
			const double a = std::atan2(bz, bx) + (q - 1.5) * 0.8 + r.range(-0.3, 0.3);
			puff(o, r, age, x + std::cos(a) * 0.35, z + std::sin(a) * 0.35, 1, 0.8 + 0.4 * k, 1.1, 0.42, 0.1, 0.15, 0xcdb896, 0.08, 0.4, std::cos(a) * 1.2, std::sin(a) * 1.2);
		}
	}
	const Col team = { h.tr, h.tg, h.tb };
	emit(o, r, age, px, y, pz, big ? 6 : 3, hexc(0xc08a3e), 0.25, 0.12, 0.7, 2.6, 3.0, -16, 0.12);
	emit(o, r, age, px + bx * 0.15, y - 0.1, pz + bz * 0.15, big ? 6 : 4, team, 0.15, 0.12, 0.75, 2.8, 2.6, -16, 0.1);
	if (r.chance(0.4)) emit(o, r, age, px, y - 0.1, pz, r.irange(4, 6), hexc(0x7a0e08), 0.2, 0.14, 0.55, 2.0, 2.0, -12, 0.1);
	const double fx0 = x + bx * 0.25, fz0 = z + bz * 0.25;
	puff(o, r, age, fx0, fz0, 2, big ? 1.5 : 1.0, 1.2, 0.4, 0.3, 0.05, 0xd2bf98, 0.1, 0.08, bx * 0.8, bz * 0.8);
	emit(o, r, age, fx0, gy + 0.12, fz0, r.irange(3, 5), hexc(0x5a3e22), 0.2, 0.13, 0.55, 1.2, 2.4, -14, 0.2);
	emit(o, r, age, fx0, gy + 0.12, fz0, big ? 8 : 5, hexc(0xc8ac80), 0.12, big ? 0.22 : 0.18, 0.6, big ? 2.8 : 1.8, 1.4, -9, 0.18, 2.5);
}

// ---- BattleFX ground scars ------------------------------------------------------

namespace { const int MAX_CELLS = 12000; }

// BattleFX.scar: churned earth (dirt) and blood stamped onto the terrain columns
void AovUnitView::scar(double x, double z, double radius, double dirt, double blood, uint32_t seed) {
	const aov::GameMap &map = sim_ref_->sim().map();
	const double VOX = 0.5;
	const double r = radius / VOX;
	const int cx0 = (int)std::floor(x / VOX - r), cx1 = (int)std::floor(x / VOX + r);
	const int cz0 = (int)std::floor(z / VOX - r), cz1 = (int)std::floor(z / VOX + r);
	VRng rng(seed);
	for (int cz = cz0; cz <= cz1; cz++)
		for (int cx = cx0; cx <= cx1; cx++) {
			if (!map.in_cols(cx, cz)) continue;
			const double d = std::hypot((cx + 0.5) * VOX - x, (cz + 0.5) * VOX - z) / radius;
			if (d > 1) continue;
			const int lv = map.level(cx, cz);
			if (lv < map.water_level) continue;
			const double f = (1 - d * d) * (0.75 + 0.5 * rng.next());
			const int key = map.c_idx(cx, cz);
			int i = cell_of_[key] - 1;
			if (i < 0) {
				if ((int)cell_key_.size() >= MAX_CELLS) continue;
				i = (int)cell_key_.size();
				cell_of_[key] = i + 1;
				cell_key_.push_back(key);
				cell_pos_.push_back((float)((cx + 0.5) * VOX));
				cell_pos_.push_back((float)(lv * VOX + 0.012));
				cell_pos_.push_back((float)((cz + 0.5) * VOX));
				cell_val_.push_back(0);
				cell_val_.push_back(0);
			}
			cell_val_[i * 2] = (float)std::min(0.92, cell_val_[i * 2] + dirt * f);
			cell_val_[i * 2 + 1] = (float)std::min(0.8, cell_val_[i * 2 + 1] + blood * f);
		}
}

// the scars a hit / death leaves (BattleFX.hit / death)
void AovUnitView::stamp(const HitRec &h) {
	VRng r(h.seed ^ 0xa5a5a5a5u);
	if (h.kind == 0) {
		const double px = h.x - h.bx * h.scale * 0.8, pz = h.z - h.bz * h.scale * 0.8;
		if (r.chance(0.4)) scar(h.x + r.range(-0.3, 0.3), h.z + r.range(-0.3, 0.3), 0.3, 0.1, 0.22, h.seed + 1);
		scar(px, pz, 0.5, 0.3, 0.0, h.seed + 2);
	} else if (h.kind == 3) {
		const double big = h.scale;
		scar(h.x, h.z, 0.9 * big, 0.55, 0.0, h.seed + 3);
		const double fx = std::sin(h.rot), fz = std::cos(h.rot);
		scar(h.x - fx * 0.35 * big, h.z - fz * 0.35 * big, 0.45 * big, 0.2, 0.45, h.seed + 4);
		scar(h.x + fx * 0.35 * big, h.z + fz * 0.35 * big, 0.45 * big, 0.2, 0.45, h.seed + 5);
		return;
	} else if (h.kind == 4) {
		scar(h.x + r.range(-0.2, 0.2), h.z + r.range(-0.2, 0.2), 0.75, 0.3, 0, h.seed + 6);
		return;
	} else if (h.kind == 5) {
		scar(h.x, h.z, 0.5, 0.18, 0, h.seed + 7);
		return;
	}
	if (h.kind <= 1 && r.next() < 0.15) scar(h.x, h.z, 0.4, 0.0, 0.2, h.seed + 8);
}

// combat.update's 0.5 s scan: every melee fighter in reach scuffs the ground
// between him and his foe, charging cavalry kick up the turf (BattleFX.scuff)
void AovUnitView::scan(double now, bool particles) {
	const aov::Sim &SM = sim_ref_->sim();
	const aov::UnitStore &U = SM.entities.units;
	const int rows = (int)U.id.size();
	for (int i = 0; i < rows; i++) {
		if (U.removed[i] || U.dead[i] || U.order_type[i] != aov::O_ATTACK) continue;
		const aov::UnitDef &d = aov::unit_def(U.type[i]);
		if (!d.has_attack || d.attack.projectile) continue;
		HitRec h{};
		h.time = now;
		h.seed = (uint32_t)U.id[i] * 747796405u ^ (uint32_t)(now * 2) * 2891336453u;
		if (U.anim_state[i] == aov::A_ATTACK) {
			const int t = SM.entities.unit_slot(U.order_target[i]);
			h.kind = 4;
			h.x = (float)(t >= 0 ? (U.x[i] + U.x[t]) / 2 : U.x[i]);
			h.z = (float)(t >= 0 ? (U.z[i] + U.z[t]) / 2 : U.z[i]);
		} else if (d.cls == aov::CLS_CAVALRY && U.moving[i]) {
			h.kind = 5;
			h.x = (float)U.x[i];
			h.z = (float)U.z[i];
			h.bx = (float)(-std::sin(U.rot[i]) * 0.9);
			h.bz = (float)(-std::cos(U.rot[i]) * 0.9);
		} else
			continue;
		stamp(h);
		if (particles) {
			h.seq = 0;
			hits_->push_back(h);
		}
	}
}

// ---- per frame ------------------------------------------------------------------

Dictionary AovUnitView::update(double dt, double alpha, int64_t local_player, const Array &frustum, const Vector3 &lod_origin, double lod_dist) {
	Dictionary out;
	if (sim_ref_.is_null()) return out;
	local_player_ = (int)local_player;
	const aov::Sim &SM = sim_ref_->sim();
	const aov::UnitStore &U = SM.entities.units;
	const aov::GameMap &map = SM.map();
	const double now = SM.time;
	for (Buf &b : part_bufs_) b.clear();
	part_bufs_lod_.resize(part_bufs_.size());
	for (Buf &b : part_bufs_lod_) b.clear();
	int n_posed = 0, n_lod = 0;
	const double lod_d2 = lod_dist > 0 ? lod_dist * lod_dist : -1;
	shadows_.clear(); bars_.clear(); arrows_.clear(); streaks_.clear(); sparks_.clear(); dust_.clear(); chips_.clear();
	for (Buf &b : drops_) b.clear();

	Col team[aov::MAX_PLAYERS];
	for (int p = 0; p < aov::MAX_PLAYERS; p++) team[p] = crush(hex_lin(SM.players[p].exists ? SM.players[p].color : 0xbbbbbb));

	std::vector<Plane> planes;
	for (int64_t k = 0; k < frustum.size(); k++) planes.push_back(frustum[k]);
	auto on_screen = [&](double x, double y, double z, double r) {
		const Vector3 c((real_t)x, (real_t)y, (real_t)z);
		for (const Plane &p : planes)
			if (p.distance_to(c) > r) return false;
		return true;
	};
	float rot3[CH_COUNT][3];
	std::vector<Transform3D> world;
	const int rows = (int)U.id.size();
	for (int i = 0; i < rows; i++) {
		if (U.removed[i]) continue;
		const int type = U.type[i];
		if (type >= (int)rigs_.size()) continue;
		const int32_t id = U.id[i];
		int ri = type;
		if (!rig_override_.empty()) {
			const auto ov = rig_override_.find(id);
			if (ov != rig_override_.end()) ri = ov->second;
		}
		const Rig &rig = rigs_[ri];
		if (rig.parts.empty()) continue;
		const bool dead = U.dead[i];
		const int owner = U.owner[i];
		if (owner != local_player_ && !SM.fog.is_visible(U.x[i], U.z[i])) continue;
		const aov::UnitDef &def = aov::unit_def(type);
		const bool big = def.myth || def.hero;
		const bool moving = U.moving[i];
		const int st = dead ? aov::A_DIE : U.anim_state[i];

		// index.js update(): melee press and crowd yaw, smoothed per frame
		if ((size_t)id >= press_.size()) { press_.resize(id + 256, 0); yaw_.resize(id + 256, 0); seen_.resize(id + 256, 0); }
		if (!dead) {
			double press = 0;
			if (st == aov::A_ATTACK && def.has_attack && !def.attack.projectile && big) {
				const int tr_ = SM.entities.unit_slot(U.order_target[i]);
				if (tr_ >= 0) {
					const double d = std::hypot(U.x[tr_] - U.x[i], U.z[tr_] - U.z[i]);
					const double want = (def.hero ? 0.1 : 0.2) + uhash(id, 3) * (def.hero ? 0.1 : 0.3);
					press = std::max(0.0, std::min(want, (d - (U.radius[i] + U.radius[tr_]) * 0.95) / 2 - 0.22));
				}
			}
			double yaw = moving ? 0 : (uhash(id, 8) < 0.5 ? -1 : 1) * (0.087 + uhash(id, 4) * 0.175) * 1.15;
			if (!moving && U.order_type[i] == aov::O_ATTACK && !(def.has_attack && def.attack.projectile) && !def.myth) {
				const int n = (int)std::floor(U.anim_t[i] / (2.2 + uhash(id, 63) * 1.6) + uhash(id, 64) * 7);
				yaw = (uhash(id, 65 + n) - 0.5) * 2 * 0.14;
			}
			if (!seen_[id]) { press_[id] = (float)press; yaw_[id] = (float)yaw; seen_[id] = 1; }
			const double k = std::min(1.0, dt * PRESS_RATE);
			press_[id] += (float)((press - press_[id]) * k);
			yaw_[id] += (float)((yaw - yaw_[id]) * k);
		}

		// render()
		double x = U.prev_x[i] + (U.x[i] - U.prev_x[i]) * alpha;
		double z = U.prev_z[i] + (U.z[i] - U.prev_z[i]) * alpha;
		// (round 13, Egyptian men: rig "stance") a builder is drawn standing
		// just outside the site's footprint, square to its nearest side, so he
		// hammers at the scaffold instead of standing in its beams (render
		// only: the sim keeps him where it put him, within 1.3 of the site)
		bool site_face = false;
		double site_rot = 0;
		if (rig.stance > 0 && !dead && st == aov::A_BUILD && U.order_type[i] == aov::O_BUILD) {
			const int b = SM.entities.building_slot(U.order_target[i]);
			if (b >= 0) {
				const aov::BuildingStore &B = SM.entities.buildings;
				const double x0 = B.tx[b], z0 = B.tz[b], x1 = x0 + B.w[b], z1 = z0 + B.h[b];
				const double nx = std::clamp(x, x0, x1), nz = std::clamp(z, z0, z1);
				double ox = x - nx, oz = z - nz;
				double d = std::hypot(ox, oz);
				if (d < 1e-6) {
					// inside the footprint: out through the nearest side
					const double dl = x - x0, dr = x1 - x, dt = z - z0, db = z1 - z;
					const double m = std::min({ dl, dr, dt, db });
					ox = m == dl ? -1 : m == dr ? 1 : 0; oz = m == dt ? -1 : m == db ? 1 : 0;
					if (ox != 0 && oz != 0) oz = 0;
					d = 0;
				} else { ox /= d; oz /= d; }
				const double gap = 0.62 + U.radius[i] * 0.5;
				if (d < gap) {
					const double ex = d > 0 ? nx : (ox < 0 ? x0 : ox > 0 ? x1 : x), ez = d > 0 ? nz : (oz < 0 ? z0 : oz > 0 ? z1 : z);
					x = ex + ox * gap; z = ez + oz * gap;
				}
				site_face = true;
				site_rot = std::atan2(-ox, -oz);
			}
		}
		if (!planes.empty() && !on_screen(x, map.height_at(x, z) + 1.5 + U.air_y[i], z, (big ? 8.0 : 4.5) + U.radius[i])) continue; // (margin: their shadows reach into view)
		double dr = U.rot[i] - U.prev_rot[i];
		while (dr > PI) dr -= PI * 2;
		while (dr < -PI) dr += PI * 2;
		float bob = 0, fwd = 0;
		pose_unit(i, ri, rot3, bob, fwd);
		const double rot = site_face ? site_rot + (uhash(id, 9) - 0.5) * 0.3 : U.prev_rot[i] + dr * alpha + (dead ? 0 : yaw_[id]);
		const double push = dead ? 0 : press_[id] + fwd;
		const double jl = site_face ? 0 : (uhash(id, 5) - 0.5) * 2 * JITTER * (big ? 0.3 : 1);
		const double jf = site_face ? 0 : (uhash(id, 6) - 0.5) * 2 * JITTER * (big ? 0.3 : st == aov::A_ATTACK ? 0.2 : 0.6);
		const double px = x + std::cos(rot) * jl + std::sin(rot) * (push + jf), pz = z - std::sin(rot) * jl + std::cos(rot) * (push + jf);
		const double y = map.height_at(px, pz);
		const double sc = big ? 1 : 0.93 + uhash(id, 7) * 0.13;
		const double V = rig.voxel;
		const double die_t = U.anim_die_t[i];
		const double air_y = U.air_y[i];
		{
			const bool horse = rig.kind == K_HORSE || rig.kind == K_CENTAUR;
			const double r = U.radius[i] * (horse ? 1.25 : big ? 1.25 : 1.3) * sc;
			const double lng = horse ? 1.7 : 1;
			const double k = dead ? std::max(0.0, 1 - die_t / 4) : 1 / (1 + air_y * 0.6);
			if (k > 0) {
				const double o = r * 0.6;
				const double gy = std::max({ y, map.height_at(px + o, pz), map.height_at(px - o, pz), map.height_at(px, pz + o), map.height_at(px, pz - o) });
				Transform3D m(Basis(Vector3(0, 1, 0), (real_t)rot).scaled_local(Vector3((real_t)(r * 2 * k), 1, (real_t)(r * 2 * lng * k))), Vector3((real_t)px, (real_t)(gy + 0.02), (real_t)pz));
				shadows_.push(m, 0, 0, 0, 1, 0, 0, 0, 0);
			}
		}
		Transform3D root(Basis(Vector3(0, 1, 0), (real_t)rot).scaled_local(Vector3((real_t)sc, (real_t)sc, (real_t)sc)), Vector3((real_t)px, (real_t)(y + bob * V * sc), (real_t)pz));
		double ay = air_y, arx = U.air_rx[i], arz = U.air_rz[i];
		// combat.lean(u): a man struck reels back (not while a god power has him airborne)
		if (!dead && U.gp_state[i] != 1 && ay == 0) {
			const double s = now - U.stag_t[i];
			if (!std::isnan(s) && s < STAGGER && s >= 0) {
				ay = 0.0005;
				arx = -0.22 * U.stag_k[i] * std::sin(PI * std::pow(std::min(1.0, s / STAGGER), 0.7));
				arz = 0;
			}
		}
		if (ay != 0) {
			root = xl(0, ay, 0) * root;
			root = root * xl(0, 0.7, 0) * Transform3D(euler(arx, 0, arz), Vector3()) * xl(0, -0.7, 0);
		}
		if (dead) {
			const double sink = std::max(0.0, die_t - CORPSE_TIME + 2) * 0.5;
			const double side = id % 2 ? 1 : -1;
			if (rig.sprawl) {
				// (the Petsuchos) no roll onto its side: the low body only
				// slumps a little to one flank, belly on the ground
				const double k = std::min(1.0, die_t / 0.8);
				const double f = k * k * (3 - 2 * k);
				root = root * xl(0, -0.04 * f, 0) * rot_z(side * f * 0.12);
			} else if (rig.kind == K_HORSE) {
				const double k = std::min(1.0, die_t / 0.8);
				const double f = k * k * (3 - 2 * k);
				root = root * xl(0, f * 0.3, 0) * rot_z(side * f * PI / 2 * 0.92);
			} else if (rig.kind == K_BEAST || rig.kind == K_FLYER || rig.kind == K_SIEGE) {
				const double k = std::min(1.0, std::max(0.0, (die_t - 0.22) / 0.5));
				const double f = k * k * (3 - 2 * k);
				const double bounce = die_t > 0.72 && die_t < 0.92 ? std::sin((die_t - 0.72) / 0.2 * PI) * 0.05 : 0;
				root = root * xl(side * 0.1 * f, 0.45 * f, 0.12 * f) * rot_z(side * (f * 1.42 - bounce)) * rot_x(0.3 * f);
			} else {
				const double k = std::min(1.0, std::max(0.0, (die_t - 0.18) / 0.5));
				const double f = k * k;
				const double dir = uhash(id, 70) < 0.3 ? 1 : -1;
				const double bounce = die_t > 0.68 && die_t < 0.9 ? std::sin((die_t - 0.68) / 0.22 * PI) * 0.08 : 0;
				root = root * xl(0, 0.26 * f, -0.12 * dir * f) * rot_x(dir * (f * 1.5 - bounce)) * rot_z(side * 0.12 * f);
				Transform3D flat(Basis().scaled(Vector3(1, (real_t)(1 - 0.72 * f), 1)), Vector3());
				root = xl(0, y - 0.05 * f, 0) * flat * xl(0, -y, 0) * root;
			}
			root = xl(0, -sink, 0) * root;
		}
		// colours: team dye (crushed), the dead drained towards grey
		Col c = owner < aov::MAX_PLAYERS ? team[owner] : Col{ 1, 1, 1 };
		const double dk = dead ? std::min(1.0, die_t / 1.2) : 0;
		if (dk > 0) {
			const double m = dk * 0.85;
			c = { (float)(c.r + (0.62 - c.r) * m), (float)(c.g + (0.62 - c.g) * m), (float)(c.b + (0.64 - c.b) * m) };
		}
		const double ht = U.hit_t[i];
		const bool pop_ok = !dead && !std::isnan(ht) && ht < 0.12 && U.flash_t[i] > 0 && now - U.melee_t[i] < 0.15;
		const double pop = pop_ok ? (def.myth ? 0.025 : 0.035) : 0;
		double flash = std::max(pop, dead ? 0.0 : std::min(1.0, U.flash_t[i] / 0.12) * 0.012);
		const double gph = now - U.gp_hit_t[i];
		if (!std::isnan(gph) && gph >= 0 && gph < 0.3) flash = std::max(flash, 0.9 * (1 - gph / 0.3));
		// (gods piece: a fallen Phoenix burns up into its egg, Rebirth: no corpse lies beside it)
		const double fade = !dead ? 1 : type == aov::U_PHOENIX ? 1 - clamp01((die_t - 0.5) / 0.7)
				: 1 - clamp01((die_t - FADE_START) / (CORPSE_TIME - 0.3 - FADE_START));
		const float packed = (float)(std::floor(dk * 100) + std::min(0.99, flash));
		const double *coat = COATS[id % 6];
		const Gear gear = (type == aov::U_HOPLITE || type == aov::U_TOXOTES) ? gear_of(id, type, U.kit[i]) : Gear{ 0, 0, 0, 0, 0, 0 };
		const int nparts = (int)rig.parts.size();
		world.resize(nparts);
		n_posed++;
		const double lx = px - lod_origin.x, ly = y - lod_origin.y, lz = pz - lod_origin.z;
		const bool far = lod_d2 > 0 && lx * lx + ly * ly + lz * lz > lod_d2;
		if (far) n_lod++;
		std::vector<Buf> &pbufs = far ? part_bufs_lod_ : part_bufs_;
		for (int pi = 0; pi < nparts; pi++) {
			const Part &p = rig.parts[pi];
			const Transform3D &parent = p.parent >= 0 ? world[p.parent] : root;
			Basis b;
			if (p.channel >= 0) b = euler(rot3[p.channel][0], rot3[p.channel][1], rot3[p.channel][2]);
			// (rig "upright": the Priest) the ankh staff stands upright in the
			// fist whatever the arm does (walk swing, raised arm): the weapon
			// takes the unit's own orientation, not the arm's
			if (rig.upright && p.weapon && !dead) b = parent.basis.inverse() * root.basis;
			if (p.has_rest) b = b * p.rest;
			world[pi] = parent * Transform3D(b, p.joint);
			bool show = true;
			switch (p.rule) {
				case R_HAMMER: show = st == aov::A_BUILD; break;
				case R_TOOL:
					show = (st == aov::A_GATHER || (st == aov::A_WALK && U.order_type[i] == aov::O_GATHER && !(U.carry_amount[i] > 0))) && U.econ_res_type[i] == p.rule_v;
					break;
				case R_CARRY: show = U.carry_amount[i] > 0 && U.carry_type[i] == p.rule_v; break;
				case R_ARROW: show = st == aov::A_ATTACK && U.anim_attack_t[i] > 0.45; break;
				case R_HELM: show = gear.helm == p.rule_v; break;
				case R_HAT: show = gear.hat == p.rule_v; break;
				case R_CLOAK: show = gear.cloak == p.rule_v; break;
				case R_KIT: show = gear.kit == p.rule_v; break;
				case R_PENNANT: show = gear.kit == 0 && gear.pennant == 1; break;
				case R_SHIELD: show = gear.kit == 0 && gear.shield == p.rule_v; break;
				case R_VARY: show = (int)std::floor(uhash(id, 26) * p.rule_n) == p.rule_v; break;
				default: break;
			}
			if (dead && p.weapon && die_t > 0.5 && rig.kind != K_ARCHER) show = false;
			if (!show) continue;
			float cr, cg, cb;
			if (p.coat) {
				cr = (float)(coat[0] * (1 - dk) + 0.7 * dk); cg = (float)(coat[1] * (1 - dk) + 0.7 * dk); cb = (float)(coat[2] * (1 - dk) + 0.72 * dk);
			} else {
				cr = cg = (float)(1 - dk * 0.22); cb = (float)(1 - dk * 0.2);
			}
			pbufs[rig.first + pi].push(world[pi], cr, cg, cb, (float)fade, c.r, c.g, c.b, packed);
		}
		// Overlays: health bars over the badly hurt, struck in the last seconds
		if (!dead) {
			const double f = U.hp[i] / U.max_hp[i];
			const double hs = now - U.hit_time[i];
			const bool hurt = f < (big ? 0.8 : 0.7) && !std::isnan(hs) && hs < 6;
			if (hurt) {
				const double w = big ? 76 : def.cls == aov::CLS_CAVALRY ? 50 : 44;
				bars_.push(xl(x, map.height_at(U.x[i], U.z[i]) + HEIGHT_OF[type] + 0.3, z), 0.3f, 1.0f, 0.18f, 1, (float)std::max(0.0, f), (float)w, 0, 0);
			}
		}
	}

	// Projectiles.render: arrows in flight + streaks, stuck arrows
	const aov::Combat &CB = SM.combat;
	for (const aov::Projectile &p : CB.projectiles) {
		Vector3 d((real_t)(p.x - p.px), (real_t)(p.y - p.py), (real_t)(p.z - p.pz));
		if (d.length_squared() < 1e-8f) d = Vector3(0, 0, 1);
		d.normalize();
		arrows_.push(Transform3D(look_z(d), Vector3((real_t)p.x, (real_t)p.y, (real_t)p.z)), 1, 1, 1, 1, 1, 1, 1, 0);
		if (p.has_t) {
			const double k = std::min(1.0, p.t / p.dur);
			const double k0 = std::max(0.0, k - std::min(0.28, 2.6 / (p.arc * 2 + p.dist)));
			const double tx = p.sx + (p.tx - p.sx) * k0, tz = p.sz + (p.tz - p.sz) * k0, ty = p.sy + (p.ty - p.sy) * k0 + std::sin(k0 * PI) * p.arc;
			streaks_.push(xl(p.x - d.x * 0.45, p.y - d.y * 0.45, p.z - d.z * 0.45), (float)tx, (float)ty, (float)tz, 1, 0, 0, 0, 0);
		}
	}
	for (const aov::StuckArrow &s : CB.stuck) {
		Vector3 d((real_t)s.dx, (real_t)(s.dy * 0.45), (real_t)s.dz);
		if (d.length_squared() < 1e-8f) d = Vector3(0, -1, 0);
		d.normalize();
		const double sink = std::max(0.0, s.t - STUCK_TIME + 1.5) * 0.3;
		arrows_.push(Transform3D(look_z(d), Vector3((real_t)(s.x + d.x * 0.45), (real_t)(s.y + d.y * 0.45 - sink), (real_t)(s.z + d.z * 0.45))), 1, 1, 1, 1, 1, 1, 1, 0);
	}

	// Debris.render: the scene's drops (sim) + BattleFX.dropGear on deaths
	auto put_drop = [&](int kind, double x, double z, double rot, double tilt, double roll, double lift, int owner, double die) {
		if (kind < 0 || kind > 3) return;
		if (owner != local_player_ && !SM.fog.is_explored(x, z)) return;
		if (now > die + 1.5) return;
		const double sink = std::max(0.0, now - die) * 0.12;
		const Basis b = Basis::from_euler(Vector3((real_t)tilt, (real_t)rot, (real_t)roll), EULER_ORDER_YXZ);
		Col c = hex_lin(0xd8d0c0);
		if (owner > 0 && owner < aov::MAX_PLAYERS) {
			const Col p = hex_lin(SM.players[owner].color);
			c = { (p.r + (0.42f - p.r) * 0.78f) * 0.8f, (p.g + (0.37f - p.g) * 0.78f) * 0.8f, (p.b + (0.31f - p.b) * 0.78f) * 0.8f };
		}
		drops_[kind].push(Transform3D(b, Vector3((real_t)x, (real_t)(map.height_at(x, z) + 0.02 + lift - sink), (real_t)z)), 1, 1, 1, 1, c.r, c.g, c.b, 0);
	};
	for (const aov::Drop &g : CB.drops) put_drop(g.kind, g.x, g.z, g.rot, g.tilt, g.roll, g.lift, g.owner, g.life);
	for (const DropRec &g : *dropped_) put_drop(g.kind, g.x, g.z, g.rot, g.tilt, g.roll, g.lift, g.owner, g.die);

	// ground scars: the scene's, each new hit / death, the melee scans; fading
	for (; scene_scars_ < CB.scars.size(); scene_scars_++) {
		const aov::Scar &g = CB.scars[scene_scars_];
		scar(g.x, g.z, g.radius, g.dirt, g.blood, 0x5ca25u + (uint32_t)scene_scars_ * 7919u);
	}
	for (const HitRec &h : *hits_)
		if (h.seq > scarred_seq_) stamp(h);
	if (!hits_->empty()) scarred_seq_ = std::max(scarred_seq_, *seq_);
	const int64_t sc_now = (int64_t)std::floor(now / 0.5);
	if (last_scan_ < 0) {
		// first frame after a fast-forward: the fighting so far has already churned the ground
		for (int k = (int)std::min<int64_t>(sc_now, 10); k > 0; k--) scan(now - k * 0.5, false);
		last_scan_ = sc_now;
	}
	for (int k = 0; last_scan_ < sc_now && k < 4; k++) { last_scan_++; scan(last_scan_ * 0.5, true); }
	last_scan_ = sc_now;
	if (scar_clock_ < 0) scar_clock_ = now;
	if (now - scar_clock_ > 2) {
		const float fade = (float)((now - scar_clock_) * 0.004);
		scar_clock_ = now;
		size_t j = 0;
		while (j < cell_key_.size()) {
			float &dv = cell_val_[j * 2], &bv = cell_val_[j * 2 + 1];
			dv = std::max(0.0f, dv - fade);
			bv = std::max(0.0f, bv - fade * 1.5f);
			if (dv <= 0 && bv <= 0) {
				const size_t last = cell_key_.size() - 1;
				cell_of_[cell_key_[j]] = 0;
				if (j != last) {
					cell_key_[j] = cell_key_[last];
					cell_of_[cell_key_[j]] = (int)j + 1;
					for (int c = 0; c < 3; c++) cell_pos_[j * 3 + c] = cell_pos_[last * 3 + c];
					for (int c = 0; c < 2; c++) cell_val_[j * 2 + c] = cell_val_[last * 2 + c];
				}
				cell_key_.pop_back();
				cell_pos_.resize(cell_pos_.size() - 3);
				cell_val_.resize(cell_val_.size() - 2);
				continue;
			}
			j++;
		}
	}
	bool scars_changed = false;
	if (scar_upload_ < 0 || now - scar_upload_ >= 0.25 || now < scar_upload_) {
		scar_upload_ = now;
		scars_changed = true;
		scars_.clear();
		for (size_t j = 0; j < cell_key_.size(); j++)
			scars_.push(xl(cell_pos_[j * 3], cell_pos_[j * 3 + 1], cell_pos_[j * 3 + 2]), 1, 1, 1, 1, cell_val_[j * 2], cell_val_[j * 2 + 1], 0, 0);
	}

	// BattleFX / Particles: every hit and death still showing something
	auto &H = *hits_;
	size_t keep = 0;
	while (keep < H.size() && now - H[keep].time > 2.6) keep++;
	if (keep > 0) H.erase(H.begin(), H.begin() + keep);
	double last_melee = -1;
	int n_melee = 0;
	for (const HitRec &h : H) {
		emit_fx(h, now);
		if (h.kind == 0) { last_melee = now - h.time; n_melee++; }
	}
	out["last_melee_age"] = last_melee; // (debug / tests: age of the newest melee blow)
	out["melee_recent"] = n_melee;

	Array parts;
	PackedInt32Array counts;
	for (const Buf &b : part_bufs_) {
		parts.push_back(pack(b));
		counts.push_back(b.n);
	}
	out["parts"] = parts;
	out["part_counts"] = counts;
	Array parts_lod;
	PackedInt32Array counts_lod;
	for (const Buf &b : part_bufs_lod_) {
		parts_lod.push_back(pack(b));
		counts_lod.push_back(b.n);
	}
	out["parts_lod"] = parts_lod;
	out["part_counts_lod"] = counts_lod;
	out["unit_count"] = n_posed;
	out["lod_count"] = n_lod;
	out["shadows"] = pack(shadows_);
	out["shadow_count"] = shadows_.n;
	out["bars"] = pack(bars_);
	out["bar_count"] = bars_.n;
	out["arrows"] = pack(arrows_);
	out["arrow_count"] = arrows_.n;
	out["streaks"] = pack(streaks_);
	out["streak_count"] = streaks_.n;
	out["sparks"] = pack(sparks_);
	out["spark_count"] = sparks_.n;
	out["dust"] = pack(dust_);
	out["dust_count"] = dust_.n;
	out["chips"] = pack(chips_);
	out["chip_count"] = chips_.n;
	Array drops;
	PackedInt32Array dc;
	for (const Buf &b : drops_) {
		drops.push_back(pack(b));
		dc.push_back(b.n);
	}
	out["drops"] = drops;
	out["scars_changed"] = scars_changed;
	if (scars_changed) {
		out["scars"] = pack(scars_);
		out["scar_count"] = scars_.n;
	}
	out["drop_counts"] = dc;
	return out;
}

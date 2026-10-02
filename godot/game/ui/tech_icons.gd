extends RefCounted
## Tech and market icons (ui piece, Godot-only; no icons.js counterpart): one
## glyph per tech line of the Greek Armory, Market and Temple (Age of
## Mythology: Retold's command grid, reference/techs/ui_02.jpg) as 24-unit SVGs,
## and the painted tile a command button shows (tile(): a background plate
## per tech family, the glyph embossed and lit, see "painted tiles" below).
## The Armory's three generic lines (weapons: a spear, armor: a muscle
## cuirass, shields: a hoplon) are shaded templates in the tier's metal, each
## tier with its own detail: copper plain, bronze (gold) with a red tassel /
## gorgon boss / star blazon, iron (steel) with a bright edge, rivets and
## pteruges. GODS: the gods' emblems for a god tech's frame medallion.
##
##   TechIcons.icon_for("bronze_weapons")  -> "t_weapons_bronze"
##   TechIcons.svg("t_weapons_bronze")     -> the SVG text (hud_style.icon() reads it)
##   TechIcons.tile("t_weapons_bronze", 64, "locked") -> the baked button tile
##   TechIcons.tier_of("bronze_weapons")   -> 2;  god_emblem("athena") -> "g_athena"

## tier metals: $A body, $B highlight, $C outline, $D shade. Copper is a
## warm red-orange, bronze a yellow gold, iron a cold blue steel, so the three
## tiers read apart even greyed; each tier also adds its own detail ($X).
const TIERS := {
	"copper": ["#c8642e", "#ffc08a", "#3a1606", "#7e3412"],
	"bronze": ["#d9a630", "#fff2b0", "#3e2a04", "#8e600c"],
	"iron": ["#8e9eac", "#f4f8fb", "#141a20", "#46525e"],
}
const TIER_RANK := {"copper": 1, "bronze": 2, "iron": 3}

## shaded tier templates (gradients: m metal, s wood, d dome)
const TEMPLATES := {
	"weapons": '<svg viewBox="0 0 24 24"><defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e0a86a"/><stop offset=".5" stop-color="#8a5428"/><stop offset="1" stop-color="#3a1e0a"/></linearGradient><linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="$B"/><stop offset=".42" stop-color="$A"/><stop offset="1" stop-color="$D"/></linearGradient></defs><path d="M2.4 21.6L12.6 11.4" stroke="$C" stroke-width="3.6" stroke-linecap="round"/><path d="M2.4 21.6L12.6 11.4" stroke="url(#s)" stroke-width="2.1" stroke-linecap="round"/><path d="M1.8 22.2l2-2" stroke="$C" stroke-width="3.2" stroke-linecap="round"/><path d="M1.8 22.2l2-2" stroke="$A" stroke-width="1.8" stroke-linecap="round"/><path d="M11.2 12.8C11.4 8.2 15.4 4 21.8 2.2 20 8.6 15.8 12.6 11.2 12.8z" fill="url(#m)" stroke="$C" stroke-width=".9"/><path d="M11.2 12.8C11.4 8.2 15.4 4 21.8 2.2L12.4 11.6z" fill="$B" opacity=".35"/><path d="M12.4 11.6L20.6 3.4" stroke="$D" stroke-width="1"/><path d="M12.9 11.1L20.4 3.6" stroke="$B" stroke-width=".45" opacity=".9"/><path d="M10 12.2l1.8 1.8" stroke="$C" stroke-width="3.4" stroke-linecap="round"/><path d="M10 12.2l1.8 1.8" stroke="url(#m)" stroke-width="2" stroke-linecap="round"/>$X</svg>',
	"armor": '<svg viewBox="0 0 24 24"><defs><linearGradient id="m" x1="0" y1="0" x2="1" y2=".7"><stop offset="0" stop-color="$B"/><stop offset=".4" stop-color="$A"/><stop offset="1" stop-color="$D"/></linearGradient></defs>$Y<path d="M6.8 2.8h2.8c.8 1.4 1.6 2 2.4 2s1.6-.6 2.4-2h2.8l3 3.8-2.4 2.4v8.8c-1.6 1.8-3.8 2.8-5.8 2.8s-4.2-1-5.8-2.8V9l-2.4-2.4z" fill="url(#m)" stroke="$C" stroke-width="1.1"/><path d="M7.4 9.6c1.6 2 3.4 2 4.6.4 1.2 1.6 3 1.6 4.6-.4" stroke="$D" stroke-width="1.3" fill="none"/><path d="M7.6 9.2c1.4 1.5 2.8 1.6 3.9.6" stroke="$B" stroke-width=".7" fill="none"/><path d="M12 10.8v8.6" stroke="$D" stroke-width="1"/><path d="M9.4 13.8c1.6.5 3.6.5 5.2 0M9.6 16.6c1.5.5 3.3.5 4.8 0" stroke="$D" stroke-width=".9" fill="none"/><path d="M8 4.2l1.8 3.4M7.4 9.8v7" stroke="$B" stroke-width=".9" opacity=".8"/><path d="M6.8 2.8h2.8l.6 1.4H7.6zM14.6 2.8h2.8l-.8 1.4H14z" fill="#5a3418"/>$X</svg>',
	"shields": '<svg viewBox="0 0 24 24"><defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="$B"/><stop offset=".45" stop-color="$A"/><stop offset="1" stop-color="$D"/></linearGradient><radialGradient id="d" cx=".36" cy=".32" r=".78"><stop offset="0" stop-color="$B"/><stop offset=".35" stop-color="$A"/><stop offset="1" stop-color="$D"/></radialGradient></defs><circle cx="12" cy="12" r="10.4" fill="$C"/><circle cx="12" cy="12" r="9.6" fill="url(#m)"/><circle cx="12" cy="12" r="7.6" fill="$C" opacity=".7"/><circle cx="12" cy="12" r="7.1" fill="url(#d)"/>$X<path d="M5.4 9.6a7.2 7.2 0 0 1 5-5.2" stroke="#fff" stroke-width="1.2" opacity=".6" fill="none" stroke-linecap="round"/><path d="M3.4 10.4a8.8 8.8 0 0 1 6-6.8" stroke="#fff" stroke-width=".6" opacity=".45" fill="none" stroke-linecap="round"/></svg>',
}

## per tier details: $X drawn on top, $Y behind (armor's pteruges)
const EXTRAS := {
	"weapons": {
		"copper": "",
		"bronze": '<path d="M7.2 15.6l1.6 1.6M5.8 17l1.2 1.2" stroke="$B" stroke-width="1.2"/><path d="M9.4 13.4c-1.8 0-3 1.2-3.6 3.2 1.2-.6 2.4-.8 3.6 0 .2-1.2.4-2.2 0-3.2z" fill="#c8302a" stroke="#4a0a06" stroke-width=".5"/>',
		"iron": '<path d="M11.4 12.4C11.8 8.6 15.6 4.6 21.2 2.8" stroke="#fff" stroke-width=".55" opacity=".85" fill="none"/><path d="M7 15.8l1.4 1.4M5.4 17.4l1.4 1.4M3.8 19l1.2 1.2" stroke="$A" stroke-width="1.1"/><circle cx="10.9" cy="13.1" r=".55" fill="$B"/>',
	},
	"armor": {
		"copper": "",
		"bronze": '<circle cx="12" cy="7.8" r="1.7" fill="$B" stroke="$C" stroke-width=".6"/><circle cx="12" cy="7.8" r=".7" fill="#c8302a"/><path d="M6.8 17.6c1.6 1.6 3.4 2.4 5.2 2.4s3.6-.8 5.2-2.4" stroke="$B" stroke-width=".8" fill="none"/>',
		"iron": '<g fill="$B" stroke="$C" stroke-width=".3"><circle cx="8" cy="4" r=".6"/><circle cx="16" cy="4" r=".6"/><circle cx="7.6" cy="11" r=".5"/><circle cx="16.4" cy="11" r=".5"/><circle cx="7.6" cy="14.6" r=".5"/><circle cx="16.4" cy="14.6" r=".5"/></g><path d="M6.6 9.4l10.8 0" stroke="$C" stroke-width=".6" opacity=".6"/>',
	},
	"shields": {
		"copper": '<circle cx="12" cy="12" r="5.2" fill="none" stroke="$D" stroke-width=".9"/><circle cx="12" cy="12" r="1.8" fill="url(#m)" stroke="$C" stroke-width=".7"/>',
		"bronze": '<path d="M12 6.2l1.1 3.6 3.6-1.8-1.8 3.6 3.6 1.1-3.6 1.1 1.8 3.6-3.6-1.8L12 17.8l-1.1-3.6-3.6 1.8 1.8-3.6-3.6-1.1 3.6-1.1-1.8-3.6 3.6 1.8z" fill="$B" stroke="$C" stroke-width=".6"/><circle cx="12" cy="12" r="1.5" fill="#c8302a" stroke="$C" stroke-width=".5"/>',
		"iron": '<g fill="$B" stroke="$C" stroke-width=".35"><circle cx="12" cy="3.4" r=".75"/><circle cx="12" cy="20.6" r=".75"/><circle cx="3.4" cy="12" r=".75"/><circle cx="20.6" cy="12" r=".75"/><circle cx="5.9" cy="5.9" r=".75"/><circle cx="18.1" cy="18.1" r=".75"/><circle cx="18.1" cy="5.9" r=".75"/><circle cx="5.9" cy="18.1" r=".75"/></g><circle cx="12" cy="12" r="3.4" fill="url(#m)" stroke="$C" stroke-width=".8"/><path d="M12 8.2l1 2.8 2.8 1-2.8 1-1 2.8-1-2.8-2.8-1 2.8-1z" fill="$B" stroke="$C" stroke-width=".5"/>',
	},
}
## the iron cuirass's leather strips (pteruges), behind the body
const PTERUGES := '<g stroke="#1c0e06" stroke-width=".5"><path d="M6.6 17.4h2v5h-2z" fill="#6a3c1c"/><path d="M8.8 18.6h2v4.4h-2z" fill="#86522a"/><path d="M11 19h2v4h-2z" fill="#6a3c1c"/><path d="M13.2 18.6h2V23h-2z" fill="#86522a"/><path d="M15.4 17.4h2v5h-2z" fill="#6a3c1c"/></g><g fill="$B"><circle cx="7.6" cy="21.6" r=".45"/><circle cx="9.8" cy="22.2" r=".45"/><circle cx="12" cy="22.2" r=".45"/><circle cx="14.2" cy="22.2" r=".45"/><circle cx="16.4" cy="21.6" r=".45"/></g>'

const SVG := {
	"t_ballistics": '<svg viewBox="0 0 24 24"><circle cx="15" cy="15" r="7" fill="#f3e6c8" stroke="#4a2410" stroke-width=".9"/><circle cx="15" cy="15" r="4.8" fill="#c8402c"/><circle cx="15" cy="15" r="2.7" fill="#f3e6c8"/><circle cx="15" cy="15" r="1.1" fill="#c8402c"/><path d="M2 9C4 4 9 2.4 13 4" stroke="#ffe27a" stroke-width=".9" stroke-dasharray="1.4 1.2" fill="none"/><path d="M3 3l10.4 10.4" stroke="#6a4a2a" stroke-width="1.7"/><path d="M14.6 14.6l-3.9-1.1 2.8-2.8z" fill="#dfe6ec" stroke="#5c6670" stroke-width=".5"/><path d="M3 3l3.4.5-1.5 1.5zM3 3l.5 3.4 1.5-1.5z" fill="#efe6cf" stroke="#7a6a50" stroke-width=".4"/></svg>',
	"t_burning_pitch": '<svg viewBox="0 0 24 24"><path d="M2.8 21.2L14.2 9.8" stroke="#6a4a2a" stroke-width="1.8"/><path d="M2.8 21.2l3.4-.4-1.4-1.6zM2.8 21.2l.4-3.4 1.6 1.4z" fill="#efe6cf"/><path d="M13.4 10.6c-.6-3.2 1.4-6 4-7.6-.3 1.7.4 2.8 1.7 3.4 1.1.6 1.8 1.5 1.5 3-.3 2.6-3 4.3-5.6 3.7-.8-.2-1.2-.9-1.6-2.5z" fill="#e5601e" stroke="#7a2a0c" stroke-width=".6"/><path d="M15.2 10.6c0-1.9 1-3.4 2.5-4.2 0 1 .6 1.7 1.3 2.1.6.5.6 1.7 0 2.3-1 1.1-2.9 1.1-3.8-.2z" fill="#ffd27a"/><path d="M12.6 11.4l3.3-1.3-2 3.3z" fill="#3a3a3a"/></svg>',
	"t_phobos": '<svg viewBox="0 0 24 24"><path d="M2.6 13.2A10 10 0 0 1 10.8 3M2 17.6A14.6 14.6 0 0 1 15.2 2.2" stroke="#e0402c" stroke-width="1.3" fill="none" opacity=".9"/><path d="M4 21.6A18 18 0 0 1 21.6 4" stroke="#e0402c" stroke-width="1" fill="none" opacity=".5"/><path d="M5 19L15.4 8.6" stroke="#3a220e" stroke-width="3" stroke-linecap="round"/><path d="M5 19L15.4 8.6" stroke="#b07a46" stroke-width="1.6" stroke-linecap="round"/><path d="M14 10C14.4 6.4 17.6 3.4 22 2 20.6 6.4 17.6 9.6 14 10z" fill="#dfe6ec" stroke="#5a1408" stroke-width=".9"/><path d="M14.8 9.2L21 3" stroke="#ff8a70" stroke-width=".9"/></svg>',
	"t_enyo": '<svg viewBox="0 0 24 24"><circle cx="17.4" cy="6.6" r="3.6" fill="#e0402c" opacity=".35"/><path d="M5 2.6c7.4 1.8 13.4 8 15.4 16.4" stroke="#3a1a08" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M5 2.6c7.4 1.8 13.4 8 15.4 16.4" stroke="#9a4a20" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M5 2.6L20.4 19" stroke="#efe6cf" stroke-width=".7"/><path d="M3 16L17 6.8" stroke="#c9a24c" stroke-width="1.3"/><path d="M18.6 5.8l-3.6.4 1.8 2.6z" fill="#e0402c" stroke="#5a1408" stroke-width=".5"/><path d="M3 16l1.2-2.8.8 1.6zM3 16l3-.4-1.2-1.2z" fill="#e0402c"/></svg>',
	"t_sarissa": '<svg viewBox="0 0 24 24"><path d="M1.6 18.4L19.4 2.6M5.6 22.4L21.4 6.6" stroke="#3a220e" stroke-width="2.4" stroke-linecap="round"/><path d="M1.6 18.4L19.4 2.6M5.6 22.4L21.4 6.6" stroke="#b07a46" stroke-width="1.1" stroke-linecap="round"/><path d="M18.6 3.4l3.8-2-2 3.8zM20.6 7.4l3-1.6-1.6 3z" fill="#dfe6ec" stroke="#4a5058" stroke-width=".5"/><circle cx="7.6" cy="15.6" r="5" fill="#2a4a8a" stroke="#0e1a34" stroke-width=".9"/><circle cx="7.6" cy="15.6" r="3.4" fill="none" stroke="#d9a83a" stroke-width="1"/><circle cx="7.6" cy="15.6" r="1.2" fill="#ffe9a0"/></svg>',
	"t_aegis": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.6" fill="#4a3008"/><circle cx="12" cy="12" r="8.7" fill="#d9a83a"/><circle cx="12" cy="12" r="7.2" fill="none" stroke="#ffe9a0" stroke-width=".8"/><path d="M8.4 9C6.6 8 6.2 6 7.4 4.8M10 7.8c-.4-1.8.4-3.2 2-3.8M14 7.8c.4-1.8-.4-3.2-2-3.8M15.6 9c1.8-1 2.2-3 1-4.2M8.2 14.6c-1.8.8-2.4 2.6-1.4 4M15.8 14.6c1.8.8 2.4 2.6 1.4 4" stroke="#3d7a2a" stroke-width="1.3" fill="none" stroke-linecap="round"/><circle cx="12" cy="12.4" r="3.8" fill="#efd2a8" stroke="#6a4a20" stroke-width=".7"/><circle cx="10.6" cy="11.8" r=".7" fill="#1a1006"/><circle cx="13.4" cy="11.8" r=".7" fill="#1a1006"/><path d="M10.6 14.2q1.4.9 2.8 0" stroke="#6a1a10" stroke-width=".8" fill="none"/></svg>',
	"t_sun_ray": '<svg viewBox="0 0 24 24"><path d="M12 .8l1.3 4.4h-2.6zM12 23.2l1.3-4.4h-2.6zM.8 12l4.4 1.3v-2.6zM23.2 12l-4.4 1.3v-2.6zM4.1 4.1l4 2.2-1.8 1.8zM19.9 19.9l-4-2.2 1.8-1.8zM19.9 4.1l-2.2 4-1.8-1.8zM4.1 19.9l2.2-4 1.8 1.8z" fill="#f2c14e" stroke="#8a5a10" stroke-width=".4"/><circle cx="12" cy="12" r="5.2" fill="#ffd970" stroke="#fff4c0" stroke-width="1"/><circle cx="10.6" cy="10.6" r="1.8" fill="#fff8dc" opacity=".8"/></svg>',
	"t_shafts_of_plague": '<svg viewBox="0 0 24 24"><path d="M3 3l11.4 11.4" stroke="#6a4a2a" stroke-width="1.7"/><path d="M15.6 15.6l-3.9-1.1 2.8-2.8z" fill="#7cc84a" stroke="#1d4410" stroke-width=".5"/><path d="M3 3l3.4.5-1.5 1.5zM3 3l.5 3.4 1.5-1.5z" fill="#efe6cf"/><path d="M18 13.4c1.5 2.1 2.2 3.2 2.2 4.3a2.2 2.2 0 0 1-4.4 0c0-1.1.7-2.2 2.2-4.3zM13 17.4c1 1.4 1.5 2.2 1.5 2.9a1.5 1.5 0 0 1-3 0c0-.7.5-1.5 1.5-2.9zM19.4 5.4c1 1.4 1.5 2.2 1.5 2.9a1.5 1.5 0 0 1-3 0c0-.7.5-1.5 1.5-2.9z" fill="#7cc84a" stroke="#d8f0b0" stroke-width=".6"/></svg>',
	"t_forge_of_olympus": '<svg viewBox="0 0 24 24"><path d="M2.6 9.4h14.2c0 2.4-2 3.6-4.4 3.8v2.2h2.4v2H5.6v-2H8v-2.2c-2.4-.2-4-1.4-5.4-3.8z" fill="#5c6670" stroke="#d0d8de" stroke-width=".7"/><rect x="4.6" y="17.4" width="11.2" height="3.2" rx=".6" fill="#3e464e" stroke="#1a1e22" stroke-width=".5"/><path d="M6.4 9.4h7" stroke="#ff8a3a" stroke-width="1.4"/><path d="M13.6 3.2l6.4 6.4" stroke="#6a4a2a" stroke-width="1.9" stroke-linecap="round"/><path d="M17.2 1.2l3.4 3.4-2.4 2.4-3.4-3.4z" fill="#cfd6dc" stroke="#4a5058" stroke-width=".6"/><path d="M8.6 7l.8-2.4M11.4 7.2l.6-2.6M6 7.4l-1-2M9.8 3.4l.2-1.6" stroke="#ffb347" stroke-width="1" stroke-linecap="round"/></svg>',
	"t_olympian_weapons": '<svg viewBox="0 0 24 24"><path d="M12 1.6l1.8 3.2v10.4h-3.6V4.8z" fill="#eef4f8" stroke="#6c7a86" stroke-width=".7"/><path d="M12 3v12" stroke="#b8c4cc" stroke-width=".6"/><rect x="7.2" y="15" width="9.6" height="2" rx=".9" fill="#e0b040" stroke="#5a3a10" stroke-width=".5"/><rect x="11.1" y="17" width="1.8" height="4" fill="#7a5230"/><circle cx="12" cy="21.8" r="1.3" fill="#e0b040"/><path d="M5.4 2.4L3 8h2.4L3.8 13l4.4-6.4H5.8L7.4 2.4zM18.6 2.4L21 8h-2.4l1.6 5-4.4-6.4h2.4l-1.6-4.2z" fill="#bfe3ff" stroke="#e8f6ff" stroke-width=".5"/></svg>',
	"t_harvest_of_souls": '<svg viewBox="0 0 24 24"><path d="M5.6 21.4L13.4 7.6" stroke="#3a220e" stroke-width="2.6" stroke-linecap="round"/><path d="M5.6 21.4L13.4 7.6" stroke="#8a5a30" stroke-width="1.3" stroke-linecap="round"/><path d="M12.8 8.4c1.2-4.2 5.4-6 9.6-5.4-4.2 1-6.8 3.2-7.4 7z" fill="#cfd6dc" stroke="#4a5058" stroke-width=".6"/><path d="M5.4 12.6C3.2 10.6 4 7.4 6 6.4c-.6 1.6.4 2.6 1.4 3.2 1.1.8.8 2.6-.6 3.4zM17.6 18.4c-1.6-1.6-1-4 .6-4.8-.4 1.2.3 2 1 2.4.9.6.6 2-.4 2.6z" fill="#9fe0d0" stroke="#e0fff6" stroke-width=".5" opacity=".9"/><circle cx="6.2" cy="9.4" r=".5" fill="#1a3a34"/><circle cx="18.4" cy="16" r=".4" fill="#1a3a34"/></svg>',
	"t_omniscience": '<svg viewBox="0 0 24 24"><path d="M12 .8v2.6M5.6 2.4l1.4 2.2M18.4 2.4L17 4.6M12 23.2v-2.6M5.6 21.6l1.4-2.2M18.4 21.6L17 19.4M1 7.6l2.2 1.2M23 7.6l-2.2 1.2" stroke="#ffe27a" stroke-width="1.2" stroke-linecap="round"/><path d="M2 12s4-6.6 10-6.6S22 12 22 12s-4 6.6-10 6.6S2 12 2 12z" fill="#f3e6c8" stroke="#c9a24c" stroke-width="1"/><circle cx="12" cy="12" r="4" fill="#c99a2e" stroke="#5a3a10" stroke-width=".6"/><circle cx="12" cy="12" r="1.7" fill="#1a1006"/><circle cx="10.8" cy="10.8" r=".8" fill="#fff"/></svg>',
	"t_olympian_parentage": '<svg viewBox="0 0 24 24"><path d="M6.4 6.6C7.6 2.6 16.4 2.6 17.6 6.6 16 5 14 4.4 12 4.4S8 5 6.4 6.6z" fill="#c8402c" stroke="#5a1408" stroke-width=".5"/><path d="M6 13.2C6 8.4 8.6 5.4 12 5.4s6 3 6 7.8V19h-3.4v-4.6h-1.2V20h-2.8v-5.6H9.4V19H6z" fill="#d9a83a" stroke="#4a3008" stroke-width=".9"/><path d="M8.2 11.2h2.6M13.2 11.2h2.6" stroke="#2a1a08" stroke-width="1.3"/><path d="M12 6.4v6" stroke="#ffe9a0" stroke-width=".8"/><path d="M19.6 13.4l-1.8 3.4h1.6l-1 3.2 3-4.4h-1.6l1-2.2z" fill="#ffe27a"/></svg>',
	"t_labyrinth": '<svg viewBox="0 0 24 24"><rect x="2.6" y="2.6" width="18.8" height="18.8" rx="1" fill="#6a4a2a" stroke="#2a1a0c" stroke-width=".8"/><path d="M4.8 4.8h14.4v14.4H4.8V7.2h12v9.6H7.2V9.6h7.2v4.8H9.6V12h2.4" stroke="#e9dcc0" stroke-width="1.3" fill="none"/></svg>',
	"t_sylvan_lore": '<svg viewBox="0 0 24 24"><path d="M4.6 19.4C4.6 10.4 9.8 4.6 19.4 4.6c0 9.6-5.8 14.8-14.8 14.8z" fill="#5da83a" stroke="#d8f0b0" stroke-width=".9"/><path d="M4.6 19.4L16.6 7.4M9 15l-.4-4M12 12l-.2-4M9 15l4 .4M12 12l4 .2" stroke="#2f6a1a" stroke-width=".9"/><path d="M2 22l3.4-3.4" stroke="#6a4a2a" stroke-width="1.6"/></svg>',
	"t_will_of_kronos": '<svg viewBox="0 0 24 24"><path d="M5.6 1.8h12.8v2.2H5.6zM5.6 20h12.8v2.2H5.6z" fill="#c9a24c" stroke="#4a3008" stroke-width=".5"/><path d="M7 4h10c0 4-3.6 6-4.4 8 .8 2 4.4 4 4.4 8H7c0-4 3.6-6 4.4-8C10.6 10 7 8 7 4z" fill="#bfe3ff" fill-opacity=".3" stroke="#e9dcc0" stroke-width=".9"/><path d="M9 6.4h6c-.8 1.6-2.2 2.8-3 4.4-.8-1.6-2.2-2.8-3-4.4zM8.6 19.4c.6-2 2.4-3 3.4-4.6 1 1.6 2.8 2.6 3.4 4.6z" fill="#e0a526"/><path d="M12 11v3.6" stroke="#e0a526" stroke-width=".6"/></svg>',
	"t_hymn": '<svg viewBox="0 0 24 24"><path d="M3.4 5h2.7v14.4H3.4zM6.6 5h2.7v12.4H6.6zM9.8 5h2.7v10.4H9.8zM13 5h2.7v8.6H13zM16.2 5h2.7v7H16.2z" fill="#c8a060" stroke="#4a2c12" stroke-width=".6"/><rect x="3" y="7.6" width="16.3" height="1.7" fill="#7a5230"/><path d="M20.2 13.6v5.2" stroke="#7fd05a" stroke-width="1"/><ellipse cx="19.2" cy="19" rx="1.3" ry="1" fill="#7fd05a"/><path d="M20.2 13.6c1.2.4 1.8 1 2 2" stroke="#7fd05a" stroke-width="1" fill="none"/></svg>',
	"t_oracle": '<svg viewBox="0 0 24 24"><path d="M12 9.6c-2.2-1.8.6-3.2-.2-5S13 1.6 13 1.6" stroke="#b9c8e0" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".85"/><path d="M8.6 6.6c-1-1 .4-2-.2-3" stroke="#b9c8e0" stroke-width="1" fill="none" opacity=".6"/><path d="M8 14l-2.4 7.4M16 14l2.4 7.4M12 15v6.4" stroke="#6a4a20" stroke-width="1.4"/><path d="M5.4 10h13.2c0 3-2.8 5.2-6.6 5.2S5.4 13 5.4 10z" fill="#c9a24c" stroke="#4a3008" stroke-width=".8"/><path d="M7 10h10" stroke="#ff8a3a" stroke-width="1"/></svg>',
	"t_temple_of_healing": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.6" fill="#5da83a" opacity=".2"/><path d="M12 2.4v19.6" stroke="#3a220e" stroke-width="2.4"/><path d="M12 2.4v19.6" stroke="#a87444" stroke-width="1.2"/><path d="M12.4 4.4c3 0 3 3-.2 3.6S8.8 11.2 12 11.8s3.2 3.4 0 4-3 3.4 0 4" stroke="#3a7a2a" stroke-width="2.4" fill="none"/><path d="M12.4 4.4c3 0 3 3-.2 3.6S8.8 11.2 12 11.8s3.2 3.4 0 4-3 3.4 0 4" stroke="#7fd05a" stroke-width="1.2" fill="none"/><circle cx="12.8" cy="4.2" r="1.3" fill="#7fd05a" stroke="#2a5a1a" stroke-width=".5"/></svg>',
	"t_golden_apples": '<svg viewBox="0 0 24 24"><circle cx="12" cy="14" r="7.2" fill="#f2c14e" stroke="#7a4a08" stroke-width=".9"/><path d="M12 7.6c-1 .2-1.4.4-1.6 1" stroke="#7a4a08" stroke-width=".8" fill="none"/><ellipse cx="9.4" cy="11.6" rx="1.6" ry="2.5" fill="#fff4c0" opacity=".8"/><path d="M12 7.4c0-2 1-3.4 2.4-4.2" stroke="#5b3a1d" stroke-width="1.3" fill="none"/><path d="M13.2 5.4c2-2 5-1.4 6-.4-2 1.8-4 1.8-6 .4z" fill="#5da83a"/></svg>',
	"t_dionysia": '<svg viewBox="0 0 24 24"><path d="M12 6c0-2 1-3 2.6-3.6" stroke="#5b3a1d" stroke-width="1.2" fill="none"/><path d="M12.6 4.2c2.4-2 5.4-1 6.2 0-2.4 2-4.6 1.8-6.2 0z" fill="#5da83a"/><g fill="#7a3a9a" stroke="#2a0c3a" stroke-width=".5"><circle cx="8" cy="9" r="2.3"/><circle cx="12.4" cy="8.4" r="2.3"/><circle cx="16.6" cy="9" r="2.3"/><circle cx="10" cy="12.8" r="2.3"/><circle cx="14.6" cy="12.8" r="2.3"/><circle cx="12.2" cy="16.6" r="2.3"/><circle cx="12.4" cy="20.2" r="1.8"/></g><g fill="#d8a8f0" opacity=".8"><circle cx="7.2" cy="8.2" r=".7"/><circle cx="11.6" cy="7.6" r=".7"/><circle cx="9.2" cy="12" r=".7"/><circle cx="13.8" cy="12" r=".7"/><circle cx="11.4" cy="15.8" r=".7"/></g></svg>',
	"t_face_of_the_gorgon": '<svg viewBox="0 0 24 24"><path d="M7.6 10C5 9 4 6 5.4 4M9.6 8.4C9 6 10 3.6 12 2.6M14.4 8.4C15 6 14 3.6 12.4 2.6M16.4 10C19 9 20 6 18.6 4M7.4 14.4C5 15.4 3.4 17.4 4 20M16.6 14.4c2.4 1 4 3 3.4 5.6" stroke="#2f5a1a" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M7.6 10C5 9 4 6 5.4 4M9.6 8.4C9 6 10 3.6 12 2.6M14.4 8.4C15 6 14 3.6 12.4 2.6M16.4 10C19 9 20 6 18.6 4M7.4 14.4C5 15.4 3.4 17.4 4 20M16.6 14.4c2.4 1 4 3 3.4 5.6" stroke="#6ab04a" stroke-width="1.2" fill="none" stroke-linecap="round"/><circle cx="12" cy="13" r="5.2" fill="#9cc88a" stroke="#2f5a1a" stroke-width=".8"/><circle cx="10.1" cy="12.4" r="1" fill="#ffe27a"/><circle cx="13.9" cy="12.4" r="1" fill="#ffe27a"/><path d="M10 16q2 1.1 4 0" stroke="#2f5a1a" stroke-width=".9" fill="none"/></svg>',
	"t_monstrous_rage": '<svg viewBox="0 0 24 24"><path d="M4.6 3c2 6.2 5 12.2 10.2 18.4M9.8 2c1.6 6 4 11.2 9.2 16.4M15 2c1 4 3 8 6.4 11.2" stroke="#5a1408" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M4.6 3c2 6.2 5 12.2 10.2 18.4M9.8 2c1.6 6 4 11.2 9.2 16.4M15 2c1 4 3 8 6.4 11.2" stroke="#e0402c" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M5.4 4.4c1.4 4 3 7.6 5 10.8" stroke="#ffb0a0" stroke-width=".6" fill="none"/></svg>',
	"t_pious_sacrifice": '<svg viewBox="0 0 24 24"><path d="M12 2.6c2.6 3 4.4 5 4.4 7.4A4.4 4.4 0 0 1 12 14.4 4.4 4.4 0 0 1 7.6 10c0-2.4 1.8-4.4 4.4-7.4z" fill="#e5601e" stroke="#7a2a0c" stroke-width=".6"/><path d="M12 6.8c1.4 1.8 2.2 3 2.2 4.2a2.2 2.2 0 0 1-4.4 0c0-1.2.8-2.4 2.2-4.2z" fill="#ffd27a"/><path d="M4.6 14h14.8v2.2H4.6z" fill="#efe2c4" stroke="#6a5a40" stroke-width=".6"/><path d="M6.6 16.2h10.8v5.2H6.6z" fill="#d8c8a4" stroke="#6a5a40" stroke-width=".6"/><path d="M8.4 18.8h7.2" stroke="#8a2a1a" stroke-width=".9"/></svg>',
	"t_tax_collectors": '<svg viewBox="0 0 24 24"><path d="M6.6 3.4h7.6L12.4 6.2c3.8 1.9 5.6 5.6 5.6 8.4 0 2.8-2.8 4.6-7.4 4.6S3.2 17.4 3.2 14.6c0-2.8 1.8-6.5 5.4-8.4z" fill="#c09050" stroke="#f3dca4" stroke-width="1"/><path d="M8 6.4h5" stroke="#6a4a20" stroke-width="1.2"/><circle cx="17.4" cy="17.6" r="3.8" fill="#f2c14e" stroke="#7a4a08" stroke-width=".8"/><circle cx="17.4" cy="17.6" r="2.4" fill="none" stroke="#fff4c0" stroke-width=".6"/><circle cx="14" cy="20.4" r="2.8" fill="#e0a526" stroke="#7a4a08" stroke-width=".7"/></svg>',
	"t_ambassadors": '<svg viewBox="0 0 24 24"><path d="M6 3h11a3 3 0 0 1 0 6h-1v10a2 2 0 0 1-2 2H5a3 3 0 0 1 0-6h1z" fill="#e9dcc0" stroke="#7a5a2c" stroke-width="1"/><path d="M9 7h5M9 10h5M9 13h3" stroke="#7a5a2c" stroke-width="1.1"/><path d="M14.6 16.4l-1.4 5.4 2.4-1.4 2.4 1.4-1.4-5.4z" fill="#2a5aa8"/><circle cx="16" cy="15.4" r="2.6" fill="#c8402c" stroke="#5a1408" stroke-width=".6"/></svg>',
	"t_coinage": '<svg viewBox="0 0 24 24"><g stroke="#7a4a08" stroke-width=".7"><ellipse cx="12" cy="18" rx="7" ry="2.6" fill="#e0a526"/><ellipse cx="12" cy="14.6" rx="7" ry="2.6" fill="#f2c14e"/><ellipse cx="12" cy="11.2" rx="7" ry="2.6" fill="#e0a526"/><ellipse cx="12" cy="7.8" rx="7" ry="2.6" fill="#ffd970"/></g></svg>',
	"t_scroll": '<svg viewBox="0 0 24 24"><path d="M6 3h11a3 3 0 0 1 0 6h-1v10a2 2 0 0 1-2 2H5a3 3 0 0 1 0-6h1z" fill="#e9dcc0" stroke="#7a5a2c" stroke-width="1"/><path d="M9 8h5M9 11h5M9 14h4" stroke="#7a5a2c" stroke-width="1.2"/></svg>',
	# market trade overlays and the tooltip's research time
	"t_buy": '<svg viewBox="0 0 24 24"><path d="M12 2.4l8 9h-4.6v9.2H8.6v-9.2H4z" fill="#7fd05a" stroke="#123008" stroke-width="1.2"/><path d="M12 4.4l5 5.6" stroke="#d8ffc0" stroke-width=".8"/></svg>',
	"t_sell": '<svg viewBox="0 0 24 24"><path d="M12 21.6l8-9h-4.6V3.4H8.6v9.2H4z" fill="#ff7a5c" stroke="#3a0806" stroke-width="1.2"/><path d="M9.6 4.4v8" stroke="#ffd0c0" stroke-width=".8"/></svg>',
	"t_time": '<svg viewBox="0 0 24 24"><path d="M5.6 2h12.8v2.4H5.6zM5.6 19.6h12.8V22H5.6z" fill="#c9a24c" stroke="#4a3008" stroke-width=".6"/><path d="M7 4.4h10c0 4-3.6 5.6-4.4 7.6.8 2 4.4 3.6 4.4 7.6H7c0-4 3.6-5.6 4.4-7.6C10.6 10 7 8.4 7 4.4z" fill="#f3e6c8" fill-opacity=".35" stroke="#efe6cf" stroke-width="1"/><path d="M9.4 6.8h5.2c-.8 1.4-2 2.4-2.6 3.8-.6-1.4-1.8-2.4-2.6-3.8zM8.8 19c.6-1.8 2.2-2.8 3.2-4.2 1 1.4 2.6 2.4 3.2 4.2z" fill="#e0a526"/></svg>',
}

## the gods' emblems for the medallion on a god tech's frame (one learnable
## sign per god, readable at 12 px; Greek gods share initials, so no letters)
const GODS := {
	"g_zeus": '<svg viewBox="0 0 24 24"><path d="M14.5 1L5 13.5h6L8.5 23 19 9.5h-6L16 1z" fill="#ffe27a" stroke="#fff8d0" stroke-width="1"/></svg>',
	"g_poseidon": '<svg viewBox="0 0 24 24"><path d="M12 6v17M5 3v5c0 3 3 4 7 4s7-1 7-4V3M5 3l-1.6 2.6M5 3l1.6 2.6M12 1v5M19 3l-1.6 2.6M19 3l1.6 2.6M12 1l-1.6 2.6M12 1l1.6 2.6" stroke="#bfe8ff" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>',
	"g_hades": '<svg viewBox="0 0 24 24"><path d="M12 2C7 2 4 5.6 4 10c0 2.6 1.2 4.4 3 5.4V19h10v-3.6c1.8-1 3-2.8 3-5.4 0-4.4-3-8-8-8z" fill="#e8e0d0"/><circle cx="8.8" cy="10.4" r="2.2" fill="#2a0a3a"/><circle cx="15.2" cy="10.4" r="2.2" fill="#2a0a3a"/><path d="M9 19v3M12 19v3M15 19v3" stroke="#2a0a3a" stroke-width="1.2"/></svg>',
	"g_ares": '<svg viewBox="0 0 24 24"><path d="M5 22v-9c0-5 3-8 7-8s7 3 7 8v9h-4v-6h-1.6v7h-2.8v-7H9v6z" fill="#ffd27a" stroke="#fff4c0" stroke-width=".8"/><path d="M6 6c2-4.6 10-4.6 12 0-2-1.4-4-2-6-2S8 4.6 6 6z" fill="#ff5a3a"/><path d="M12 1.2v5" stroke="#ff5a3a" stroke-width="2.4"/></svg>',
	"g_athena": '<svg viewBox="0 0 24 24"><path d="M4 3l3.6 3.4h8.8L20 3v9.4c0 5.4-3.6 9.6-8 9.6s-8-4.2-8-9.6z" fill="#e8e0d0"/><circle cx="8.6" cy="11" r="3" fill="#ffd27a" stroke="#3a2a10" stroke-width="1"/><circle cx="15.4" cy="11" r="3" fill="#ffd27a" stroke="#3a2a10" stroke-width="1"/><circle cx="8.6" cy="11" r="1.2" fill="#1a1006"/><circle cx="15.4" cy="11" r="1.2" fill="#1a1006"/><path d="M12 13.4l-1.4 2.4h2.8z" fill="#c08a2a"/></svg>',
	"g_hermes": '<svg viewBox="0 0 24 24"><path d="M2 14C6 6 13 3 22 3c-2 2-3.4 3-5 3.6 1.6.4 2.6.4 4-.2-1.6 2.4-3.4 3.4-5.4 3.8 1.2.6 2.4.6 3.6.2-2 2.8-5 4.6-9 5.6L6 20z" fill="#f4f8fb" stroke="#bfe8ff" stroke-width=".8"/></svg>',
	"g_apollo": '<svg viewBox="0 0 24 24"><g stroke="#ffd970" stroke-width="2.2" stroke-linecap="round"><path d="M12 1.5v3.5M12 19v3.5M1.5 12H5M19 12h3.5M4.6 4.6l2.4 2.4M17 17l2.4 2.4M19.4 4.6L17 7M7 17l-2.4 2.4"/></g><circle cx="12" cy="12" r="5.4" fill="#ffe27a" stroke="#fff8d0" stroke-width="1"/></svg>',
	"g_dionysus": '<svg viewBox="0 0 24 24"><g fill="#d8a8f0" stroke="#5a1a7a" stroke-width=".7"><circle cx="8" cy="8.5" r="3"/><circle cx="14" cy="8" r="3"/><circle cx="11" cy="13" r="3"/><circle cx="17" cy="12.6" r="2.6"/><circle cx="14" cy="17.6" r="2.8"/><circle cx="11.4" cy="21" r="2"/></g><path d="M11 5.4C10.6 3 12 1.6 14 1.2" stroke="#7fd05a" stroke-width="1.6" fill="none"/></svg>',
	"g_aphrodite": '<svg viewBox="0 0 24 24"><path d="M12 22S2.4 15.6 2.4 8.6A5.4 5.4 0 0 1 12 5.4a5.4 5.4 0 0 1 9.6 3.2C21.6 15.6 12 22 12 22z" fill="#ff8aa8" stroke="#ffe0ea" stroke-width="1"/></svg>',
	"g_hephaestus": '<svg viewBox="0 0 24 24"><path d="M4 3h11l2 2v4l-2 2H4z" fill="#d8e0e6" stroke="#fff" stroke-width=".8"/><path d="M9.5 11h3v11h-3z" fill="#c08a4a" stroke="#ffd8a0" stroke-width=".7"/><path d="M15 3l4-1v10l-4-1" fill="#ffa040"/></svg>',
	"g_hera": '<svg viewBox="0 0 24 24"><path d="M2.5 8l4.2 4 5.3-8 5.3 8 4.2-4-2 12H4.5z" fill="#ffd970" stroke="#fff4c0" stroke-width="1"/><circle cx="12" cy="15.6" r="1.8" fill="#4ad0c0"/><circle cx="2.5" cy="8" r="1.4" fill="#ffd970"/><circle cx="21.5" cy="8" r="1.4" fill="#ffd970"/><circle cx="12" cy="3.4" r="1.4" fill="#ffd970"/></svg>',
	"g_demeter": '<svg viewBox="0 0 24 24"><path d="M12 23V5" stroke="#e8c060" stroke-width="1.6"/><g fill="#ffd970" stroke="#8a5a10" stroke-width=".5"><ellipse cx="12" cy="3.6" rx="1.6" ry="2.6"/><ellipse cx="9.4" cy="7.6" rx="1.5" ry="2.6" transform="rotate(-30 9.4 7.6)"/><ellipse cx="14.6" cy="7.6" rx="1.5" ry="2.6" transform="rotate(30 14.6 7.6)"/><ellipse cx="9.4" cy="12" rx="1.5" ry="2.6" transform="rotate(-30 9.4 12)"/><ellipse cx="14.6" cy="12" rx="1.5" ry="2.6" transform="rotate(30 14.6 12)"/><ellipse cx="9.6" cy="16.4" rx="1.5" ry="2.6" transform="rotate(-30 9.6 16.4)"/><ellipse cx="14.4" cy="16.4" rx="1.5" ry="2.6" transform="rotate(30 14.4 16.4)"/></g></svg>',
	"g_hestia": '<svg viewBox="0 0 24 24"><path d="M12 1.5c3.6 4 6 6.6 6 10a6 6 0 0 1-12 0c0-3.4 2.4-6 6-10z" fill="#ff9a3a" stroke="#ffe0a0" stroke-width="1"/><path d="M12 8c1.8 2 3 3.4 3 5a3 3 0 0 1-6 0c0-1.6 1.2-3 3-5z" fill="#fff0a0"/><path d="M4 19h16v3H4z" fill="#e8e0d0"/></svg>',
	"g_pan": '<svg viewBox="0 0 24 24"><g fill="#e0b070" stroke="#5a3410" stroke-width=".7"><path d="M3 3h3.4v18H3z"/><path d="M7.2 3h3.4v15H7.2z"/><path d="M11.4 3h3.4v12h-3.4z"/><path d="M15.6 3H19v9h-3.4z"/></g><path d="M2.4 7h17.2" stroke="#7a4a20" stroke-width="1.6"/></svg>',
	"g_persephone": '<svg viewBox="0 0 24 24"><circle cx="12" cy="14" r="8" fill="#d83a4a" stroke="#ffc0c8" stroke-width="1"/><path d="M9 6.4l1-3.4 2 2 2-2 1 3.4z" fill="#e85a6a" stroke="#ffc0c8" stroke-width=".7"/><ellipse cx="9.4" cy="11.6" rx="1.6" ry="2.4" fill="#fff" opacity=".45"/></svg>',
	"g_artemis": '<svg viewBox="0 0 24 24"><path d="M15 2.4A9.8 9.8 0 1 0 21.6 18 8 8 0 1 1 15 2.4z" fill="#e8f0ff" stroke="#fff" stroke-width=".8"/></svg>',
}

## The emblem icon name of a god ("" when unknown).
static func god_emblem(god: String) -> String:
	var k := "g_" + god.to_lower()
	return k if GODS.has(k) else ""

## tech key -> icon name
const BY_TECH := {
	"ballistics": "t_ballistics", "burning_pitch": "t_burning_pitch",
	"phobos_spear_of_panic": "t_phobos", "deimos_sword_of_dread": "t_phobos", "enyo_bow_of_horror": "t_enyo",
	"sarissa": "t_sarissa", "aegis_shield": "t_aegis", "sun_ray": "t_sun_ray", "shafts_of_plague": "t_shafts_of_plague",
	"forge_of_olympus": "t_forge_of_olympus", "olympian_weapons": "t_olympian_weapons", "harvest_of_souls": "t_harvest_of_souls",
	"tax_collectors": "t_tax_collectors", "ambassadors": "t_ambassadors", "coinage": "t_coinage",
	"omniscience": "t_omniscience", "olympian_parentage": "t_olympian_parentage", "labyrinth_of_minos": "t_labyrinth",
	"sylvan_lore": "t_sylvan_lore", "will_of_kronos": "t_will_of_kronos", "hymn_of_the_wildwood": "t_hymn",
	"oracle": "t_oracle", "temple_of_healing": "t_temple_of_healing", "golden_apples": "t_golden_apples",
	"dionysia": "t_dionysia", "face_of_the_gorgon": "t_face_of_the_gorgon", "monstrous_rage": "t_monstrous_rage",
	"pious_sacrifice": "t_pious_sacrifice",
}

## The icon of a tech: its line in its tier's metal for the Armory's generic
## lines ("copper_weapons" -> "t_weapons_copper"), else its own glyph.
static func icon_for(tech: String) -> String:
	var parts := tech.split("_")
	if parts.size() == 2 and TIERS.has(parts[0]) and TEMPLATES.has(parts[1]):
		return "t_%s_%s" % [parts[1], parts[0]]
	return BY_TECH.get(tech, "t_scroll")

## The SVG of an icon name ("" when it is not one of these).
static func svg(name: String) -> String:
	if SVG.has(name):
		return SVG[name]
	if GODS.has(name):
		return GODS[name]
	var parts := name.split("_")
	if parts.size() == 3 and parts[0] == "t" and TEMPLATES.has(parts[1]) and TIERS.has(parts[2]):
		var c: Array = TIERS[parts[2]]
		var t := str(TEMPLATES[parts[1]]).replace("$X", str(EXTRAS[parts[1]][parts[2]]))
		t = t.replace("$Y", PTERUGES if parts[1] == "armor" and parts[2] == "iron" else "")
		return t.replace("$A", c[0]).replace("$B", c[1]).replace("$C", c[2]).replace("$D", c[3])
	return ""

## The tier of an Armory line's tech (1 copper, 2 bronze, 3 iron), else 0.
static func tier_of(tech: String) -> int:
	var parts := tech.split("_")
	if parts.size() == 2 and TEMPLATES.has(parts[1]):
		return int(TIER_RANK.get(parts[0], 0))
	return 0

# ---- painted tiles ----------------------------------------------------------------
# A command button's icon is a baked tile: a background plate per tech family
# (a lit radial gradient with a vignette, like Retold's painted icons), the
# glyph embossed from its own silhouette (height = blurred alpha: key light
# from the top left, a specular glint, darker inner edges), a rim light in the
# family's glow colour on the far edges, a soft drop shadow and a halo on the
# plate. The "locked" variant is the same tile desaturated and darkened (an
# Armory tier keeps 30% of its metal's hue on the glyph, the plate stays grey).

## family plates: [centre, middle, edge, glow]
const PLATES := {
	"ember": ["#c8742a", "#46200a", "#0e0602", "#ffb060"],
	"sea": ["#3c9c98", "#123e40", "#030e10", "#b0fff0"],
	"steel": ["#6a9cc0", "#1e3c56", "#050c14", "#a8dcff"],
	"bronze": ["#b8903c", "#4a3410", "#100a02", "#ffd890"],
	"amber": ["#e8a030", "#6e3c0a", "#140802", "#ffc868"],
	"violet": ["#9466dc", "#341862", "#0a0416", "#e0b4ff"],
	"verdant": ["#6cb850", "#1e4c1a", "#040e04", "#c4f890"],
	"treasury": ["#3fa088", "#14423a", "#03100c", "#ffe48a"],
	"sky": ["#78b4ea", "#1c3c6e", "#040a18", "#d4ecff"],
	"dusk": ["#a8508a", "#3c1234", "#0c0208", "#ffb8e0"],
}
const PLATE_OF := {
	"t_weapons": "ember", "t_armor": "steel", "t_shields": "sea",
	"t_ballistics": "amber", "t_burning_pitch": "amber", "t_forge_of_olympus": "amber",
	"t_phobos": "dusk", "t_enyo": "dusk", "t_monstrous_rage": "dusk", "t_sarissa": "steel",
	"t_aegis": "bronze", "t_sun_ray": "sky", "t_shafts_of_plague": "verdant", "t_olympian_weapons": "violet",
	"t_harvest_of_souls": "violet", "t_omniscience": "sky", "t_olympian_parentage": "violet",
	"t_labyrinth": "amber", "t_sylvan_lore": "verdant", "t_will_of_kronos": "violet", "t_hymn": "verdant",
	"t_oracle": "sky", "t_temple_of_healing": "verdant", "t_golden_apples": "verdant", "t_dionysia": "violet",
	"t_face_of_the_gorgon": "verdant", "t_pious_sacrifice": "ember",
	"t_tax_collectors": "treasury", "t_ambassadors": "treasury", "t_coinage": "treasury", "t_scroll": "sky",
}

static var _tiles := {}

static func plate_of(name: String) -> String:
	if PLATE_OF.has(name):
		return PLATE_OF[name]
	var parts := name.split("_")
	if parts.size() == 3 and PLATE_OF.has("t_" + parts[1]):
		return PLATE_OF["t_" + parts[1]]
	return "sky"

## The plate's glow colour (frames and halos use it).
static func glow_of(name: String) -> Color:
	return Color(str(PLATES[plate_of(name)][3]))

## The baked tile of an icon at px x px; variant "normal" or "locked".
static func tile(name: String, px: int, variant := "normal") -> Texture2D:
	var key := "%s@%d:%s" % [name, px, variant]
	if _tiles.has(key):
		return _tiles[key]
	var img := bake(name, px, variant == "locked")
	var tex: Texture2D = ImageTexture.create_from_image(img) if img else null
	_tiles[key] = tex
	return tex

static var _warm: Array = []
static var _warm_init := false

## Bake one more tile of the warm-up list (every tech icon at the command
## grid's 64 px, normal and locked, and the card's 32 px), so selecting a
## building never stalls on ~10 ms per tile. Call once per frame; false when done.
static func prewarm_step() -> bool:
	if not _warm_init:
		_warm_init = true
		var names := []
		for t in TIERS:
			for l in TEMPLATES:
				names.append("t_%s_%s" % [l, t])
		for k in SVG:
			if PLATE_OF.has(k):
				names.append(k)
		for nm in names:
			_warm.append([nm, 64, "normal"])
		for nm in names:
			_warm.append([nm, 64, "locked"])
		for nm in names:
			_warm.append([nm, 32, "normal"])
	if _warm.is_empty():
		return false
	var w: Array = _warm.pop_front()
	tile(str(w[0]), int(w[1]), str(w[2]))
	return true

static func _blur(src: PackedFloat32Array, n: int, r: int) -> PackedFloat32Array:
	# two box passes per axis (close to a gaussian), clamped edges
	var a := src
	for pass_ in 2:
		var b := PackedFloat32Array()
		b.resize(n * n)
		var inv := 1.0 / float(2 * r + 1)
		for y in n:
			var row := y * n
			var acc := 0.0
			for k in range(-r, r + 1):
				acc += a[row + clampi(k, 0, n - 1)]
			for x in n:
				b[row + x] = acc * inv
				acc += a[row + mini(x + r + 1, n - 1)] - a[row + maxi(x - r, 0)]
		var c := PackedFloat32Array()
		c.resize(n * n)
		for x in n:
			var acc := 0.0
			for k in range(-r, r + 1):
				acc += b[clampi(k, 0, n - 1) * n + x]
			for y in n:
				c[y * n + x] = acc * inv
				acc += b[mini(y + r + 1, n - 1) * n + x] - b[maxi(y - r, 0) * n + x]
		a = c
	return a

## Bake a tile (see above). Pure Image work: safe on a worker thread.
static func bake(name: String, n: int, locked := false) -> Image:
	var src := svg(name)
	if src.is_empty():
		return null
	var pl: Array = PLATES[plate_of(name)]
	var c0 := Color(str(pl[0]))
	var c1 := Color(str(pl[1]))
	var c2 := Color(str(pl[2]))
	var gl := Color(str(pl[3]))
	var nparts := name.split("_")
	var tint := 0.3 if nparts.size() == 3 and TIERS.has(nparts[2]) else 0.0
	var gs := int(round(n * 0.9))
	var g := Image.new()
	if g.load_svg_from_string(src, float(gs) / 24.0) != OK:
		return null
	g.convert(Image.FORMAT_RGBA8)
	var ox := (n - g.get_width()) / 2
	var oy := (n - g.get_height()) / 2 - int(n * 0.01)
	var gd := g.get_data()
	var gw := g.get_width()
	var gh := g.get_height()
	# the glyph's colour and alpha on the tile grid
	var N := n * n
	var A := PackedFloat32Array()
	A.resize(N)
	var R := PackedFloat32Array()
	R.resize(N * 3)
	for y in gh:
		var ty := y + oy
		if ty < 0 or ty >= n:
			continue
		for x in gw:
			var tx := x + ox
			if tx < 0 or tx >= n:
				continue
			var si := (y * gw + x) * 4
			var ti := ty * n + tx
			var a := gd[si + 3] / 255.0
			A[ti] = a
			if a > 0.0:
				R[ti * 3] = gd[si] / 255.0
				R[ti * 3 + 1] = gd[si + 1] / 255.0
				R[ti * 3 + 2] = gd[si + 2] / 255.0
	var u := maxf(1.0, n / 48.0)
	var H := _blur(A, n, maxi(1, int(round(1.6 * u))))
	var SH := _blur(A, n, maxi(1, int(round(2.4 * u))))
	var GL := _blur(A, n, maxi(2, int(round(6.0 * u))))
	var sdx := int(round(1.4 * u))
	var sdy := int(round(2.2 * u))
	var L := Vector3(-0.55, -0.7, 0.62).normalized()
	var Hv := (L + Vector3(0, 0, 1)).normalized()
	var k := 9.0 * u
	var out := PackedByteArray()
	out.resize(N * 4)
	var inv := 1.0 / float(n)
	for y in n:
		for x in n:
			var i := y * n + x
			# plate: radial light from the upper middle, vignette, a top sheen
			var fx := (x + 0.5) * inv
			var fy := (y + 0.5) * inv
			var d := Vector2(fx - 0.46, fy - 0.36).length() / 0.78
			var col: Color
			if d < 0.5:
				col = c0.lerp(c1, d / 0.5)
			else:
				col = c1.lerp(c2, clampf((d - 0.5) / 0.5, 0.0, 1.0))
			var e := maxf(absf(fx - 0.5), absf(fy - 0.5)) * 2.0
			var vig := 1.0 - 0.45 * clampf((e - 0.62) / 0.38, 0.0, 1.0)
			var pr := col.r * vig
			var pg := col.g * vig
			var pb := col.b * vig
			# the glyph's halo and drop shadow on the plate
			var gv := GL[i]
			pr += gl.r * gv * 0.32
			pg += gl.g * gv * 0.32
			pb += gl.b * gv * 0.32
			var sx := x - sdx
			var sy := y - sdy
			if sx >= 0 and sy >= 0:
				var sh := SH[sy * n + sx] * 0.78
				pr *= 1.0 - sh
				pg *= 1.0 - sh
				pb *= 1.0 - sh
			var a := A[i]
			var r := pr
			var gg := pg
			var b := pb
			if a > 0.0:
				var xl := maxi(x - 1, 0)
				var xr := mini(x + 1, n - 1)
				var yu := maxi(y - 1, 0)
				var yd := mini(y + 1, n - 1)
				var nx := (H[y * n + xl] - H[y * n + xr]) * k
				var ny := (H[yu * n + x] - H[yd * n + x]) * k
				var nv := Vector3(nx, ny, 1.0).normalized()
				var diff := maxf(nv.dot(L), 0.0)
				var spec := pow(maxf(nv.dot(Hv), 0.0), 28.0) * 0.55
				var h := H[i]
				var edge := clampf((h - 0.25) / 0.6, 0.0, 1.0)
				var shade := (0.5 + 0.62 * diff) * (0.72 + 0.28 * edge)
				# rim light: the far (bottom-right) slopes catch the plate's glow
				var rim := clampf(-nx * 0.5 - ny * 0.6, 0.0, 1.0) * (1.0 - edge) * 0.65
				var cr := R[i * 3] * shade + spec + gl.r * rim
				var cg := R[i * 3 + 1] * shade + spec + gl.g * rim
				var cb := R[i * 3 + 2] * shade + spec + gl.b * rim
				r = lerpf(pr, cr, a)
				gg = lerpf(pg, cg, a)
				b = lerpf(pb, cb, a)
			# a glassy sheen on the upper third
			var sheen := clampf(1.0 - fy / 0.42, 0.0, 1.0) * 0.07
			r += sheen
			gg += sheen
			b += sheen
			if locked:
				var l := r * 0.3 + gg * 0.55 + b * 0.15
				var lr := l * 0.56 + 0.02
				var lg := l * 0.58 + 0.025
				var lb := l * 0.64 + 0.035
				if tint > 0.0 and a > 0.0:
					# a tier's metal keeps a trace of its hue on the glyph only
					# (copper rust, bronze ochre, iron slate), so the three tiers
					# still read apart once locked; the plate stays grey
					var w := tint * a
					lr = lerpf(lr, r * 0.62, w)
					lg = lerpf(lg, gg * 0.62, w)
					lb = lerpf(lb, b * 0.62, w)
				r = lr
				gg = lg
				b = lb
			out[i * 4] = int(clampf(r, 0.0, 1.0) * 255.0)
			out[i * 4 + 1] = int(clampf(gg, 0.0, 1.0) * 255.0)
			out[i * 4 + 2] = int(clampf(b, 0.0, 1.0) * 255.0)
			out[i * 4 + 3] = 255
	return Image.create_from_data(n, n, false, Image.FORMAT_RGBA8, out)

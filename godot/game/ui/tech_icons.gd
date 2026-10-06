extends RefCounted
## Tech and market icons (ui piece, Godot-only; no icons.js counterpart): one
## glyph per tech line of the Greek Armory, Market and Temple (Age of
## Mythology: Retold's command grid, reference/techs/ui_02.jpg) as 24-unit SVGs,
## and the painted tile a command button shows (tile(): the icon's own painted
## backdrop, the picture lit into it, see "painted tiles" below).
## The pictures a player sees are rendered 3D models (tech_models.gd, "the
## 3D studio" below); these SVGs are the headless fallback.
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
	"weapons": '<svg viewBox="0 0 24 24"><defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e0a86a"/><stop offset=".5" stop-color="#8a5428"/><stop offset="1" stop-color="#3a1e0a"/></linearGradient><linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="$B"/><stop offset=".42" stop-color="$A"/><stop offset="1" stop-color="$D"/></linearGradient></defs>$W$X</svg>',
	"armor": '<svg viewBox="0 0 24 24"><defs><linearGradient id="m" x1="0" y1="0" x2="1" y2=".7"><stop offset="0" stop-color="$B"/><stop offset=".4" stop-color="$A"/><stop offset="1" stop-color="$D"/></linearGradient></defs>$Y<path d="M6.8 2.8h2.8c.8 1.4 1.6 2 2.4 2s1.6-.6 2.4-2h2.8l3 3.8-2.4 2.4v8.8c-1.6 1.8-3.8 2.8-5.8 2.8s-4.2-1-5.8-2.8V9l-2.4-2.4z" fill="url(#m)" stroke="$C" stroke-width="1.1"/><path d="M7.4 9.6c1.6 2 3.4 2 4.6.4 1.2 1.6 3 1.6 4.6-.4" stroke="$D" stroke-width="1.3" fill="none"/><path d="M7.6 9.2c1.4 1.5 2.8 1.6 3.9.6" stroke="$B" stroke-width=".7" fill="none"/><path d="M12 10.8v8.6" stroke="$D" stroke-width="1"/><path d="M9.4 13.8c1.6.5 3.6.5 5.2 0M9.6 16.6c1.5.5 3.3.5 4.8 0" stroke="$D" stroke-width=".9" fill="none"/><path d="M8 4.2l1.8 3.4M7.4 9.8v7" stroke="$B" stroke-width=".9" opacity=".8"/><path d="M6.8 2.8h2.8l.6 1.4H7.6zM14.6 2.8h2.8l-.8 1.4H14z" fill="#5a3418"/>$X</svg>',
	"shields": '<svg viewBox="0 0 24 24"><defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="$B"/><stop offset=".45" stop-color="$A"/><stop offset="1" stop-color="$D"/></linearGradient><radialGradient id="d" cx=".36" cy=".32" r=".78"><stop offset="0" stop-color="$B"/><stop offset=".35" stop-color="$A"/><stop offset="1" stop-color="$D"/></radialGradient></defs><circle cx="12" cy="12" r="10.4" fill="$C"/><circle cx="12" cy="12" r="9.6" fill="url(#m)"/><circle cx="12" cy="12" r="7.6" fill="$C" opacity=".7"/><circle cx="12" cy="12" r="7.1" fill="url(#d)"/>$X<path d="M5.4 9.6a7.2 7.2 0 0 1 5-5.2" stroke="#fff" stroke-width="1.2" opacity=".6" fill="none" stroke-linecap="round"/><path d="M3.4 10.4a8.8 8.8 0 0 1 6-6.8" stroke="#fff" stroke-width=".6" opacity=".45" fill="none" stroke-linecap="round"/></svg>',
}

## The weapons line's blades per tier, so the tiers differ by silhouette and
## not only by metal: copper one spear, bronze two crossed spears, iron the
## crossed spears behind an upright xiphos (one, two, three blades).
const WEAPON_SPEAR := '<path d="M2.4 21.6L12.6 11.4" stroke="$C" stroke-width="4.4" stroke-linecap="round"/><path d="M2.4 21.6L12.6 11.4" stroke="url(#s)" stroke-width="2.8" stroke-linecap="round"/><path d="M1.8 22.2l2-2" stroke="$C" stroke-width="3.2" stroke-linecap="round"/><path d="M1.8 22.2l2-2" stroke="$A" stroke-width="1.8" stroke-linecap="round"/><path d="M10.6 13.4C10.6 7.6 15 3 22 2 21 9 16.4 13.4 10.6 13.4z" fill="url(#m)" stroke="$C" stroke-width=".9"/><path d="M10.6 13.4C10.6 7.6 15 3 22 2L12.2 11.8z" fill="$B" opacity=".35"/><path d="M12.4 11.6L20.6 3.4" stroke="$D" stroke-width="1"/><path d="M12.9 11.1L20.4 3.6" stroke="$B" stroke-width=".45" opacity=".9"/><path d="M10 12.2l1.8 1.8" stroke="$C" stroke-width="3.4" stroke-linecap="round"/><path d="M10 12.2l1.8 1.8" stroke="url(#m)" stroke-width="2" stroke-linecap="round"/>'
const WEAPON_SWORD := '<path d="M12 1.4C13.7 3.9 14.2 7.8 13.5 15h-3C9.8 7.8 10.3 3.9 12 1.4z" fill="url(#m)" stroke="$C" stroke-width=".85"/><path d="M12 2.8v11.8" stroke="$D" stroke-width=".7"/><path d="M11.3 3.6c-.5 3-.6 6.6-.3 10.8" stroke="$B" stroke-width=".55"/><rect x="8.4" y="14.6" width="7.2" height="1.9" rx=".8" fill="url(#m)" stroke="$C" stroke-width=".6"/><rect x="11" y="16.5" width="2" height="4.2" fill="#6a3c1c" stroke="$C" stroke-width=".5"/><circle cx="12" cy="21.5" r="1.35" fill="url(#m)" stroke="$C" stroke-width=".5"/>'
const WEAPON_BLADES := {
	"copper": WEAPON_SPEAR,
	"bronze": '<g transform="matrix(-1 0 0 1 24 0)">' + WEAPON_SPEAR + '</g>' + WEAPON_SPEAR,
	"iron": '<g transform="matrix(-1 0 0 1 24 0)">' + WEAPON_SPEAR + '</g>' + WEAPON_SPEAR + WEAPON_SWORD,
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
	"t_burning_pitch": '<svg viewBox="0 0 24 24"><defs><radialGradient id="f" cx=".55" cy=".75" r=".8"><stop offset="0" stop-color="#fff6c0"/><stop offset=".3" stop-color="#ffc040"/><stop offset=".7" stop-color="#f05a1a"/><stop offset="1" stop-color="#8a1a06"/></radialGradient><linearGradient id="h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#a8b6c2"/><stop offset="1" stop-color="#3c4650"/></linearGradient></defs><path d="M3.4 16.2C2 11.4 4.6 7.2 8 6c-.4 1.8.4 3 1.6 3.2-.2-3.2 2-6.4 5.6-8 -.8 2.4 0 4.2 1.4 5.2 1.8 1.4 2 4.4.4 6.6-2.4 3.4-9.6 6.6-13.6 3.2z" fill="url(#f)" stroke="#5a1404" stroke-width=".9"/><path d="M6.2 14.6C5.4 12.2 6.6 10.2 8.4 9.6c0 1.2.6 1.8 1.4 1.8.2-2 1.4-3.8 3.4-4.6-.4 1.4.2 2.4 1 3 1 .8 1 2.6 0 3.6-1.8 2-5.6 3.2-8 1.2z" fill="#fff6c0" opacity=".9"/><path d="M2.4 21.6L15.6 8.4" stroke="#2a1406" stroke-width="3.4" stroke-linecap="round"/><path d="M2.4 21.6L15.6 8.4" stroke="#b07c4a" stroke-width="1.9" stroke-linecap="round"/><path d="M22.6 1.4l-3.2 8.2-2-3-3-2z" fill="url(#h)" stroke="#1a1e22" stroke-width=".8"/><path d="M1.8 22.2l1-4.2 2.2 2.2zM1.8 22.2l4.2-1-2.2-2.2z" fill="#efe6cf" stroke="#4a3a2a" stroke-width=".5"/></svg>',
	"t_phobos": '<svg viewBox="0 0 24 24"><defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffd8b8"/><stop offset=".45" stop-color="#e8502c"/><stop offset="1" stop-color="#6a1008"/></linearGradient><linearGradient id="w" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e0a878"/><stop offset="1" stop-color="#5a3014"/></linearGradient></defs><path d="M6.4 3.6l2.8 2.2-1.8.9 2.6 2.4M17.6 3.6l-2.8 2.2 1.8.9-2.6 2.4M3.6 10.2l3.8.7-1.1 1.5 3.4.4M20.4 10.2l-3.8.7 1.1 1.5-3.4.4" stroke="#4a0804" stroke-width="2.6" fill="none" stroke-linejoin="round" stroke-linecap="round"/><path d="M6.4 3.6l2.8 2.2-1.8.9 2.6 2.4M17.6 3.6l-2.8 2.2 1.8.9-2.6 2.4M3.6 10.2l3.8.7-1.1 1.5 3.4.4M20.4 10.2l-3.8.7 1.1 1.5-3.4.4" stroke="#ff6a40" stroke-width="1.3" fill="none" stroke-linejoin="round" stroke-linecap="round"/><rect x="10.6" y="12" width="2.8" height="11.2" rx="1.1" fill="url(#w)" stroke="#2a1406" stroke-width=".8"/><path d="M10.6 16.4h2.8M10.6 18.2h2.8" stroke="#2a1406" stroke-width=".6"/><rect x="10" y="11.2" width="4" height="2.6" rx=".7" fill="#d8a040" stroke="#3a2008" stroke-width=".6"/><path d="M12 .6C14.8 3.8 16 7.4 15.2 10.4L13.6 12h-3.2L8.8 10.4C8 7.4 9.2 3.8 12 .6z" fill="url(#b)" stroke="#3a0804" stroke-width=".9"/><path d="M12 2.4v9.2" stroke="#7a1808" stroke-width=".9"/><path d="M11.2 3.4c-1.1 2.1-1.5 4.2-1.1 6.4" stroke="#fff0e0" stroke-width=".7" fill="none" opacity=".85"/></svg>',
	"t_deimos": '<svg viewBox="0 0 24 24"><defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f8fb"/><stop offset=".5" stop-color="#9aa8b4"/><stop offset="1" stop-color="#36404a"/></linearGradient></defs><path d="M2.6 9.4c2-3.2 5.2-2 6.2-4.4M14.6 21.4c3.2-.8 3.2-4 6.4-4.2" stroke="#b070e0" stroke-width="2.2" fill="none" stroke-linecap="round" opacity=".75"/><path d="M7.4 16.6C9 11 12.6 6 21 2.2 21.8 7.4 18.6 12.4 12.6 15.2 11 16 9.6 16.8 8.8 18z" fill="url(#m)" stroke="#141a20" stroke-width=".9"/><path d="M9.2 15.2C11.2 10.6 14.8 6.4 20.2 3.4" stroke="#fff" stroke-width=".7" fill="none" opacity=".85"/><path d="M5.2 15.4l5 4.4" stroke="#2a1406" stroke-width="3.2" stroke-linecap="round"/><path d="M5.2 15.4l5 4.4" stroke="#d8a040" stroke-width="1.9" stroke-linecap="round"/><path d="M7.4 18.6L3.4 22" stroke="#2a1406" stroke-width="3.4" stroke-linecap="round"/><path d="M7.4 18.6L3.4 22" stroke="#8a4220" stroke-width="2" stroke-linecap="round"/><circle cx="2.9" cy="22.3" r="1.5" fill="#d8a040" stroke="#2a1406" stroke-width=".6"/></svg>',
	"t_enyo": '<svg viewBox="0 0 24 24"><defs><linearGradient id="w" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e8b07a"/><stop offset=".6" stop-color="#8a4a20"/><stop offset="1" stop-color="#3a1a08"/></linearGradient></defs><circle cx="20.6" cy="12" r="3.6" fill="#ff3a6a" opacity=".35"/><path d="M8.6 2C14.8 4.6 16.6 8.6 15.8 12 16.6 15.4 14.8 19.4 8.6 22M8.6 2C7.6 1.2 6.2 1.4 6.2 1.4M8.6 22C7.6 22.8 6.2 22.6 6.2 22.6" stroke="#2a1006" stroke-width="3.8" fill="none" stroke-linecap="round"/><path d="M8.6 2C14.8 4.6 16.6 8.6 15.8 12 16.6 15.4 14.8 19.4 8.6 22M8.6 2C7.6 1.2 6.2 1.4 6.2 1.4M8.6 22C7.6 22.8 6.2 22.6 6.2 22.6" stroke="url(#w)" stroke-width="2.3" fill="none" stroke-linecap="round"/><path d="M8.6 2L5 12l3.6 10" stroke="#f3e6c8" stroke-width=".8" fill="none"/><rect x="14.6" y="10.2" width="2.6" height="3.6" rx=".6" fill="#8a1a14" stroke="#2a0604" stroke-width=".5"/><path d="M4.8 12H20" stroke="#2a1006" stroke-width="2.2"/><path d="M4.8 12H20" stroke="#e0c090" stroke-width="1.1"/><path d="M23.6 12l-4.6-2.8v5.6z" fill="#ff4a3a" stroke="#4a0806" stroke-width=".6"/><path d="M5 12L2.2 9.2h2.8L7.4 12zM5 12l-2.8 2.8h2.8L7.4 12z" fill="#c03aa0" stroke="#3a0a30" stroke-width=".5"/></svg>',
	"t_sarissa": '<svg viewBox="0 0 24 24"><defs><linearGradient id="h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#a8b6c2"/><stop offset="1" stop-color="#3c4650"/></linearGradient></defs><g stroke-linecap="round"><path d="M10.4 23.2L4.8 6.2M12 23.2V5.4M13.6 23.2l5.6-17" stroke="#2a1406" stroke-width="2.8"/><path d="M10.4 23.2L4.8 6.2M12 23.2V5.4M13.6 23.2l5.6-17" stroke="#c08a52" stroke-width="1.4"/></g><g transform="translate(4.4 4.4) rotate(-18)"><path d="M0 -3.8C1.5 -1.8 1.8 .6 1 2.4H-1C-1.8 .6 -1.5 -1.8 0 -3.8z" fill="url(#h)" stroke="#20262c" stroke-width=".6"/><path d="M0 -2.8V2.2" stroke="#fff" stroke-width=".4" opacity=".8"/></g><g transform="translate(12 3.4) rotate(0)"><path d="M0 -3.8C1.5 -1.8 1.8 .6 1 2.4H-1C-1.8 .6 -1.5 -1.8 0 -3.8z" fill="url(#h)" stroke="#20262c" stroke-width=".6"/><path d="M0 -2.8V2.2" stroke="#fff" stroke-width=".4" opacity=".8"/></g><g transform="translate(19.6 4.4) rotate(18)"><path d="M0 -3.8C1.5 -1.8 1.8 .6 1 2.4H-1C-1.8 .6 -1.5 -1.8 0 -3.8z" fill="url(#h)" stroke="#20262c" stroke-width=".6"/><path d="M0 -2.8V2.2" stroke="#fff" stroke-width=".4" opacity=".8"/></g><path d="M7.6 16.2h8.8" stroke="#4a0806" stroke-width="3" stroke-linecap="round"/><path d="M7.6 16.2h8.8" stroke="#d8402a" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16.2" r="1.6" fill="#e0b040" stroke="#4a3008" stroke-width=".6"/></svg>',
	"t_aegis": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.6" fill="#4a3008"/><circle cx="12" cy="12" r="8.7" fill="#d9a83a"/><circle cx="12" cy="12" r="7.2" fill="none" stroke="#ffe9a0" stroke-width=".8"/><path d="M8.4 9C6.6 8 6.2 6 7.4 4.8M10 7.8c-.4-1.8.4-3.2 2-3.8M14 7.8c.4-1.8-.4-3.2-2-3.8M15.6 9c1.8-1 2.2-3 1-4.2M8.2 14.6c-1.8.8-2.4 2.6-1.4 4M15.8 14.6c1.8.8 2.4 2.6 1.4 4" stroke="#3d7a2a" stroke-width="1.3" fill="none" stroke-linecap="round"/><circle cx="12" cy="12.4" r="3.8" fill="#efd2a8" stroke="#6a4a20" stroke-width=".7"/><circle cx="10.6" cy="11.8" r=".7" fill="#1a1006"/><circle cx="13.4" cy="11.8" r=".7" fill="#1a1006"/><path d="M10.6 14.2q1.4.9 2.8 0" stroke="#6a1a10" stroke-width=".8" fill="none"/></svg>',
	"t_sun_ray": '<svg viewBox="0 0 24 24"><path d="M12 .8l1.3 4.4h-2.6zM12 23.2l1.3-4.4h-2.6zM.8 12l4.4 1.3v-2.6zM23.2 12l-4.4 1.3v-2.6zM4.1 4.1l4 2.2-1.8 1.8zM19.9 19.9l-4-2.2 1.8-1.8zM19.9 4.1l-2.2 4-1.8-1.8zM4.1 19.9l2.2-4 1.8 1.8z" fill="#f2c14e" stroke="#8a5a10" stroke-width=".4"/><circle cx="12" cy="12" r="5.2" fill="#ffd970" stroke="#fff4c0" stroke-width="1"/><circle cx="10.6" cy="10.6" r="1.8" fill="#fff8dc" opacity=".8"/></svg>',
	"t_shafts_of_plague": '<svg viewBox="0 0 24 24"><path d="M2.6 2.6l11.6 11.6" stroke="#2a1406" stroke-width="3.2" stroke-linecap="round"/><path d="M2.6 2.6l11.6 11.6" stroke="#a87444" stroke-width="1.8" stroke-linecap="round"/><path d="M16.4 16.4l-5.4-1.4 4-4z" fill="#7cc84a" stroke="#1d4410" stroke-width=".7"/><path d="M2.2 2.2l4.6.6-2 2zM2.2 2.2l.6 4.6 2-2z" fill="#efe6cf" stroke="#4a3a2a" stroke-width=".5"/><path d="M18.6 13c1.7 2.4 2.5 3.6 2.5 4.8a2.5 2.5 0 0 1-5 0c0-1.2.8-2.4 2.5-4.8zM12.6 17.4c1.2 1.6 1.7 2.4 1.7 3.2a1.7 1.7 0 0 1-3.4 0c0-.8.5-1.6 1.7-3.2zM20 4.6c1.2 1.6 1.7 2.4 1.7 3.2a1.7 1.7 0 0 1-3.4 0c0-.8.5-1.6 1.7-3.2z" fill="#8ad85a" stroke="#1d4410" stroke-width=".7"/></svg>',
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
	"t_monstrous_rage": '<svg viewBox="0 0 24 24"><defs><linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff8e4"/><stop offset=".6" stop-color="#d8c49a"/><stop offset="1" stop-color="#7a6440"/></linearGradient><radialGradient id="f" cx=".42" cy=".3" r=".8"><stop offset="0" stop-color="#ff8a5a"/><stop offset=".4" stop-color="#c0261a"/><stop offset="1" stop-color="#4a0606"/></radialGradient><radialGradient id="m" cx=".5" cy=".35" r=".7"><stop offset="0" stop-color="#f0a080"/><stop offset="1" stop-color="#8a2a1a"/></radialGradient></defs><path d="M8.2 7.6C4.2 7 1.8 4.4 2.2.8 3.8 3.4 6 4.4 9.6 5.2zM15.8 7.6c4-.6 6.4-3.2 6-6.8-1.6 2.6-3.8 3.6-7.4 4.4z" fill="url(#h)" stroke="#2a1806" stroke-width=".8" stroke-linejoin="round"/><path d="M7 6.4C9 5 15 5 17 6.4l1.8 3.2c-.6 1.4-1.6 2-2.6 2.4l-.6 6.4c-.6 3-2 4.2-3.6 4.2s-3-1.2-3.6-4.2L7.8 12c-1-.4-2-1-2.6-2.4z" fill="url(#f)" stroke="#1e0202" stroke-width=".9" stroke-linejoin="round"/><path d="M8 10.2l4 1.6 4-1.6" stroke="#1e0202" stroke-width="1.3" fill="none" stroke-linejoin="round"/><path d="M8.6 11.4l2.6 1.1-.4 1.1-2-.7zM15.4 11.4l-2.6 1.1.4 1.1 2-.7z" fill="#ffe040" stroke="#5a1000" stroke-width=".4"/><ellipse cx="12" cy="19.4" rx="3.2" ry="2.5" fill="url(#m)" stroke="#2a0404" stroke-width=".6"/><ellipse cx="10.8" cy="19.6" rx=".7" ry=".9" fill="#1e0202"/><ellipse cx="13.2" cy="19.6" rx=".7" ry=".9" fill="#1e0202"/><path d="M9.6 6.6c1.4-.6 3.4-.6 4.8 0" stroke="#ffb8a0" stroke-width=".7" fill="none" opacity=".8" stroke-linecap="round"/><path d="M3.2 1.8c.8 1.6 2 2.6 4 3.2" stroke="#fff" stroke-width=".5" fill="none" opacity=".8"/></svg>',
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
	"phobos_spear_of_panic": "t_phobos", "deimos_sword_of_dread": "t_deimos", "enyo_bow_of_horror": "t_enyo",
	"sarissa": "t_sarissa", "aegis_shield": "t_aegis", "sun_ray": "t_sun_ray", "shafts_of_plague": "t_shafts_of_plague",
	"forge_of_olympus": "t_forge_of_olympus", "olympian_weapons": "t_olympian_weapons", "harvest_of_souls": "t_harvest_of_souls",
	"tax_collectors": "t_tax_collectors", "ambassadors": "t_ambassadors", "coinage": "t_coinage",
	"omniscience": "t_omniscience", "olympian_parentage": "t_olympian_parentage", "labyrinth_of_minos": "t_labyrinth",
	"sylvan_lore": "t_sylvan_lore", "will_of_kronos": "t_will_of_kronos", "hymn_of_the_wildwood": "t_hymn",
	"oracle": "t_oracle", "temple_of_healing": "t_temple_of_healing", "golden_apples": "t_golden_apples",
	"dionysia": "t_dionysia", "face_of_the_gorgon": "t_face_of_the_gorgon", "monstrous_rage": "t_monstrous_rage",
	"pious_sacrifice": "t_pious_sacrifice",
}

## Egyptian tech -> its god (the headless SVG fallback draws the god's sign)
const EGYPT_GOD := {
	"hands_of_the_pharaoh": "ra",
	"skin_of_the_rhino": "ra",
	"flood_of_the_nile": "isis",
	"clairvoyance": "set",
	"criosphinx": "bast",
	"hieracosphinx": "bast",
	"sacred_cats": "bast",
	"adze_of_wepwawet": "bast",
	"scalloped_axe": "ptah",
	"leather_frame_shield": "ptah",
	"electrum_bullets": "ptah",
	"shaduf": "ptah",
	"feet_of_the_jackal": "anubis",
	"serpent_spear": "anubis",
	"necropolis": "anubis",
	"sun_dried_mud_brick": "sobek",
	"crocodilopolis": "sobek",
	"dark_water": "sobek",
	"solar_barque": "sobek",
	"bone_bow": "sekhmet",
	"slings_of_the_sun": "sekhmet",
	"crimson_linen": "sekhmet",
	"force_of_the_west_wind": "sekhmet",
	"funeral_rites": "nephthys",
	"spirit_of_maat": "nephthys",
	"nebty": "nephthys",
	"funeral_barge": "nephthys",
	"new_kingdom": "osiris",
	"desert_wind": "osiris",
	"atef_crown": "osiris",
	"axe_of_vengeance": "horus",
	"greatest_of_fifty": "horus",
	"spear_of_horus": "horus",
	"valley_of_the_kings": "thoth",
	"book_of_thoth": "thoth",
	"tusks_of_apedemak": "thoth",
}

## The icon of a tech: its line in its tier's metal for the Armory's generic
## lines ("copper_weapons" -> "t_weapons_copper"), else its own glyph.
static func icon_for(tech: String) -> String:
	var parts := tech.split("_")
	if parts.size() == 2 and TIERS.has(parts[0]) and TEMPLATES.has(parts[1]):
		return "t_%s_%s" % [parts[1], parts[0]]
	if EGYPT_GOD.has(tech):
		return "e_" + tech   # an Egyptian tech: its own model (egypt_tech_models.gd)
	return BY_TECH.get(tech, "t_scroll")

## The SVG of an icon name ("" when it is not one of these).
static func svg(name: String) -> String:
	if SVG.has(name):
		return SVG[name]
	if GODS.has(name):
		return GODS[name]
	if name.begins_with("e_") and EGYPT_GOD.has(name.substr(2)):
		return _egypt_fallback(name.substr(2))
	if name.begins_with("g_") and GOD_BUSTS.has(name.substr(2)):
		# headless: the god's hieroglyph in gold (with a renderer: his bust)
		var EI = load("res://game/ui/egypt_icons.gd")
		return str(EI.SVG.get("mg_" + name.substr(2), "")).replace("currentColor", "#f2c14e")
	var parts := name.split("_")
	if parts.size() == 3 and parts[0] == "t" and TEMPLATES.has(parts[1]) and TIERS.has(parts[2]):
		var c: Array = TIERS[parts[2]]
		var t := str(TEMPLATES[parts[1]]).replace("$X", str(EXTRAS[parts[1]][parts[2]]))
		t = t.replace("$Y", PTERUGES if parts[1] == "armor" and parts[2] == "iron" else "")
		t = t.replace("$W", str(WEAPON_BLADES[parts[2]]) if parts[1] == "weapons" else "")
		return t.replace("$A", c[0]).replace("$B", c[1]).replace("$C", c[2]).replace("$D", c[3])
	return ""

## The headless fallback of an Egyptian tech's picture (no renderer: the
## model is not drawn): its god's hieroglyph (egypt_icons.gd) in gold on a dark
## outline; with a renderer every Egyptian tech is its own 3D model.
static func _egypt_fallback(tech: String) -> String:
	var god := str(EGYPT_GOD.get(tech, ""))
	var EI = load("res://game/ui/egypt_icons.gd")
	var src := str(EI.SVG.get("mg_" + god, EI.SVG.get(god, EI.SVG["empower"])))
	return src.replace("currentColor", "#f2c14e")

## The tier of an Armory line's tech (1 copper, 2 bronze, 3 iron), else 0.
static func tier_of(tech: String) -> int:
	var parts := tech.split("_")
	if parts.size() == 2 and TEMPLATES.has(parts[1]):
		return int(TIER_RANK.get(parts[0], 0))
	return 0

# ---- painted tiles ----------------------------------------------------------------
# A command button's icon is a baked tile: the icon's own painted backdrop
# (BACKDROPS: a scene per line, like Retold's painted icons; the PLATES
# families below only colour the SVG fallback's rim light), the
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
	"t_phobos": "dusk", "t_deimos": "dusk", "t_enyo": "dusk", "t_monstrous_rage": "dusk", "t_sarissa": "steel",
	"t_aegis": "sea", "t_sun_ray": "sky", "t_shafts_of_plague": "verdant", "t_olympian_weapons": "violet",
	"t_harvest_of_souls": "violet", "t_omniscience": "sky", "t_olympian_parentage": "violet",
	"t_labyrinth": "amber", "t_sylvan_lore": "verdant", "t_will_of_kronos": "violet", "t_hymn": "verdant",
	"t_oracle": "sky", "t_temple_of_healing": "verdant", "t_golden_apples": "verdant", "t_dionysia": "violet",
	"t_face_of_the_gorgon": "verdant", "t_pious_sacrifice": "ember",
	"t_tax_collectors": "treasury", "t_ambassadors": "treasury", "t_coinage": "treasury", "t_scroll": "sky",
	"e_hands_of_the_pharaoh": "amber",
	"e_skin_of_the_rhino": "amber",
	"e_flood_of_the_nile": "sea",
	"e_clairvoyance": "dusk",
	"e_criosphinx": "amber",
	"e_hieracosphinx": "amber",
	"e_sacred_cats": "amber",
	"e_adze_of_wepwawet": "amber",
	"e_scalloped_axe": "bronze",
	"e_leather_frame_shield": "bronze",
	"e_electrum_bullets": "bronze",
	"e_shaduf": "bronze",
	"e_feet_of_the_jackal": "violet",
	"e_serpent_spear": "violet",
	"e_necropolis": "violet",
	"e_sun_dried_mud_brick": "verdant",
	"e_crocodilopolis": "verdant",
	"e_dark_water": "verdant",
	"e_solar_barque": "verdant",
	"e_bone_bow": "ember",
	"e_slings_of_the_sun": "ember",
	"e_crimson_linen": "ember",
	"e_force_of_the_west_wind": "ember",
	"e_funeral_rites": "sky",
	"e_spirit_of_maat": "sky",
	"e_nebty": "sky",
	"e_funeral_barge": "sky",
	"e_new_kingdom": "verdant",
	"e_desert_wind": "verdant",
	"e_atef_crown": "verdant",
	"e_axe_of_vengeance": "sky",
	"e_greatest_of_fifty": "sky",
	"e_spear_of_horus": "sky",
	"e_valley_of_the_kings": "treasury",
	"e_book_of_thoth": "treasury",
	"e_tusks_of_apedemak": "treasury",
}

## Every icon's own painted backdrop (not one vignette per family): a sky
## gradient, a light source placed for that picture, and a pattern that says
## where the tech lives, so two buttons of one frame colour differ by their
## scene before their art (Retold paints a scene behind each icon):
## [top, bottom, light colour, light x, light y, light radius, pattern,
##  pattern colour, pattern strength, seed]. Patterns: embers (a forge's
## sparks over heat haze), streaks (brushed steel), waves (the sea), grid
## (an engineer's parchment), smoke, cracks (glowing seams), mist, horizon (a
## dusk skyline), dust (light shafts in a dusty field), stars (night, a
## nebula), rays (a sunburst), bokeh (lit leaves / coins out of focus),
## blocks (a stone wall), drips (venom), clouds (a storm). No backdrop is red:
## red means "can't afford".
const BACKDROPS := {
	"t_weapons": ["#1c0d06", "#5e2408", "#ff9a3a", 0.5, 1.08, 0.75, "embers", "#ffd27a", 1.0, 1],
	"t_armor": ["#30506a", "#0a1420", "#a8d0f4", 0.22, 0.12, 0.8, "streaks", "#b4d4f0", 0.55, 2],
	"t_shields": ["#0c4048", "#03161a", "#6ae0d4", 0.5, 0.22, 0.7, "waves", "#90f4ea", 0.6, 3],
	"t_ballistics": ["#26385e", "#080e1e", "#9ab8e8", 0.45, 0.4, 0.65, "grid", "#a8c8f4", 0.5, 4],
	"t_burning_pitch": ["#100a08", "#2e1408", "#ff7a20", 0.18, 1.02, 0.8, "smoke", "#7a6458", 0.8, 5],
	"t_phobos": ["#2a0c2c", "#080208", "#d0507a", 0.62, 0.3, 0.55, "mist", "#a04070", 0.7, 6],
	"t_deimos": ["#2c1650", "#08040e", "#a87cff", 0.5, 0.8, 0.7, "mist", "#c8a8ff", 0.7, 7],
	"t_enyo": ["#3a1048", "#0c0410", "#ff9a5a", 0.5, 0.68, 0.55, "horizon", "#ffc080", 1.0, 8],
	"t_sarissa": ["#56523c", "#16140c", "#f0dca0", 0.85, 0.05, 0.75, "dust", "#fff0c0", 0.7, 9],
	"t_aegis": ["#0c1e48", "#02050e", "#7a9ae8", 0.72, 0.2, 0.45, "stars", "#eef4ff", 1.0, 10],
	"t_sun_ray": ["#2a66b0", "#0a1e40", "#ffe08a", 0.5, 0.5, 0.55, "rays", "#ffeaa8", 0.8, 11],
	"t_shafts_of_plague": ["#22361a", "#050a02", "#8ae04a", 0.5, 0.25, 0.6, "drips", "#a8f060", 0.75, 12],
	"t_forge_of_olympus": ["#2c1404", "#6e3008", "#ffb040", 0.3, 1.05, 0.8, "embers", "#ffe090", 1.0, 13],
	"t_olympian_weapons": ["#1c1c46", "#06061a", "#b8c8ff", 0.62, 0.15, 0.55, "clouds", "#9098c8", 0.85, 14],
	"t_harvest_of_souls": ["#0a2e2a", "#020a0a", "#4ae0c0", 0.5, 0.85, 0.6, "mist", "#80f0d8", 0.75, 15],
	"t_omniscience": ["#1c3a70", "#040a1a", "#ffe8a0", 0.5, 0.5, 0.5, "rays", "#c8e0ff", 0.55, 16],
	"t_olympian_parentage": ["#3c1a5e", "#0c0418", "#ffd070", 0.5, 0.2, 0.6, "rays", "#ffd890", 0.5, 17],
	"t_labyrinth": ["#3e2c1a", "#120a04", "#d8a860", 0.5, 0.4, 0.7, "blocks", "#7a5c38", 0.8, 18],
	"t_sylvan_lore": ["#2c5e20", "#061404", "#d0f488", 0.72, 0.18, 0.7, "bokeh", "#dcff98", 0.7, 19],
	"t_will_of_kronos": ["#2c1054", "#06020e", "#c890ff", 0.5, 0.5, 0.55, "stars", "#f0e0ff", 0.9, 20],
	"t_hymn": ["#4e6e1c", "#0e1804", "#fff0a0", 0.28, 0.18, 0.7, "bokeh", "#fff4b0", 0.6, 21],
	"t_oracle": ["#1c2c50", "#04060e", "#a8c4ff", 0.5, 0.25, 0.6, "mist", "#c0d4ff", 0.8, 22],
	"t_temple_of_healing": ["#1c4e34", "#04100a", "#e4ffd4", 0.5, 0.15, 0.6, "rays", "#e8ffd8", 0.45, 23],
	"t_golden_apples": ["#205020", "#041004", "#ffe070", 0.5, 0.3, 0.6, "bokeh", "#ffe890", 0.7, 24],
	"t_dionysia": ["#4e1c4e", "#0e040e", "#ff98d8", 0.5, 0.3, 0.6, "bokeh", "#ffb0e8", 0.6, 25],
	"t_face_of_the_gorgon": ["#3e4e3c", "#0a0e0a", "#b4e494", 0.5, 0.4, 0.6, "cracks", "#121810", 0.7, 26],
	"t_monstrous_rage": ["#3c0e30", "#0a0208", "#ffa050", 0.5, 1.05, 0.7, "smoke", "#7a3460", 0.8, 27],
	"t_pious_sacrifice": ["#4e443a", "#12100c", "#ffc070", 0.5, 0.2, 0.6, "blocks", "#968470", 0.7, 28],
	"t_tax_collectors": ["#16463c", "#03100c", "#ffe48a", 0.5, 0.3, 0.6, "bokeh", "#ffe48a", 0.75, 29],
	"t_ambassadors": ["#1c3e4c", "#04100c", "#ffd890", 0.5, 0.66, 0.55, "horizon", "#ffe0a0", 0.9, 30],
	"t_coinage": ["#103e34", "#021008", "#ffe08a", 0.5, 0.4, 0.55, "rays", "#ffe8a0", 0.5, 31],
	"t_scroll": ["#1c3a6e", "#040a18", "#d4ecff", 0.5, 0.3, 0.6, "mist", "#c0d8ff", 0.6, 32],
	# the Egyptian techs (EgyptTechModels): sand, the Nile, lapis night, tomb stone
	"e_hands_of_the_pharaoh": ["#3a2c10", "#0c0804", "#ffe08a", 0.5, 0.35, 0.6, "rays", "#ffe6a0", 0.6, 40],
	"e_skin_of_the_rhino": ["#4a4234", "#12100c", "#f0d8a0", 0.3, 0.2, 0.7, "dust", "#e8d4a8", 0.6, 41],
	"e_flood_of_the_nile": ["#1e5a7a", "#04141e", "#c8f0ff", 0.6, 0.2, 0.65, "waves", "#a0e4ff", 0.7, 42],
	"e_clairvoyance": ["#14244e", "#03060e", "#90c0ff", 0.5, 0.45, 0.55, "stars", "#e0ecff", 0.9, 43],
	"e_criosphinx": ["#5a4626", "#16100a", "#ffd890", 0.7, 0.15, 0.7, "dust", "#ffe8b0", 0.7, 44],
	"e_hieracosphinx": ["#2c4a6e", "#0a1220", "#ffe0a0", 0.25, 0.15, 0.7, "clouds", "#b8c8e0", 0.6, 45],
	"e_sacred_cats": ["#3e3020", "#0e0a06", "#b8f070", 0.5, 0.3, 0.55, "bokeh", "#e8d080", 0.6, 46],
	"e_adze_of_wepwawet": ["#3e5a22", "#0c1406", "#f0e8a0", 0.7, 0.2, 0.7, "bokeh", "#d8f098", 0.55, 47],
	"e_scalloped_axe": ["#4a3a2a", "#100c08", "#ffc070", 0.3, 0.85, 0.7, "embers", "#ffd08a", 0.7, 48],
	"e_leather_frame_shield": ["#5a4a30", "#141008", "#ffe4b0", 0.75, 0.15, 0.75, "blocks", "#8a7450", 0.6, 49],
	"e_electrum_bullets": ["#2e3a46", "#080c10", "#fff2c0", 0.6, 0.3, 0.55, "streaks", "#d0d8e0", 0.5, 50],
	"e_shaduf": ["#5e7a8a", "#123040", "#fff0c0", 0.8, 0.12, 0.7, "horizon", "#ffe0a0", 0.8, 51],
	"e_feet_of_the_jackal": ["#3a2a46", "#0a060e", "#ffcc70", 0.7, 0.3, 0.55, "mist", "#c0a0d8", 0.7, 52],
	"e_serpent_spear": ["#203a1e", "#040a04", "#a8f070", 0.6, 0.2, 0.6, "drips", "#90e060", 0.6, 53],
	"e_necropolis": ["#463058", "#100818", "#ffb860", 0.5, 0.75, 0.6, "horizon", "#ffc880", 1.0, 54],
	"e_sun_dried_mud_brick": ["#6a4a2a", "#1a1008", "#ffd890", 0.25, 0.1, 0.75, "rays", "#ffe0a0", 0.45, 55],
	"e_crocodilopolis": ["#1e4a3a", "#04100c", "#ffd060", 0.4, 0.2, 0.6, "waves", "#80d0b0", 0.55, 56],
	"e_dark_water": ["#0c2a4a", "#02060e", "#60d0ff", 0.5, 0.6, 0.55, "waves", "#4090c0", 0.6, 57],
	"e_solar_barque": ["#a85a20", "#2a0e04", "#ffe090", 0.62, 0.35, 0.6, "horizon", "#ffd080", 0.9, 58],
	"e_bone_bow": ["#4e3a2a", "#100a06", "#ffd8a0", 0.75, 0.2, 0.65, "dust", "#f0d8b0", 0.6, 59],
	"e_slings_of_the_sun": ["#6a3a12", "#1a0a02", "#ffd060", 0.6, 0.3, 0.6, "rays", "#ffd890", 0.7, 60],
	"e_crimson_linen": ["#3c2a1e", "#0e0806", "#ffc8a0", 0.5, 0.2, 0.6, "bokeh", "#ffb890", 0.5, 61],
	"e_force_of_the_west_wind": ["#3a5a80", "#0a1626", "#e0f0ff", 0.2, 0.3, 0.7, "clouds", "#c0d4f0", 0.75, 62],
	"e_funeral_rites": ["#2a2a40", "#08080e", "#ffd890", 0.5, 0.2, 0.6, "blocks", "#5a5068", 0.6, 63],
	"e_spirit_of_maat": ["#1c3a5a", "#040a14", "#fff4d0", 0.5, 0.25, 0.6, "rays", "#e8f0ff", 0.5, 64],
	"e_nebty": ["#14305a", "#030814", "#ffd070", 0.5, 0.3, 0.6, "stars", "#ffe8b0", 0.8, 65],
	"e_funeral_barge": ["#1c1a36", "#04040c", "#a0c0ff", 0.25, 0.25, 0.55, "mist", "#8090c0", 0.75, 66],
	"e_new_kingdom": ["#3a4a2a", "#0c1006", "#ffe8a0", 0.5, 0.15, 0.65, "rays", "#fff0b0", 0.5, 67],
	"e_desert_wind": ["#8a5a2a", "#2a1406", "#ffd080", 0.75, 0.25, 0.6, "dust", "#ffe0a0", 0.8, 68],
	"e_atef_crown": ["#1e4a30", "#04100a", "#e8ffd0", 0.5, 0.2, 0.6, "mist", "#b0f0c0", 0.6, 69],
	"e_axe_of_vengeance": ["#2a1a2a", "#080408", "#ff9050", 0.5, 0.95, 0.7, "smoke", "#6a4060", 0.8, 70],
	"e_greatest_of_fifty": ["#4a5a6a", "#101418", "#ffe0a0", 0.8, 0.1, 0.7, "dust", "#e0e4e8", 0.55, 71],
	"e_spear_of_horus": ["#2a4a8a", "#060e22", "#ffe8a0", 0.6, 0.15, 0.6, "clouds", "#c0d0f0", 0.6, 72],
	"e_valley_of_the_kings": ["#4a3a1a", "#120c04", "#ffd070", 0.5, 0.3, 0.6, "blocks", "#7a6440", 0.6, 73],
	"e_book_of_thoth": ["#16362e", "#020a08", "#90ffd0", 0.5, 0.3, 0.55, "stars", "#c0fff0", 0.75, 74],
	"e_tusks_of_apedemak": ["#5a4a2e", "#14100a", "#ffe8c0", 0.7, 0.2, 0.65, "bokeh", "#f0e0b0", 0.55, 75],
	# the Egyptian minor gods' busts (EgyptGodModels, the age-up buttons): a
	# temple's light behind each head, in the colour of his domain
	"g_anubis": ["#3a2c4e", "#0a060e", "#ffcc70", 0.72, 0.22, 0.6, "mist", "#c0a0d8", 0.6, 80],
	"g_bast": ["#3e3020", "#0e0a06", "#c8f070", 0.7, 0.25, 0.6, "bokeh", "#e8d080", 0.55, 81],
	"g_ptah": ["#4a3e26", "#120e06", "#ffe0a0", 0.72, 0.2, 0.65, "blocks", "#7a6440", 0.5, 82],
	"g_hathor": ["#4a2a3a", "#10060c", "#ffc890", 0.7, 0.2, 0.6, "bokeh", "#ffd0b0", 0.5, 83],
	"g_nephthys": ["#1e2a4e", "#04060e", "#c0d0ff", 0.7, 0.2, 0.6, "stars", "#e0e8ff", 0.7, 84],
	"g_sekhmet": ["#6a3412", "#1a0802", "#ffc060", 0.7, 0.25, 0.6, "rays", "#ffd080", 0.6, 85],
	"g_sobek": ["#1e4a3a", "#04100c", "#ffd060", 0.72, 0.2, 0.6, "waves", "#80d0b0", 0.5, 86],
	"g_horus": ["#2a4a8a", "#060e22", "#ffe8a0", 0.72, 0.18, 0.6, "clouds", "#c0d0f0", 0.55, 87],
	"g_osiris": ["#1e3a2c", "#040e08", "#e8ffd0", 0.7, 0.2, 0.6, "mist", "#b0f0c0", 0.55, 88],
	"g_thoth": ["#16362e", "#020a08", "#c0ffe8", 0.72, 0.22, 0.55, "stars", "#c0fff0", 0.7, 89],
}

## Per icon framing: [fit, dx, dy] (fit: the share of the tile the picture's
## longer side fills, above 1 the picture is cropped by the frame as Retold's
## close-ups are; dx / dy: an offset, a share of the tile), so pictures are not
## all one weight and size.
const FRAMING := {
	"t_weapons": [0.98, 0.0, 0.0], "t_armor": [0.86, 0.0, 0.03], "t_shields": [0.88, 0.0, 0.0],
	"t_ballistics": [0.94, 0.0, 0.0], "t_burning_pitch": [0.96, 0.0, 0.04],
	"t_phobos": [1.04, 0.0, 0.0], "t_deimos": [0.92, 0.0, 0.04], "t_enyo": [0.96, 0.0, 0.0],
	"t_sarissa": [1.02, 0.0, 0.0], "t_aegis": [1.0, 0.0, 0.05], "t_sun_ray": [1.06, 0.0, 0.0],
	"t_monstrous_rage": [0.96, 0.0, 0.03], "t_omniscience": [1.0, 0.0, 0.0],
	# a god's bust: a close-up portrait, the shoulders cropped by the frame's foot
	"g_anubis": [1.1, 0.0, 0.1], "g_bast": [1.15, 0.0, 0.1], "g_ptah": [1.12, 0.0, 0.08],
	"g_hathor": [1.1, 0.0, 0.1], "g_nephthys": [1.1, 0.0, 0.1], "g_sekhmet": [1.12, 0.0, 0.1],
	"g_sobek": [1.1, 0.0, 0.1], "g_horus": [1.1, 0.0, 0.1], "g_osiris": [1.06, 0.0, 0.08], "g_thoth": [1.1, 0.0, 0.1],
}

## The Egyptian minor gods with a bust ("g_<god>": egypt_god_models.gd).
const GOD_BUSTS := ["anubis", "bast", "ptah", "hathor", "nephthys", "sekhmet", "sobek", "horus", "osiris", "thoth"]

## The backdrop / framing key of an icon name (an Armory tier: its line).
static func _line_key(name: String) -> String:
	var parts := name.split("_")
	if parts.size() == 3 and TIERS.has(parts[2]):
		return "t_" + parts[1]
	return name

static var _backdrops := {}

static func _hash2(x: int, y: int, s: int) -> float:
	var h := (x * 374761393 + y * 668265263 + s * 2246822519) & 0x7fffffff
	h = ((h ^ (h >> 13)) * 1274126177) & 0x7fffffff
	return float(h ^ (h >> 16)) / float(0x7fffffff)

## Smooth value noise in 0..1 (cell size 1).
static func _vnoise(x: float, y: float, s: int) -> float:
	var xi := int(floor(x))
	var yi := int(floor(y))
	var fx := x - xi
	var fy := y - yi
	fx = fx * fx * (3.0 - 2.0 * fx)
	fy = fy * fy * (3.0 - 2.0 * fy)
	var a := _hash2(xi, yi, s)
	var b := _hash2(xi + 1, yi, s)
	var c := _hash2(xi, yi + 1, s)
	var d := _hash2(xi + 1, yi + 1, s)
	return lerpf(lerpf(a, b, fx), lerpf(c, d, fx), fy)

static func _fbm(x: float, y: float, s: int, oct := 4) -> float:
	var v := 0.0
	var amp := 0.5
	var f := 1.0
	var tot := 0.0
	for o in oct:
		v += amp * _vnoise(x * f, y * f, s + o * 17)
		tot += amp
		amp *= 0.5
		f *= 2.03
	return v / tot

## An icon's painted backdrop at n x n (RGB floats), cached.
static func backdrop(name: String, n: int) -> PackedFloat32Array:
	var lk := _line_key(name)
	var key := "%s@%d" % [lk, n]
	if _backdrops.has(key):
		return _backdrops[key]
	var bd: Array = BACKDROPS.get(lk, BACKDROPS["t_scroll"])
	var ct := Color(str(bd[0]))
	var cbm := Color(str(bd[1]))
	var cl := Color(str(bd[2]))
	var lx: float = bd[3]
	var ly: float = bd[4]
	var lr: float = bd[5]
	var pat: String = bd[6]
	var cp := Color(str(bd[7]))
	var ps: float = bd[8]
	var sd: int = bd[9]
	var out := PackedFloat32Array()
	out.resize(n * n * 3)
	var inv := 1.0 / float(n)
	for y in n:
		for x in n:
			var fx := (x + 0.5) * inv
			var fy := (y + 0.5) * inv
			var col := ct.lerp(cbm, fy)
			# the light: a soft pool round (lx, ly)
			var dl := Vector2(fx - lx, fy - ly).length() / lr
			var li := clampf(1.0 - dl, 0.0, 1.0)
			li = li * li
			col = col.lerp(cl, li * 0.55)
			var m := 0.0       # pattern mask 0..1 (blends toward cp)
			var add := 0.0     # pattern light (added, in cp)
			match pat:
				"embers":
					var heat := _fbm(fx * 3.0, fy * 2.0 - 0.3, sd)
					col = col.lerp(cl, clampf((fy - 0.45) * 1.2, 0.0, 1.0) * heat * 0.6)
					# sparks: a few bright points on a jittered grid, rising
					var gx := int(fx * 9.0)
					var gy := int(fy * 9.0)
					var hx := _hash2(gx, gy, sd)
					var hy := _hash2(gx, gy, sd + 5)
					var on := _hash2(gx, gy, sd + 9) > 0.7
					if on:
						# a short rising streak
						var dd := Vector2(fx * 9.0 - gx - (0.2 + 0.6 * hx), fy * 9.0 - gy - (0.2 + 0.6 * hy)).length()
						add = clampf(1.0 - dd * (3.0 + 4.0 * _hash2(gx, gy, sd + 13)), 0.0, 1.0) * (0.35 + 0.9 * fy)
				"streaks":
					var st := _fbm(fx * 1.5, fy * 26.0, sd, 3)
					m = clampf((st - 0.45) * 2.2, 0.0, 1.0) * 0.35
					# a window's light falling across the rack
					add = clampf(1.0 - absf((fx + fy * 0.6) - 0.55) * 6.0, 0.0, 1.0) * 0.18
				"waves":
					var w := sin((fy * 14.0 + sin(fx * 7.0 + fy * 3.0) * 0.9 + _fbm(fx * 4.0, fy * 4.0, sd) * 2.5))
					add = clampf((w - 0.6) * 2.5, 0.0, 1.0) * (0.25 + 0.5 * (1.0 - fy))
				"grid":
					var stain := _fbm(fx * 4.0, fy * 4.0, sd)
					col = col.lerp(cbm, clampf((stain - 0.5) * 1.6, 0.0, 1.0) * 0.6)
					var gxl := absf(fposmod(fx * 6.0, 1.0) - 0.5)
					var gyl := absf(fposmod(fy * 6.0, 1.0) - 0.5)
					m = (clampf((gxl - 0.44) * 18.0, 0.0, 1.0) + clampf((gyl - 0.44) * 18.0, 0.0, 1.0)) * 0.45
					# a drafting arc
					var ra := Vector2(fx - 0.05, fy - 1.0).length()
					m = maxf(m, clampf(1.0 - absf(ra - 0.78) * 60.0, 0.0, 1.0) * 0.7)
				"smoke":
					var sm := _fbm(fx * 2.4 + _fbm(fx * 2.0, fy * 2.0, sd + 3) * 1.4, fy * 2.0 - fx * 0.5, sd)
					m = clampf((sm - 0.42) * 2.0, 0.0, 1.0) * 0.6
				"cracks":
					var q := _fbm(fx * 3.2, fy * 3.2, sd, 3)
					var ln := clampf(1.0 - absf(q - 0.5) * 22.0, 0.0, 1.0)
					var q2 := _fbm(fx * 5.0 + 7.0, fy * 5.0, sd + 1, 3)
					ln = maxf(ln, clampf(1.0 - absf(q2 - 0.5) * 26.0, 0.0, 1.0) * 0.7)
					if cp.get_luminance() > 0.3:
						add = ln * 0.75
					else:
						m = ln * 0.8
				"mist":
					var mi := _fbm(fx * 2.2, fy * 3.0 + _fbm(fx * 3.0, fy, sd + 2) * 0.8, sd)
					m = clampf((mi - 0.38) * 1.8, 0.0, 1.0) * 0.45 * (0.4 + fy)
				"horizon":
					var hb := clampf(1.0 - absf(fy - ly) * 9.0, 0.0, 1.0)
					add = hb * hb * 0.8
					# the land below the skyline: dark hills
					var hill := ly + 0.04 + 0.05 * sin(fx * 9.0 + sd) + 0.03 * sin(fx * 23.0)
					if fy > hill:
						col = col.lerp(Color(0.02, 0.01, 0.02), 0.8)
						add = 0.0
				"dust":
					var du := _fbm(fx * 3.0, fy * 3.0, sd)
					m = clampf((du - 0.4) * 1.6, 0.0, 1.0) * 0.3
					var shaft := sin((fx * 0.8 - fy) * 22.0)
					add = clampf(shaft - 0.6, 0.0, 1.0) * 0.35 * clampf(1.0 - fy, 0.0, 1.0)
				"stars":
					var neb := _fbm(fx * 2.5, fy * 2.5, sd + 4)
					col = col.lerp(cl, clampf((neb - 0.5) * 1.5, 0.0, 1.0) * 0.35)
					var sx := int(fx * 14.0)
					var sy := int(fy * 14.0)
					if _hash2(sx, sy, sd) > 0.72:
						var px := fx * 14.0 - sx - (0.2 + 0.6 * _hash2(sx, sy, sd + 1))
						var py := fy * 14.0 - sy - (0.2 + 0.6 * _hash2(sx, sy, sd + 2))
						add = clampf(1.0 - Vector2(px, py).length() * 3.2, 0.0, 1.0) * (0.5 + 0.5 * _hash2(sx, sy, sd + 3))
				"rays":
					var an := atan2(fy - ly, fx - lx)
					var rw := 0.5 + 0.5 * sin(an * 12.0 + sd)
					add = clampf((rw - 0.55) * 2.6, 0.0, 1.0) * clampf(1.0 - dl * 0.7, 0.0, 1.0) * 0.55
				"bokeh":
					for layer in 2:
						var cs := 4.0 + layer * 3.0
						var bx := int(fx * cs)
						var by := int(fy * cs)
						if _hash2(bx, by, sd + layer * 31) > 0.45:
							var cx := 0.25 + 0.5 * _hash2(bx, by, sd + layer * 31 + 1)
							var cy := 0.25 + 0.5 * _hash2(bx, by, sd + layer * 31 + 2)
							var rr := 0.22 + 0.2 * _hash2(bx, by, sd + layer * 31 + 3)
							var dd := Vector2(fx * cs - bx - cx, fy * cs - by - cy).length()
							add = maxf(add, clampf((rr - dd) * 14.0, 0.0, 1.0) * (0.35 - layer * 0.12) * (0.5 + li))
				"blocks":
					var row := int(fy * 5.0)
					var bxx := fx * 3.0 + (0.5 if row % 2 == 1 else 0.0)
					var mx := absf(fposmod(bxx, 1.0) - 0.5)
					var my := absf(fposmod(fy * 5.0, 1.0) - 0.5)
					var shade := _hash2(int(floor(bxx)), row, sd) * 0.25 + _fbm(fx * 6.0, fy * 6.0, sd) * 0.3
					col = col.lerp(cp, shade)
					m = 0.0
					if mx > 0.46 or my > 0.43:
						col = col.darkened(0.55)
				"drips":
					var dr := _fbm(fx * 9.0, fy * 0.9, sd, 3)
					add = clampf((dr - 0.55) * 3.0, 0.0, 1.0) * 0.4 * clampf(1.0 - fy * 0.8, 0.0, 1.0)
				"clouds":
					var cc := _fbm(fx * 2.0 + _fbm(fx * 2.0, fy * 2.0, sd + 5) * 1.2, fy * 2.6, sd)
					m = clampf((cc - 0.4) * 2.2, 0.0, 1.0) * 0.65
					# the bright edge of the clouds toward the light
					add = clampf((cc - 0.55) * 4.0, 0.0, 1.0) * li * 0.6
			col = col.lerp(cp, m * ps)
			col = Color(col.r + cp.r * add * ps, col.g + cp.g * add * ps, col.b + cp.b * add * ps)
			# a soft corner falloff (framing, not the same heavy vignette everywhere)
			var e := maxf(absf(fx - 0.5), absf(fy - 0.5)) * 2.0
			var vig := 1.0 - 0.3 * clampf((e - 0.7) / 0.3, 0.0, 1.0)
			var i := (y * n + x) * 3
			out[i] = col.r * vig
			out[i + 1] = col.g * vig
			out[i + 2] = col.b * vig
	_backdrops[key] = out
	return out

static var _tiles := {}
## the share of the tile a glyph's drawn bounds fill (its longer side)
const FIT := 0.9

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

## The baked tile of an icon at px x px; variant "normal", "locked" or
## "busy" (researching / queued: the normal tile turned into a cold blue
## duotone, see busy_image; hud reveals the normal tile over it as it fills).
static func tile(name: String, px: int, variant := "normal") -> Texture2D:
	var key := "%s@%d:%s" % [name, px, variant]
	if _tiles.has(key):
		return _tiles[key]
	var img := _bake_variant(name, px, variant)
	var tex: Texture2D = ImageTexture.create_from_image(img) if img else null
	_tiles[key] = tex
	return tex

static func _bake_variant(name: String, px: int, variant: String) -> Image:
	var img := bake(name, px, variant == "locked")
	if img and variant == "busy":
		busy_image(img)
	return img

## The "busy" look (a tech being researched or queued, a unit training), in
## place on an RGBA8 image: its colour gone into a cold blue duotone (deep navy
## shadows to ice-blue lights, 8% of the hue kept) and its value lowered to
## ~70%, so at a glance the picture is "in progress", neither buyable (full
## colour) nor locked (slate grey, darker, a badge). Alpha kept.
static func busy_image(img: Image) -> void:
	if img.is_compressed():
		img.decompress()
	img.convert(Image.FORMAT_RGBA8)
	var d := img.get_data()
	var lo := Color("#06142c")
	var hi := Color("#b4dcff")
	for i in range(0, d.size(), 4):
		if d[i + 3] == 0:
			continue
		var r := d[i] / 255.0
		var g := d[i + 1] / 255.0
		var b := d[i + 2] / 255.0
		var l := clampf((r * 0.3 + g * 0.55 + b * 0.15) * 0.86 + 0.04, 0.0, 1.0)
		var t := l * l * (3.0 - 2.0 * l) * 0.35 + l * 0.65
		var c := lo.lerp(hi, t)
		d[i] = int(clampf(lerpf(c.r, r, 0.08), 0.0, 1.0) * 255.0)
		d[i + 1] = int(clampf(lerpf(c.g, g, 0.08), 0.0, 1.0) * 255.0)
		d[i + 2] = int(clampf(lerpf(c.b, b, 0.08), 0.0, 1.0) * 255.0)
	img.set_data(img.get_width(), img.get_height(), false, Image.FORMAT_RGBA8, d)

static var _warm: Array = []
static var _warm_init := false

## Bake one more tile of the warm-up list (every tech icon at the command
## grid's 48 px, normal and locked, the queue's 34 px and the card's 22 px), so selecting a
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
		for k in EGYPT_GOD:
			names.append("e_" + str(k))
		for g in GOD_BUSTS:
			names.append("g_" + str(g))
		# the sizes they are drawn at, 1:1 (a rescaled tile goes soft):
		# the command grid's 48 px, the queue's 34 px, the card's 22 px
		for nm in names:
			_warm.append([nm, 48, "normal"])
		for nm in names:
			_warm.append([nm, 48, "locked"])
		for nm in names:
			_warm.append([nm, 48, "busy"])
		for nm in names:
			_warm.append([nm, 34, "normal"])
		for nm in names:
			_warm.append([nm, 22, "normal"])
	if _warm.is_empty():
		return false
	var w: Array = _warm.pop_front()
	tile(str(w[0]), int(w[1]), str(w[2]))
	return true

# ---- the 3D studio -------------------------------------------------------------------
# Icons with a model (tech_models.gd) are rendered, not drawn: every model in
# one shared world (spaced apart, one SubViewport + camera each), lit by a
# softbox panorama (the metal's reflections and the ambient light), a key
# light from the top left with soft shadows, a cool fill from the right, a
# rim light behind each model in its tile family's glow, SSAO, filmic tone
# mapping; the next drawn frame renders them all, the pictures are read back
# (premultiplied, 256 px, 4x MSAA) and kept for bake(), which fits each to
# the tile and composites it on the family plate. No renderer (headless):
# nothing is rendered and the SVG glyphs stay.

const TechModels := preload("res://game/ui/tech_models.gd")
const STUDIO_PX := 256
static var _glyph3d := {}   # icon name -> Image (RGBA8, premultiplied alpha)
static var _studio_done := false

## Every icon name with a tile (the Armory's tiers and every SVG with a plate).
static func tile_names() -> Array:
	var names := []
	for t in TIERS:
		for l in TEMPLATES:
			names.append("t_%s_%s" % [l, t])
	for k in SVG:
		if PLATE_OF.has(k):
			names.append(k)
	for k in EGYPT_GOD:
		names.append("e_" + str(k))
	for g in GOD_BUSTS:
		names.append("g_" + str(g))
	return names

## True when an icon's picture comes from its 3D model.
static func rendered(name: String) -> bool:
	return _glyph3d.has(name)

## Set up the studio: every model in its viewport; they draw with the next
## frame and studio_finish() (after it) reads them back (a forced draw does
## not render freshly added viewports, so this takes two real frames).
static func render_models(host: Node, names: Array = []) -> int:
	if _studio_done:
		return _glyph3d.size()
	_studio_done = true
	if DisplayServer.get_name() == "headless":
		return 0
	if names.is_empty():
		names = tile_names()
	var world := World3D.new()
	world.environment = _studio_env()
	var holder := Node.new()
	holder.name = "TechIconStudio"
	host.add_child(holder)
	var vps := []
	var i := 0
	for nm in names:
		var obj: Node3D = TechModels.build(str(nm))
		if obj == null:
			continue
		var vp := SubViewport.new()
		vp.size = Vector2i(STUDIO_PX, STUDIO_PX)
		vp.world_3d = world
		vp.transparent_bg = true
		vp.msaa_3d = Viewport.MSAA_4X
		vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
		vp.positional_shadow_atlas_size = 0
		holder.add_child(vp)
		var at := Vector3(i * 40.0, 0.0, 0.0)
		var pivot := Node3D.new()
		pivot.position = at
		vp.add_child(pivot)
		pivot.add_child(obj)
		# the rim light comes from the icon's own backdrop light (its colour and
		# side: a forge's glow from below, the moon over the owl), so the model
		# sits lit inside its scene rather than pasted on a plate
		var bd: Array = BACKDROPS.get(_line_key(str(nm)), BACKDROPS["t_scroll"])
		var rim := OmniLight3D.new()
		rim.light_color = Color(str(bd[2])).lerp(Color.WHITE, 0.2)
		rim.light_energy = 8.0
		rim.omni_range = 7.0
		rim.omni_attenuation = 0.6
		var side := Vector2(float(bd[3]) - 0.5, 0.5 - float(bd[4]))
		if side.length() < 0.15:
			side = Vector2(0.35, 0.25)
		side = side.normalized() * 2.7
		rim.position = at + Vector3(side.x, side.y, -2.4)
		vp.add_child(rim)
		var cam := Camera3D.new()
		cam.fov = 17.0
		cam.near = 1.0
		cam.far = 30.0
		vp.add_child(cam)
		cam.position = at + Vector3(0.0, 0.5, 9.0)
		cam.look_at(at, Vector3.UP)
		cam.current = true
		if i == 0:
			var key := DirectionalLight3D.new()
			key.light_energy = 2.3
			key.light_specular = 1.4
			key.light_color = Color(1.0, 0.95, 0.86)
			key.shadow_enabled = true
			key.shadow_blur = 1.5
			key.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
			key.directional_shadow_max_distance = 14.0
			vp.add_child(key)
			key.look_at_from_position(Vector3.ZERO, Vector3(0.55, -0.62, -0.55), Vector3.UP)
			var fill := DirectionalLight3D.new()
			fill.light_energy = 0.22
			fill.light_color = Color(0.75, 0.85, 1.0)
			vp.add_child(fill)
			fill.look_at_from_position(Vector3.ZERO, Vector3(-0.8, 0.1, -0.5), Vector3.UP)
		vps.append([str(nm), vp])
		i += 1
	if vps.is_empty():
		holder.queue_free()
		return 0
	_studio_vps = vps
	_studio_holder = holder
	return 0

static var _studio_vps := []
static var _studio_holder: Node = null
static var _studio_frame := -1

## Start the studio without waiting (the game: from ui.setup, so the pictures
## are back by the second drawn frame); studio_poll() each frame finishes it.
static func studio_start(host: Node) -> void:
	if _studio_done:
		return
	render_models(host)
	_studio_frame = Engine.get_frames_drawn()

## Finish the studio once it has drawn (two frames after studio_start); true while pending.
static func studio_poll() -> bool:
	if _studio_holder == null:
		return false
	if Engine.get_frames_drawn() - _studio_frame < 2:
		return true
	studio_finish()
	return false

## Read the studio's pictures back (after it has drawn) and free it.
static func studio_finish() -> int:
	var vps := _studio_vps
	var holder := _studio_holder
	_studio_vps = []
	_studio_holder = null
	if holder == null:
		return _glyph3d.size()
	for e in vps:
		var img: Image = (e[1] as SubViewport).get_texture().get_image()
		if img == null or img.is_empty():
			continue
		img.convert(Image.FORMAT_RGBA8)
		if img.get_used_rect().size.x < 4:
			continue
		_glyph3d[e[0]] = img
	holder.queue_free()
	# tiles baked from the SVGs before now are re-baked in place
	for key in _tiles:
		var tex: ImageTexture = _tiles[key]
		var nm := str(key).get_slice("@", 0)
		if tex and _glyph3d.has(nm):
			var px := int(str(key).get_slice("@", 1).get_slice(":", 0))
			var img2 := _bake_variant(nm, px, str(key).get_slice(":", 1))
			if img2:
				tex.update(img2)
	return _glyph3d.size()

## The studio: a softbox panorama for reflections and ambient light.
static func _studio_env() -> Environment:
	var e := Environment.new()
	e.background_mode = Environment.BG_CLEAR_COLOR
	var sky := Sky.new()
	var pm := PanoramaSkyMaterial.new()
	pm.panorama = ImageTexture.create_from_image(_studio_panorama())
	sky.sky_material = pm
	sky.process_mode = Sky.PROCESS_MODE_QUALITY
	sky.radiance_size = Sky.RADIANCE_SIZE_256
	e.sky = sky
	e.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	e.ambient_light_energy = 0.38
	e.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	# ACES: a stronger toe and shoulder than filmic (deep shadows, punchy
	# highlights: the contrast that keeps a small picture from reading flat)
	e.tonemap_mode = Environment.TONE_MAPPER_ACES
	e.tonemap_exposure = 1.15
	e.tonemap_white = 6.0
	e.ssao_enabled = true
	e.ssao_radius = 0.3
	e.ssao_intensity = 2.4
	e.ssao_power = 1.8
	e.glow_enabled = false
	return e

## An equirectangular HDR studio: a big warm softbox up left in front, a long
## strip light behind on the right, a soft top light, a dark warm floor.
static func _studio_panorama() -> Image:
	var w := 512
	var h := 256
	var img := Image.create(w, h, false, Image.FORMAT_RGBF)
	var K := Vector3(-0.55, 0.62, 0.56).normalized()
	var Rs := Vector3(0.75, 0.25, -0.62).normalized()
	var T := Vector3(0.1, 1.0, 0.1).normalized()
	var F := Vector3(0.25, 0.35, 1.0).normalized()
	for y in h:
		var th := (y + 0.5) / h * PI
		for x in w:
			var ph := ((x + 0.5) / w - 0.5) * TAU
			var d := Vector3(sin(th) * sin(ph), cos(th), -sin(th) * cos(ph))
			# above the horizon a cool sky brightening down to a sharp horizon
			# line, below it a dark warm floor: the chrome look that makes a
			# curved metal part read as metal (light top, dark bottom, a crisp edge)
			var c := Color(0.16, 0.18, 0.22).lerp(Color(0.5, 0.52, 0.56), clampf(1.0 - d.y * 3.0, 0.0, 1.0))
			if d.y < 0.0:
				c = Color(0.05, 0.035, 0.025).lerp(Color(0.012, 0.01, 0.008), clampf(-d.y * 3.0, 0.0, 1.0))
			var k := clampf((d.dot(K) - 0.82) / 0.1, 0.0, 1.0)
			c += Color(1.0, 0.92, 0.8) * 7.0 * k * k
			var r := clampf((d.dot(Rs) - 0.9) / 0.06, 0.0, 1.0)
			c += Color(0.8, 0.9, 1.0) * 4.0 * r
			# a soft frontal box behind the camera (flat faces turned to the
			# viewer reflect it instead of the dark studio)
			var f := clampf((d.dot(F) - 0.75) / 0.2, 0.0, 1.0)
			c += Color(1.0, 0.97, 0.92) * 0.9 * f
			var t := clampf((d.dot(T) - 0.7) / 0.3, 0.0, 1.0)
			c += Color(0.9, 0.95, 1.0) * 1.2 * t
			img.set_pixel(x, y, c)
	return img

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

## Unsharp mask on a premultiplied RGBA8 image (RGB only, clamped to alpha):
## restores the edge and highlight crispness the downscale from 256 px loses.
static func _sharpen(img: Image, amt: float) -> void:
	var w := img.get_width()
	var h := img.get_height()
	if w < 3 or h < 3:
		return
	var d := img.get_data()
	var o := d.duplicate()
	for y in range(1, h - 1):
		for x in range(1, w - 1):
			var i := (y * w + x) * 4
			var a := d[i + 3]
			if a == 0:
				continue
			for c in 3:
				var j := i + c
				var bl := (d[j - 4] + d[j + 4] + d[j - w * 4] + d[j + w * 4]) * 0.25
				o[j] = clampi(int(d[j] + amt * (d[j] - bl)), 0, a)
	img.set_data(w, h, false, Image.FORMAT_RGBA8, o)

## Local contrast ("clarity") on the rendered picture, on the tile grid: each
## channel pushed away from its own blur (radius r), so the form shading of a
## 40 px picture (a rim, a fold, an engraved face) is not lost to the
## downscale; a mild saturation lift with it. Premultiplied: clamped to alpha.
static func _clarity(R: PackedFloat32Array, A: PackedFloat32Array, n: int, r: int, amt: float) -> void:
	var N := n * n
	var ch := []
	for c in 3:
		var a := PackedFloat32Array()
		a.resize(N)
		for i in N:
			a[i] = R[i * 3 + c]
		ch.append(_blur(a, n, r))
	var AB := _blur(A, n, r)
	for i in N:
		var al := A[i]
		if al <= 0.0:
			continue
		# compare against the blur of the picture only (not of the empty
		# plate around it), so edges do not get a bright halo
		var k := 1.0 / maxf(AB[i], 0.05)
		var lum := 0.0
		var v := [0.0, 0.0, 0.0]
		for c in 3:
			var x: float = R[i * 3 + c]
			var bl: float = ch[c][i] * k * al
			v[c] = x + amt * (x - bl)
			lum += v[c] * [0.3, 0.55, 0.15][c]
		for c in 3:
			R[i * 3 + c] = clampf(lum + (v[c] - lum) * 1.12, 0.0, al)

## Bake a tile (see above). Pure Image work: safe on a worker thread.
static func bake(name: String, n: int, locked := false) -> Image:
	var src := svg(name)
	var g3: Image = _glyph3d.get(name)
	if src.is_empty() and g3 == null:
		return null
	# the halo behind the picture in its backdrop's light colour
	var gl := Color(str((BACKDROPS.get(_line_key(name), BACKDROPS["t_scroll"]) as Array)[2]))
	var fr: Array = FRAMING.get(_line_key(name), [FIT, 0.0, 0.0])
	var fit_k: float = fr[0]
	var BD := backdrop(name, n)
	var nparts := name.split("_")
	var tint := 0.2 if nparts.size() == 3 and TIERS.has(nparts[2]) else 0.0
	var g: Image
	if g3 != null:
		# the rendered model: its drawn bounds fitted to FIT of the tile
		# (downscaled from 256 px: smooth edges, crisp highlights)
		var ur3 := g3.get_used_rect()
		var sc := minf(fit_k * n / ur3.size.x, fit_k * n / ur3.size.y)
		g = g3.get_region(ur3)
		g.resize(maxi(1, int(round(ur3.size.x * sc))), maxi(1, int(round(ur3.size.y * sc))), Image.INTERPOLATE_LANCZOS)
		_sharpen(g, 0.4 if n <= 64 else 0.3)
	else:
		# fit the glyph's drawn bounds (not its 24-unit box) to FIT of the tile, so
		# a thin diagonal glyph fills the button as a round one does
		g = Image.new()
		var s0 := float(n) / 24.0
		if g.load_svg_from_string(src, s0) != OK:
			return null
		var ur0 := g.get_used_rect()
		if ur0.size.x <= 0 or ur0.size.y <= 0:
			return null
		var fit := fit_k * n
		var s1 := s0 * minf(minf(fit / ur0.size.x, fit / ur0.size.y), 1.6)
		if g.load_svg_from_string(src, s1) != OK:
			return null
	g.convert(Image.FORMAT_RGBA8)
	var ur := g.get_used_rect()
	var ox := (n - ur.size.x) / 2 - ur.position.x + int(round(float(fr[1]) * n))
	var oy := (n - ur.size.y) / 2 - ur.position.y + int(round(float(fr[2]) * n))
	var gd := g.get_data()
	var gw := g.get_width()
	var gh := g.get_height()
	var prem := g3 != null
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
	if prem:
		_clarity(R, A, n, maxi(1, int(round(2.0 * u))), 0.5)
	var H := _blur(A, n, maxi(1, int(round(1.6 * u))))
	var SH := _blur(A, n, maxi(1, int(round(2.4 * u))))
	var GL := _blur(A, n, maxi(2, int(round(6.0 * u))))
	# a dark sticker outline around the silhouette (dilated alpha), so the
	# shape reads against any plate, greyed or not
	var OL := _blur(A, n, maxi(1, int(round(1.0 * u))))
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
			# the icon's own painted backdrop (backdrop())
			var fy := (y + 0.5) * inv
			var pr := BD[i * 3]
			var pg := BD[i * 3 + 1]
			var pb := BD[i * 3 + 2]
			# a faint glow of the family behind the picture (separation, not an airbrush)
			var gv := GL[i]
			pr += gl.r * gv * 0.12
			pg += gl.g * gv * 0.12
			pb += gl.b * gv * 0.12
			var sx := x - sdx
			var sy := y - sdy
			if sx >= 0 and sy >= 0:
				var sh := SH[sy * n + sx] * 0.78
				pr *= 1.0 - sh
				pg *= 1.0 - sh
				pb *= 1.0 - sh
			var ol := clampf(OL[i] * 3.2, 0.0, 1.0) * 0.92
			pr = lerpf(pr, 0.035, ol)
			pg = lerpf(pg, 0.025, ol)
			pb = lerpf(pb, 0.03, ol)
			var a := A[i]
			var r := pr
			var gg := pg
			var b := pb
			if a > 0.0 and prem:
				# a rendered model: already lit; premultiplied over the plate
				r = pr * (1.0 - a) + R[i * 3]
				gg = pg * (1.0 - a) + R[i * 3 + 1]
				b = pb * (1.0 - a) + R[i * 3 + 2]
			elif a > 0.0:
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
			var sheen := clampf(1.0 - fy / 0.3, 0.0, 1.0) * 0.025
			r += sheen
			gg += sheen
			b += sheen
			if locked:
				# value split: the plate drops to a dark slate, the glyph keeps
				# a lifted grey, so a locked tile is colourless but its picture
				# still reads (outline dark, glyph light, plate in between)
				var l := r * 0.3 + gg * 0.55 + b * 0.15
				var plum := pr * 0.3 + pg * 0.55 + pb * 0.15
				# the picture keeps its full light-and-shade range (an S-curve
				# round mid grey, lifted), so the greyed shape still reads
				# as a pot / a shield / a sword, not a grey lump
				var lc := clampf((l - 0.4) * 1.3 + 0.5, 0.0, 1.0)
				lc = lc * lc * (3.0 - 2.0 * lc) * 0.6 + lc * 0.4
				var gl2 := lc * 0.64 + 0.07
				var pv := plum * 0.42 + 0.01
				var v := lerpf(pv, gl2, a)
				var lr := v * 0.94
				var lg := v * 0.97
				var lb := v * 1.06
				if a > 0.0:
					# a trace of the picture's own hue (14%), so a flame still
					# reads warmer and brighter than the clay pot it rises from
					var cw := 0.14 * a
					lr += (r - l) * cw
					lg += (gg - l) * cw
					lb += (b - l) * cw
				if tint > 0.0 and a > 0.0:
					# a tier's metal keeps a trace of its hue on the glyph only
					# (copper rust, bronze ochre, iron slate), so the three tiers
					# still read apart once locked; the plate stays grey
					var w := tint * a
					lr = lerpf(lr, r * 0.75, w)
					lg = lerpf(lg, gg * 0.75, w)
					lb = lerpf(lb, b * 0.75, w)
				r = lr
				gg = lg
				b = lb
			out[i * 4] = int(clampf(r, 0.0, 1.0) * 255.0)
			out[i * 4 + 1] = int(clampf(gg, 0.0, 1.0) * 255.0)
			out[i * 4 + 2] = int(clampf(b, 0.0, 1.0) * 255.0)
			out[i * 4 + 3] = 255
	return Image.create_from_data(n, n, false, Image.FORMAT_RGBA8, out)

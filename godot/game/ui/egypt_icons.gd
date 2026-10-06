extends RefCounted
## The Egyptians' icons (ui piece, Godot-only; no icons.js counterpart), in the
## look of the game's SVG icons (icons.gd: flat shapes, a dark outline, a
## highlight; tech_icons.gd's gradients):
##
##   - god emblems "ra" / "isis" / "set" (100-unit viewBox, currentColor, the
##     double ring of the Zeus emblem): the setup's pantheon discs and cards,
##     the HUD's age medallion tooltip. Ra a falcon head under the sun disc and
##     its cobra, Isis her throne glyph over spread wings, Set the Set animal's
##     head (curved snout, tall square-topped ears).
##   - minor god emblems "mg_<god>" (100-unit viewBox, currentColor, no ring:
##     the disc draws it) as hieroglyphs: Bast a seated cat, Ptah the djed
##     pillar, Anubis the jackal on his shrine, Sobek a crocodile head under
##     the sun disc and plumes, Sekhmet a lioness under the sun disc, Nephthys
##     her house-and-basket glyph, Osiris the atef crown, Horus the wedjat eye,
##     Thoth an ibis head under the moon.
##   - god power icons (24-unit viewBox, full colour, as "storm" / "bolt" /
##     "meteor"): rain, prosperity, vision, eclipse, shifting_sands,
##     plague_of_serpents, locust_swarm, citadel, ancestors, son_of_osiris,
##     tornado (Thoth's meteor uses "meteor").
##   - command icons: "empower" (the Pharaoh's / Ra Priests' beam on an ankh),
##     "monument" (the favor of the Monuments), "summon" (Set's call).
##
## hud_style.icon() reads SVG / viewbox() after icons.gd and tech_icons.gd.

## colours of each god's disc / card art: radial stops (centre -> rim)
const GOD_STOPS := {
	"ra": [[0.0, Color("#fff4c0")], [0.42, Color("#e8962a")], [1.0, Color("#4a1a06")]],
	"isis": [[0.0, Color("#dcf8ff")], [0.42, Color("#3aa2bc")], [1.0, Color("#0a2a44")]],
	"set": [[0.0, Color("#ffd8a8")], [0.42, Color("#b4442a")], [1.0, Color("#260806")]],
	"minor": [[0.0, Color("#f8e6b0")], [0.45, Color("#2e5ea6")], [1.0, Color("#081836")]],
}

## minor gods: name, the god power key, a short focus line (EGYPT.md 5)
const MINOR := {
	"bast": {"name": "Bast", "power": "eclipse", "focus": "Myth units and Laborers"},
	"ptah": {"name": "Ptah", "power": "shifting_sands", "focus": "Technology and Barracks units"},
	"anubis": {"name": "Anubis", "power": "plague_of_serpents", "focus": "Anubites and Monuments"},
	"sobek": {"name": "Sobek", "power": "locust_swarm", "focus": "Buildings and camel units"},
	"sekhmet": {"name": "Sekhmet", "power": "citadel", "focus": "Ranged and siege weapons"},
	"nephthys": {"name": "Nephthys", "power": "ancestors", "focus": "Pharaohs and Priests"},
	"osiris": {"name": "Osiris", "power": "son_of_osiris", "focus": "Camels and Pharaohs"},
	"horus": {"name": "Horus", "power": "tornado", "focus": "Infantry"},
	"thoth": {"name": "Thoth", "power": "thoth_meteor", "focus": "War Elephants and economy"},
}

## the minor gods each Egyptian major god offers per age (Retold, EGYPT.md 4); the
## sim's get_gods(owner).offered / minor_gods_of() are read first when present
const OFFERED := {
	"ra": {1: ["bast", "ptah"], 2: ["sobek", "sekhmet"], 3: ["horus", "osiris"]},
	"isis": {1: ["anubis", "bast"], 2: ["sobek", "nephthys"], 3: ["osiris", "thoth"]},
	"set": {1: ["anubis", "ptah"], 2: ["nephthys", "sekhmet"], 3: ["horus", "thoth"]},
}

## the major gods' Archaic powers
const MAJOR_POWER := {"ra": "rain", "isis": "prosperity", "set": "vision"}

const RING := '<circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="50" cy="50" r="39" fill="none" stroke="currentColor" stroke-width="1.5"/>'

const SVG := {
	# ---- major gods (100) ----
	"ra": '<svg viewBox="0 0 100 100">' + RING + '<circle cx="53" cy="24" r="11.5" fill="currentColor"/><path d="M40.6 30.4c-3.4-1.6-3.6-6.4-.6-8.2 1.6 1.4 1.8 3.8.4 5.4l1 2.2z" fill="currentColor"/><path fill-rule="evenodd" fill="currentColor" d="M66 88c2-10 4-20 2-30-2-10-8-15-16-15s-14 4-16 9c-4 1-8 3-10 6-1 2 0 4 2 4 2-1 4-1 6 0 2 6 7 10 13 11 0 6-2 11-5 15zM48 49.8a3.2 3.2 0 1 0 .01 0zM46 58c1 4 0 8-2 12l3 .5c2-4 3-8 2-12.5z"/></svg>',
	"isis": '<svg viewBox="0 0 100 100">' + RING + '<path fill-rule="evenodd" d="M38 18h12v8h12v14H38zM42 22v14h16v-6H46v-8z" fill="currentColor"/><circle cx="50" cy="48" r="5" fill="currentColor"/><path d="M48 56c-9-5-21-7-34-3.6 6.4 3.2 13 4.6 19.6 5.4-8.6.6-15.6 3.8-21 8.4 10.6-1.4 20.6-3.4 29.6-5.4-6.4 2.6-12 6.4-16 10.6 9.6-2.6 17.4-6.6 23.8-11.4zM52 56c9-5 21-7 34-3.6-6.4 3.2-13 4.6-19.6 5.4 8.6.6 15.6 3.8 21 8.4-10.6-1.4-20.6-3.4-29.6-5.4 6.4 2.6 12 6.4 16 10.6-9.6-2.6-17.4-6.6-23.8-11.4z" fill="currentColor"/><path d="M46 60h8l-1 26h-6z" fill="currentColor"/></svg>',
	"set": '<svg viewBox="0 0 100 100">' + RING + '<path fill-rule="evenodd" fill="currentColor" d="M62 88c-2-10-3-20-1-28-3-1-7-1-11 0-8 2-16 6-24 12-4 2-7 0-5-3 7-8 17-15 29-19 3-1 6-2 8-3l-3-31h8l1 25h3l2-25h8l-4 31c2 4 1 9-3 13-2 9-2 19 0 28zM63 50.4a2.6 2.6 0 1 0 .01 0z"/></svg>',
	# ---- minor gods (100, no ring) ----
	"mg_bast": '<svg viewBox="0 0 100 100"><path fill-rule="evenodd" d="M38 92c-9 0-11-8-7-16 4-10 6-20 6-30 0-6-2-12 0-18l-2-15 9 8.4c4-1 8-1 12 0l9-8.4-2 15c2 6 0 12-4 16 4 10 8 22 8 34 0 8-4 14-10 14zM44 32a2.4 2.4 0 1 0 .01 0zM56 32a2.4 2.4 0 1 0 .01 0z" fill="currentColor"/><path d="M66 86c10 0 14-8 8-14" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><circle cx="50" cy="46" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
	"mg_ptah": '<svg viewBox="0 0 100 100"><path d="M43 34h14v52H43z" fill="currentColor"/><path d="M30 12h40v6H30zM30 21h40v6H30zM30 30h40v6H30zM34 39h32v5H34z" fill="currentColor"/><path d="M36 86h28v6H36z" fill="currentColor"/><path d="M41 10c0-4 18-4 18 0z" fill="currentColor"/></svg>',
	"mg_anubis": '<svg viewBox="0 0 100 100"><path fill-rule="evenodd" d="M20 70c0-9 7-13 19-13h23c6 0 8-5 8-11l-2-20 6 11 4-12 1 18c4 2 9 4 11 8l-8 2c-4 2-6 6-8 10v7zM76 42a2 2 0 1 0 .01 0z" fill="currentColor"/><path d="M20 66c-8 0-10 8-6 12" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round"/><path d="M12 74h76v18H12z" fill="currentColor"/><path d="M18 79h64v2H18zM18 85h64v2H18z" fill="#000" opacity=".35"/></svg>',
	"mg_sobek": '<svg viewBox="0 0 100 100"><path d="M60 32c-3-10-2-20 2-28 3 8 4 18 2 28zM80 32c3-10 2-20-2-28-3 8-4 18-2 28z" fill="currentColor"/><circle cx="70" cy="24" r="9" fill="currentColor"/><path d="M48 38c8-4 16-4 22-1 6-3 14-3 22 1-8 2-15 3-22 3s-14-1-22-3z" fill="currentColor"/><path fill-rule="evenodd" fill="currentColor" d="M6 64c0-4 3-7 8-7l40-5c4-7 12-10 20-9 9 1 14 9 13 18l-2 14-30-1-41-4c-5 0-8-3-8-6zM73 52a3 3 0 1 0 .01 0z"/><circle cx="13" cy="57" r="4.5" fill="currentColor"/><path d="M14 65l4 3 4-3 4 3 4-3 4 3 4-3 4 3 4-3 4 3 4-3 4 3 6-2" fill="none" stroke="#000" stroke-width="2.2" opacity=".55" stroke-linejoin="round"/></svg>',
	"mg_sekhmet": '<svg viewBox="0 0 100 100"><circle cx="58" cy="11" r="9" fill="currentColor"/><path d="M45.6 17c-3-2-3-7 0-9 2 2 2 5 0 7z" fill="currentColor"/><path fill-rule="evenodd" fill="currentColor" d="M28 94V52c0-16 12-26 27-26 10 0 16 4 20 10l9 10c4 4 4 10 2 12l-2 8c-2 4-6 6-10 6l-2 6c-2 4-8 6-14 6l-2 10zM66 44c2-3 6-3 8 0-2 2-6 2-8 0z"/><path d="M44 31c-3-10 5-15 11-6z" fill="currentColor"/><path d="M85 60c-4 2-6 4-9 4M36 54v38M44 58v34M52 64v28" fill="none" stroke="#000" stroke-width="2" opacity=".4" stroke-linecap="round"/></svg>',
	"mg_nephthys": '<svg viewBox="0 0 100 100"><path d="M28 14h44c0 10-10 16-22 16S28 24 28 14z" fill="currentColor"/><path fill-rule="evenodd" d="M24 38h52v54H24zM32 46v38h36V46zM56 72h12v12H56z" fill="currentColor"/><path d="M56 72h12v12H56z" fill="currentColor"/></svg>',
	"mg_osiris": '<svg viewBox="0 0 100 100"><path d="M41 80c-2-20 0-40 6-56 2-6 4-6 6 0 6 16 8 36 6 56z" fill="currentColor"/><circle cx="50" cy="13" r="5" fill="currentColor"/><path d="M30 80c-2-20-2-40 2-58 2-6 7-3 5 3-2 18 0 36 2 55zM70 80c2-20 2-40-2-58-2-6-7-3-5 3 2 18 0 36-2 55z" fill="currentColor"/><path d="M14 86c8-6 22-5 36-1 14-4 28-5 36 1-8 5-22 6-36 4-14 2-28 1-36-4z" fill="currentColor"/></svg>',
	"mg_horus": '<svg viewBox="0 0 100 100"><path d="M12 30c18-9 56-9 78 0l-2 6c-22-6-54-6-74 0z" fill="currentColor"/><path fill-rule="evenodd" d="M14 52c12-13 52-13 72 0-20 13-60 13-72 0zM50 52a9 9 0 1 0 .01 0z" fill="currentColor"/><circle cx="50" cy="52" r="5.4" fill="currentColor"/><path d="M42 61l-5 27h7l5-26z" fill="currentColor"/><path d="M60 61c4 12 10 20 18 21 8 0 10-8 4-12-4-2-8 2-6 6" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>',
	"mg_thoth": '<svg viewBox="0 0 100 100"><path fill-rule="evenodd" fill="currentColor" d="M66 8a14 14 0 1 1-.01 0zM66 13a9 9 0 1 0 .01 0z"/><circle cx="66" cy="22" r="6" fill="currentColor"/><path fill-rule="evenodd" fill="currentColor" d="M64 94c-2-12-2-24 0-32-4-2-10-1-16 2-10 6-18 14-24 22-2 2-5 1-4-2 6-10 16-20 28-27 6-4 10-7 12-11 2-5 7-7 12-6 5 2 6 8 3 12-3 4-5 8-5 14 0 10 0 20 2 28zM69 46.4a2 2 0 1 0 .01 0z"/></svg>',
	# ---- god powers (24) ----
	"rain": '<svg viewBox="0 0 24 24"><defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2f6fb"/><stop offset="1" stop-color="#6c7c98"/></linearGradient></defs><path d="M5.2 12.4a3.8 3.8 0 0 1 .6-7.6 5.4 5.4 0 0 1 10.2-.6 4 4 0 0 1 3.4 8.2z" fill="url(#c)" stroke="#232c40" stroke-width="1"/><path d="M6.2 6.4a3.4 3.4 0 0 1 3.2-2" stroke="#fff" stroke-width=".9" fill="none" stroke-linecap="round"/><path d="M7.4 14.4l-1.4 3.2M11.2 14.4l-1.4 3.2M15 14.4l-1.4 3.2M9.2 18.6l-1.2 2.8M13 18.6l-1.2 2.8" stroke="#1a3a66" stroke-width="2.4" stroke-linecap="round"/><path d="M7.4 14.4l-1.4 3.2M11.2 14.4l-1.4 3.2M15 14.4l-1.4 3.2M9.2 18.6l-1.2 2.8M13 18.6l-1.2 2.8" stroke="#7cd0ff" stroke-width="1.3" stroke-linecap="round"/><path d="M19 22.5v-4.2" stroke="#1e4a14" stroke-width="1.8" stroke-linecap="round"/><path d="M19 19.4c-2.2-.1-3.4-1.4-3.4-3.2 2.2.1 3.4 1.4 3.4 3.2zM19 18.6c.2-2 1.4-3 3.2-3-.2 2-1.4 3-3.2 3z" fill="#66c84a" stroke="#1e4a14" stroke-width=".7"/></svg>',
	"prosperity": '<svg viewBox="0 0 24 24"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6c0"/><stop offset=".45" stop-color="#f2b824"/><stop offset="1" stop-color="#7a4c04"/></linearGradient></defs><path d="M12 13L6 5M12 13l8-9M12 13l1-11" stroke="#ffe680" stroke-width="1" opacity=".7"/><path d="M2.6 21l2.6-5.6 4.6-1 2.8 2.8-.8 3.8z" fill="url(#g)" stroke="#3e2a04" stroke-width="1"/><path d="M11 21.6l1.8-5.8 4.8-1.8 3 3.8-2 3.8z" fill="url(#g)" stroke="#3e2a04" stroke-width="1"/><path d="M7.2 14.4l1.8-4.8 4-1 2 3-1.8 3.6z" fill="url(#g)" stroke="#3e2a04" stroke-width="1"/><path d="M8.6 11.2l1-2.2M4.6 17.6l1-1.6M13.4 17.4l1.4-1.6" stroke="#fff8d0" stroke-width=".9" stroke-linecap="round"/><path d="M18.4 1.6l.9 2.7 2.7.9-2.7.9-.9 2.7-.9-2.7-2.7-.9 2.7-.9z" fill="#fffbe2" stroke="#c8901a" stroke-width=".5"/><path d="M4.6 3.4l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" fill="#fffbe2" stroke="#c8901a" stroke-width=".4"/></svg>',
	"vision": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.4" fill="#0c1a2c" opacity=".55"/><circle cx="12" cy="12" r="10" fill="none" stroke="#eef6ff" stroke-width="1.1" stroke-dasharray="4.2 2.6"/><circle cx="12" cy="12" r="8.2" fill="none" stroke="#9ccaff" stroke-width=".6" stroke-dasharray="2 3"/><path d="M3.6 11.4c2.8-4 5.6-5.6 8.4-5.6s5.6 1.6 8.4 5.6c-2.8 4-5.6 5.6-8.4 5.6s-5.6-1.6-8.4-5.6z" fill="#f6f0dc" stroke="#121e34" stroke-width="1.1"/><circle cx="12" cy="11.4" r="3.4" fill="#2c72c8" stroke="#08162a" stroke-width=".8"/><circle cx="12" cy="11.4" r="1.5" fill="#060c18"/><circle cx="10.9" cy="10.3" r=".75" fill="#fff"/><path d="M3.4 8.4c3-2.6 14-2.6 17.2 0" stroke="#121e34" stroke-width="1.3" fill="none" stroke-linecap="round"/><path d="M10.4 17l-1 4.4M14.2 16.6l2.4 3.4c.8 1 2 .4 1.6-.6" stroke="#f6e6b0" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>',
	"eclipse": '<svg viewBox="0 0 24 24"><defs><radialGradient id="k" cx=".5" cy=".5" r=".5"><stop offset=".55" stop-color="#ffe08a"/><stop offset=".72" stop-color="#ff9a30" stop-opacity=".8"/><stop offset="1" stop-color="#ff5a20" stop-opacity="0"/></radialGradient></defs><circle cx="12" cy="12" r="11.4" fill="url(#k)"/><circle cx="12" cy="12" r="7.2" fill="#fff2c0"/><circle cx="13.2" cy="11.2" r="7" fill="#161230" stroke="#4c3c80" stroke-width=".8"/><path d="M8.6 7.8a6 6 0 0 1 4-1.6" stroke="#8a78d0" stroke-width=".8" fill="none" stroke-linecap="round"/><circle cx="3" cy="4" r=".7" fill="#fff"/><circle cx="21" cy="20" r=".6" fill="#fff"/><circle cx="20.4" cy="3.6" r=".5" fill="#fff"/></svg>',
	"shifting_sands": '<svg viewBox="0 0 24 24"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe2a0"/><stop offset="1" stop-color="#b47a30"/></linearGradient></defs><path d="M1.6 21.4c2.4-2.6 5.6-3.4 8.6-2 2.4 1 4.2 1 6.6-.4 2-1.2 4-1.4 5.6-.6v3z" fill="url(#s)" stroke="#4a2e0c" stroke-width=".9"/><ellipse cx="6" cy="16.4" rx="4" ry="1.6" fill="none" stroke="#ffe6a8" stroke-width="1.2" stroke-dasharray="1.6 1.2"/><ellipse cx="18" cy="6.8" rx="4" ry="1.6" fill="none" stroke="#ffe6a8" stroke-width="1.2" stroke-dasharray="1.6 1.2"/><path d="M6 14.2C6 7 11 3.6 16.2 5" stroke="#4a2e0c" stroke-width="2.8" fill="none" stroke-linecap="round"/><path d="M6 14.2C6 7 11 3.6 16.2 5" stroke="#ffd070" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-dasharray="2.2 1.4"/><path d="M14.6 2.8l3.4 2.4-3.6 2" fill="#ffd070" stroke="#4a2e0c" stroke-width=".8" stroke-linejoin="round"/><circle cx="4" cy="12" r=".6" fill="#ffe6a8"/><circle cx="8.4" cy="12.8" r=".5" fill="#ffe6a8"/><circle cx="20" cy="10" r=".6" fill="#ffe6a8"/></svg>',
	"plague_of_serpents": '<svg viewBox="0 0 24 24"><path d="M5.6 21.4c-2.6 0-3-3 0-4l8.2-3.2c3-1.2 3-5 0-5.6-2-.4-3 1-2.4 2.4" stroke="#183008" stroke-width="4.4" fill="none" stroke-linecap="round"/><path d="M5.6 21.4c-2.6 0-3-3 0-4l8.2-3.2c3-1.2 3-5 0-5.6-2-.4-3 1-2.4 2.4" stroke="#6cc23e" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M5.2 19.4l8.6-3.4M8 18.6l.6.8M11 17.4l.6.8" stroke="#c8f08a" stroke-width=".7" fill="none"/><path d="M10.6 6.6c0-2.4 1.8-4 4.2-4 2.6 0 4 1.6 4 3.4 0 1.6-1.6 2.6-4 2.6-2.4 0-4.2-.4-4.2-2z" fill="#6cc23e" stroke="#183008" stroke-width="1"/><circle cx="16.4" cy="5.2" r=".9" fill="#ffe040" stroke="#183008" stroke-width=".4"/><path d="M18.6 6.4l2.6.4M21.2 6.8l1.2-.8M21.2 6.8l1 1" stroke="#e02a20" stroke-width=".8" stroke-linecap="round"/></svg>',
	"locust_swarm": '<svg viewBox="0 0 24 24"><g fill="#3a3a14"><circle cx="3" cy="4" r=".9"/><circle cx="6" cy="2.6" r=".7"/><circle cx="5" cy="6" r=".8"/><circle cx="9" cy="4" r=".7"/><circle cx="2.4" cy="8" r=".6"/><circle cx="8" cy="7.2" r=".6"/></g><path d="M4.4 15.6c4-3 9.4-4.2 14.6-3.2 1.2.3 1.6 1.6.4 2.2-4.2 2-9.4 2.6-15 1.6z" fill="#94a840" stroke="#262e0c" stroke-width=".9"/><path d="M7.4 13.6c3.2-4.4 7.4-6.6 12-6.6-2.2 3.4-6.4 5.6-12 6.6z" fill="#efe6b8" stroke="#5a5030" stroke-width=".7" opacity=".92"/><path d="M9.6 12.4c2.6-2 5.2-3.4 8-4M11 11.6l1.4-2.4M14 10.4l1-2" stroke="#9a8a5a" stroke-width=".5" fill="none"/><path d="M9 16l-2.2 4.2M12.2 16.2l1 4 2.2.6M15.6 15.6l3 3.8" stroke="#262e0c" stroke-width="1" fill="none" stroke-linecap="round"/><circle cx="18.6" cy="13" r="1" fill="#e0c030" stroke="#262e0c" stroke-width=".4"/><path d="M19.4 12.2c1-2 2.4-3.4 4-4M19 12c.4-2.4.2-4.4-.6-6" stroke="#262e0c" stroke-width=".7" fill="none" stroke-linecap="round"/></svg>',
	"citadel": '<svg viewBox="0 0 24 24"><defs><linearGradient id="t" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffe6b0"/><stop offset=".55" stop-color="#d8a860"/><stop offset="1" stop-color="#8a5e26"/></linearGradient></defs><path d="M5.4 22.4l.8-13h11.6l.8 13z" fill="url(#t)" stroke="#3a240a" stroke-width="1"/><path d="M4.6 9.6V5h2.8v2h2V5h5.2v2h2V5h2.8v4.6z" fill="url(#t)" stroke="#3a240a" stroke-width="1"/><path d="M5.6 11h12.8" stroke="#2f6bd0" stroke-width="1.6"/><path d="M10 22.4v-4.6a2 2 0 0 1 4 0v4.6z" fill="#2a1606"/><path d="M8 13.6h1.6v2.6H8zM14.4 13.6H16v2.6h-1.6z" fill="#2a1606"/><path d="M12 5V1.4" stroke="#3a240a" stroke-width="1"/><path d="M12 1.4l4 1.2-4 1.4z" fill="#e8b830" stroke="#3a240a" stroke-width=".6"/><path d="M6.6 21.6l.6-11" stroke="#fff4d0" stroke-width=".8" opacity=".7"/></svg>',
	"ancestors": '<svg viewBox="0 0 24 24"><path d="M4.4 22.6c0-7.4 3.2-12.8 7.6-12.8s7.6 5.4 7.6 12.8z" fill="#2c5aa0" stroke="#0c1a36" stroke-width="1"/><path d="M6 10.6C6 5.6 8.6 2 12 2s6 3.6 6 8.6c-1.6 1.4-3.8 2-6 2s-4.4-.6-6-2z" fill="#3a6cc0" stroke="#0c1a36" stroke-width="1"/><ellipse cx="12" cy="9.4" rx="3.6" ry="4.2" fill="#b8c2b0" stroke="#2a3028" stroke-width=".8"/><ellipse cx="10.6" cy="8.8" rx="1.1" ry="1.3" fill="#10140e"/><ellipse cx="13.4" cy="8.8" rx="1.1" ry="1.3" fill="#10140e"/><circle cx="10.6" cy="8.8" r=".5" fill="#8cff8a"/><circle cx="13.4" cy="8.8" r=".5" fill="#8cff8a"/><path d="M10.4 12h3.2M11 12v1M12 12v1M13 12v1" stroke="#2a3028" stroke-width=".6"/><path d="M8 16l-4-3M16 16l4-3" stroke="#b8c2b0" stroke-width="1.6" stroke-linecap="round"/><path d="M1.4 22.6h21.2" stroke="#6a4a22" stroke-width="1.4"/></svg>',
	"son_of_osiris": '<svg viewBox="0 0 24 24"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2b0"/><stop offset=".45" stop-color="#e2a82c"/><stop offset="1" stop-color="#7a4e08"/></linearGradient></defs><path d="M2 6l3 1.6-1.8 2 3 1.6M22 6l-3 1.6 1.8 2-3 1.6M3 17l3-1-1 3 3-1" stroke="#cfeaff" stroke-width="1.2" fill="none" stroke-linejoin="round"/><path fill-rule="evenodd" d="M12 1.8c-2.6 0-4.2 2.2-4.2 4.6 0 1.8 1 3.2 2.2 4.2H6.4V13h4.4v9.2h2.4V13h4.4v-2.4H14c1.2-1 2.2-2.4 2.2-4.2 0-2.4-1.6-4.6-4.2-4.6zm0 2.2c1.2 0 2 1.1 2 2.5s-.9 2.8-2 3.6c-1.1-.8-2-2.2-2-3.6s.8-2.5 2-2.5z" fill="url(#a)" stroke="#3e2a04" stroke-width=".8"/><path d="M8.4 6c.2-1.4 1-2.4 2-2.8" stroke="#fffbe0" stroke-width=".7" fill="none" stroke-linecap="round"/></svg>',
	"tornado": '<svg viewBox="0 0 24 24"><defs><linearGradient id="w" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e6e2d6"/><stop offset=".6" stop-color="#9a9488"/><stop offset="1" stop-color="#55504a"/></linearGradient></defs><path d="M2 3.4h20l-4 4.6-2.6 4.4-1.6 4.4-.8 5h-2l.4-5-1.6-4.2L6.4 8z" fill="url(#w)" stroke="#2a2620" stroke-width="1"/><path d="M3.6 5h16.4M6 8.2h12M8.4 11.4h7.6M10.2 14.6h4.4M11.2 17.8h2.2" stroke="#2a2620" stroke-width=".8" opacity=".55"/><path d="M4.6 4.2c4 1.4 10 1.4 14.4 0" stroke="#fff" stroke-width=".7" fill="none" opacity=".7"/><path d="M3 12.4l2 .6M19.4 15.6l1.8-.8M4.4 18.6l1.6-1.2" stroke="#6a4a22" stroke-width="1.4" stroke-linecap="round"/></svg>',
	# ---- commands (24) ----
	"empower": '<svg viewBox="0 0 24 24"><defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffbe0" stop-opacity="0"/><stop offset=".5" stop-color="#fff2b0" stop-opacity=".9"/><stop offset="1" stop-color="#ffd860"/></linearGradient><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2b0"/><stop offset=".45" stop-color="#e2a82c"/><stop offset="1" stop-color="#7a4e08"/></linearGradient></defs><path d="M7.4 0h9.2l2.2 20H5.2z" fill="url(#b)"/><ellipse cx="12" cy="20.4" rx="9.4" ry="2.6" fill="none" stroke="#ffd860" stroke-width="1.4"/><ellipse cx="12" cy="20.4" rx="9.4" ry="2.6" fill="none" stroke="#fff6c8" stroke-width=".5"/><path fill-rule="evenodd" d="M12 3.4c-2 0-3.2 1.7-3.2 3.5 0 1.4.8 2.4 1.7 3.2H7.2v1.8h3.4v7.2h2.8v-7.2h3.4v-1.8h-3.3c.9-.8 1.7-1.8 1.7-3.2 0-1.8-1.2-3.5-3.2-3.5zm0 1.7c.9 0 1.5.9 1.5 1.9s-.7 2.1-1.5 2.7c-.8-.6-1.5-1.7-1.5-2.7s.6-1.9 1.5-1.9z" fill="url(#a)" stroke="#3e2a04" stroke-width=".8"/></svg>',
	"monument": '<svg viewBox="0 0 24 24"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2b0"/><stop offset=".45" stop-color="#e2a82c"/><stop offset="1" stop-color="#7a4e08"/></linearGradient></defs><path d="M3 22.4h18v-3.6H3z" fill="#2a2a34" stroke="#0c0c10" stroke-width=".9"/><path d="M5 18.8h14v-2.4H5z" fill="url(#a)" stroke="#3e2a04" stroke-width=".8"/><path d="M9 16.4V9.6c0-1.6 1.2-2.6 3-2.6s3 1 3 2.6v6.8z" fill="#2c2c3a" stroke="#0c0c10" stroke-width=".9"/><path d="M8.6 9.4c0-3 1.4-5.6 3.4-5.6s3.4 2.6 3.4 5.6c-1 .6-2.2.8-3.4.8s-2.4-.2-3.4-.8z" fill="url(#a)" stroke="#3e2a04" stroke-width=".8"/><path d="M8.6 7.6h6.8M8.8 6h6.4" stroke="#2f5ea6" stroke-width=".8"/><path d="M12 3.8V1.2" stroke="#8fd0ff" stroke-width="1.4" stroke-linecap="round"/><path d="M9.4 2.4l-1-1.6M14.6 2.4l1-1.6" stroke="#8fd0ff" stroke-width="1" stroke-linecap="round"/></svg>',
	"summon": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#3a0e3a" stroke="#c070e0" stroke-width="1.2"/><path d="M12 4.6l1.6 4.6 4.8.2-3.8 3 1.4 4.6-4-2.8-4 2.8 1.4-4.6-3.8-3 4.8-.2z" fill="#e8b8ff" stroke="#3a0e3a" stroke-width=".6"/></svg>',
}

## the viewBox size of an icon here (0 = not one of these)
static func viewbox(name: String) -> float:
	if not SVG.has(name):
		return 0.0
	return 100.0 if name in ["ra", "isis", "set"] or name.begins_with("mg_") else 24.0

static func is_egypt_god(god: String) -> bool:
	return god.to_lower() in ["ra", "isis", "set"]

## the two minor gods `major` offers at `age` (1..3), the sim's answer when it has one
static func offered(sim: Object, major: String, age: int) -> Array:
	var m := major.to_lower()
	if sim != null and sim.has_method("minor_gods_of"):
		var l: PackedStringArray = sim.minor_gods_of(m, age)
		if not l.is_empty():
			return Array(l)
	return OFFERED.get(m, {}).get(age, [])

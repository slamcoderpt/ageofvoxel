// Inline SVG icons for the HUD (no external assets).
export const ICONS = {
  food: `<svg viewBox="0 0 24 24"><circle cx="9" cy="14" r="6" fill="#d8332c"/><circle cx="15" cy="13" r="6" fill="#e5483a"/><path d="M12 7c0-3 2-4 4-4" stroke="#5b3a1d" stroke-width="2" fill="none"/><path d="M13 6c2-2 5-1 6 0-2 2-4 2-6 0z" fill="#5da83a"/><circle cx="12.5" cy="11" r="1.6" fill="#ffb3a6" opacity=".7"/></svg>`,
  wood: `<svg viewBox="0 0 24 24"><rect x="2" y="12" width="20" height="6" rx="3" fill="#8a5a30"/><rect x="4" y="6" width="18" height="6" rx="3" fill="#a06a38"/><circle cx="20" cy="9" r="2.6" fill="#e0b47a"/><circle cx="20" cy="9" r="1.2" fill="#b47e45"/><circle cx="4.5" cy="15" r="2.6" fill="#e0b47a"/><circle cx="4.5" cy="15" r="1.2" fill="#b47e45"/></svg>`,
  gold: `<svg viewBox="0 0 24 24"><path d="M3 18l4-7h6l-4 7z" fill="#e0a526"/><path d="M11 18l4-7h6l-4 7z" fill="#f2c14e"/><path d="M7 11l3-5h5l-3 5z" fill="#ffd970"/><path d="M8 11l2-3" stroke="#fff4c0" stroke-width="1"/></svg>`,
  favor: `<svg viewBox="0 0 24 24"><path d="M13 2L5 14h6l-2 8 10-13h-6l3-7z" fill="#8fd0ff" stroke="#e8f6ff" stroke-width="1"/></svg>`,
  pop: `<svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="4" fill="#e9dcc0"/><path d="M4 22c0-6 3.5-9 8-9s8 3 8 9z" fill="#e9dcc0"/></svg>`,
  stop: `<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2" fill="#d6423a" stroke="#fff" stroke-width="1.5"/></svg>`,
  age: `<svg viewBox="0 0 24 24"><path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill="#f2c14e" stroke="#fff3c4" stroke-width="1"/></svg>`,
  storm: `<svg viewBox="0 0 24 24"><ellipse cx="12" cy="7" rx="9" ry="4.5" fill="#566078"/><path d="M11 10l-4 7h4l-2 6 7-9h-4l2-4z" fill="#bfe3ff"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24"><path d="M14 1L6 13h5l-3 10 10-14h-5l3-8z" fill="#ffe27a" stroke="#fff" stroke-width="1"/></svg>`,
  attack: `<svg viewBox="0 0 24 24"><path d="M4 20L18 6l1-3-3 1L2 18z" fill="#cfd6dc"/><path d="M3 21l3-3" stroke="#7a5230" stroke-width="3"/></svg>`,
};

// Stat / HUD chrome icons (Retold-style info panel, minimap tray, age hub).
Object.assign(ICONS, {
  heart: `<svg viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-11a4.6 4.6 0 0 1 8-3.1A4.6 4.6 0 0 1 20 10c0 5.8-8 11-8 11z" fill="#d8322b" stroke="#ffb0a0" stroke-width="1"/></svg>`,
  sword: `<svg viewBox="0 0 24 24"><path d="M19.5 2.5l2 2-11 11-2-2z" fill="#dfe6ec" stroke="#8c9aa6" stroke-width=".8"/><path d="M5 14l5 5-1.5 1.5-5-5z" fill="#c9a24c"/><path d="M4.5 18.5l-2 2 1 1 2-2z" fill="#7a5230"/></svg>`,
  shield: `<svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" fill="#6f86a8" stroke="#dfe8f4" stroke-width="1.2"/><path d="M12 5v14" stroke="#dfe8f4" stroke-width="1"/></svg>`,
  speed: `<svg viewBox="0 0 24 24"><path d="M7 3h5l-1 9 7 3v4H5l1-7z" fill="#b48a55" stroke="#f0d6a8" stroke-width="1"/></svg>`,
  eye: `<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" fill="#e9dcc0"/><circle cx="12" cy="12" r="3.6" fill="#3a5f86"/><circle cx="12" cy="12" r="1.6" fill="#111"/></svg>`,
  bag: `<svg viewBox="0 0 24 24"><path d="M8 4h8l-2 3c4 2 6 6 6 9 0 3-3 5-8 5s-8-2-8-5c0-3 2-7 6-9z" fill="#c09050" stroke="#f3dca4" stroke-width="1"/></svg>`,
  house: `<svg viewBox="0 0 24 24"><path d="M3 11L12 3l9 8v10H3z" fill="#e9dcc0"/><path d="M1.5 11.5L12 2.5l10.5 9" stroke="#b9532e" stroke-width="2.4" fill="none"/><rect x="10" y="14" width="4" height="7" fill="#6a4a2a"/></svg>`,
  villager: `<svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="3.6" fill="#f0d2a8"/><path d="M5.5 7.5c1-4 12-4 13 0z" fill="#d9b25a"/><path d="M5 22c0-6 3-9 7-9s7 3 7 9z" fill="#4a78c8"/></svg>`,
  flare: `<svg viewBox="0 0 24 24"><path d="M12 2v6M12 16v6M2 12h6M16 12h6" stroke="#ffe27a" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="#ffe27a"/></svg>`,
  zeus: `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="50" cy="50" r="39" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M57 12L30 55h17l-8 33 31-45H53z" fill="currentColor"/><path d="M20 50c4-8 10-12 14-12M80 50c-4-8-10-12-14-12" stroke="currentColor" stroke-width="3" fill="none"/></svg>`,
  wing: `<svg viewBox="0 0 120 40"><defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6dc9a"/><stop offset=".5" stop-color="#c79a4c"/><stop offset="1" stop-color="#6a4a22"/></linearGradient></defs><path d="M118 6C90 4 55 6 18 14 34 14 46 13 58 13 40 17 24 22 6 30c22-3 38-6 54-8-14 5-26 10-36 16 26-5 50-12 70-20 10-4 18-9 24-18z" fill="url(#wg)" stroke="#2a1a0c" stroke-width="1.4"/><path d="M110 10C84 12 64 15 40 20M104 16C84 20 66 24 46 30" stroke="#5a3c18" stroke-width="1" fill="none" opacity=".7"/></svg>`,
});
ICONS.meteor = `<svg viewBox="0 0 24 24"><path d="M3 3l9 6M6 2l8 8M2 7l9 5" stroke="#ffb347" stroke-width="2" stroke-linecap="round" opacity=".85"/><circle cx="15.5" cy="15.5" r="6" fill="#8a3a1a"/><circle cx="15.5" cy="15.5" r="4.2" fill="#e5601e"/><circle cx="14" cy="14" r="1.8" fill="#ffd27a"/></svg>`;

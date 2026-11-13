// Ícones em traço (24x24, cor = texto). Substituem os emojis da interface.
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  wallet: '<path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6"/><path d="M16.5 14h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  camera: '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h2l1.5-2h6l1.5 2h2A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  clip: '<path d="m21 11.5-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l8-8"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  receipt: '<path d="M5 3v18l2.3-1.5L9.7 21 12 19.5 14.3 21l2.4-1.5L19 21V3l-2.3 1.5L14.3 3 12 4.5 9.7 3 7.3 4.5Z"/><path d="M9 9h6M9 13h6"/>',
  lock: '<rect x="4.5" y="11" width="15" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  alert: '<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  scale: '<path d="M12 3v18M8 21h8M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7M19 7l-3 7a3 3 0 0 0 6 0l-3-7"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pencil: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  share: '<path d="M12 3v13M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7M12 17h.01"/>',
  coins: '<circle cx="9" cy="9" r="6"/><path d="M18.1 10.4A6 6 0 1 1 10.4 18.1M8 7h1.5v4"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  // ambientes
  kitchen: '<path d="M4 11h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Z"/><path d="M2 11h20M9 7.5c0-1.5 1-1.5 1-3M14 7.5c0-1.5 1-1.5 1-3"/>',
  bath: '<path d="M3 12h18v3a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5Z"/><path d="M6 12V5.5a2 2 0 0 1 4 0M7 20l-1 2M17 20l1 2"/>',
  sofa: '<path d="M5 11V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v3"/><path d="M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM6 19v2M18 19v2"/>',
  laundry: '<rect x="4" y="2.5" width="16" height="19" rx="2.5"/><circle cx="12" cy="13.5" r="4.5"/><path d="M8 6h.01M11 6h.01"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z"/><path d="M2 21c0-3 1.9-5.4 5.1-6"/>',
  bed: '<path d="M3 19V6M3 14h18v5M21 14v-1a3 3 0 0 0-3-3h-7v4"/><circle cx="7" cy="10.5" r="1.8"/>',
  car: '<path d="M5 17h14v-4l-2-5H7l-2 5Z"/><path d="M3 13h18M7 17v2M17 17v2"/>',
  book: '<path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4ZM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6Z"/>',
  paw: '<circle cx="6.5" cy="10" r="1.8"/><circle cx="10" cy="6" r="1.8"/><circle cx="14.5" cy="6" r="1.8"/><circle cx="18" cy="10" r="1.8"/><path d="M8 17.5c0-3 2-5.5 4.2-5.5S16.5 14.5 16.5 17.5a2.4 2.4 0 0 1-3 2.3c-.9-.2-1.8-.2-2.7 0A2.4 2.4 0 0 1 8 17.5Z"/>',
  broom: '<path d="M15 3 11 11M7 12h8l3 9H4ZM9 16l-1 5M13 16l1 5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/>',
  dish: '<path d="M4 3v7a3 3 0 0 0 3 3v8M7 3v6M10 3v7a3 3 0 0 1-3 3M17 21V3c-2 1-3 4-3 8h3"/>',
  // compras
  droplet: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>',
  flame: '<path d="M12 3c1 3 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 1.6 1.2 2.5 2 2.5 0-2.5-.5-5 .5-7.5Z"/>',
  roll: '<circle cx="9" cy="9" r="5"/><circle cx="9" cy="9" r="1.6"/><path d="M14 9h5v11h-8M4 9v6a5 5 0 0 0 5 5"/>',
  bottle: '<path d="M10 2h4M11 2v3M13 2v3M9 9a3 3 0 0 1 3-4 3 3 0 0 1 3 4v11a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2Z"/>',
  sponge: '<rect x="3" y="7" width="18" height="10" rx="3"/><path d="M7 11h.01M11 13h.01M15 10h.01M17 14h.01"/>',
  coffee: '<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 2v3M12 2v3"/>',
  bread: '<path d="M6 21V11a4 4 0 0 1-1-7.9C6 2.5 9 2 12 2s6 .5 7 1.1A4 4 0 0 1 18 11v10Z"/>',
  milk: '<path d="M8 2h8M9 2v3L7 9v13h10V9l-2-4V2M7 13h10"/>',
  salt: '<path d="M8 8h8l1 13H7ZM9 8a3 3 0 0 1 6 0M11 13h.01M13 16h.01"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h11.5l2-8H6.2"/>',
  // contas
  bulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2Z"/>',
  wifi: '<path d="M2 8.8a15 15 0 0 1 20 0M5 12.6a10 10 0 0 1 14 0M8.5 16.4a5 5 0 0 1 7 0M12 20h.01"/>',
  building: '<rect x="5" y="2.5" width="14" height="19" rx="1.5"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01M10 21.5v-3h4v3"/>',
};
export const ENV_ICONS = ['home', 'kitchen', 'bath', 'sofa', 'laundry', 'leaf', 'bed', 'car', 'book', 'paw'];
export const SHOP_ICONS = ['droplet', 'flame', 'roll', 'bottle', 'sponge', 'coffee', 'bread', 'milk', 'salt', 'trash', 'cart'];

// dados antigos (gravados com emoji) continuam funcionando
const LEGACY = { '🏠': 'home', '🍳': 'kitchen', '🚿': 'bath', '🛋️': 'sofa', '🛋': 'sofa', '🧺': 'laundry', '🌿': 'leaf', '🛏️': 'bed', '🛏': 'bed', '🚗': 'car', '📚': 'book', '🐶': 'paw',
  '💧': 'droplet', '🔥': 'flame', '🧻': 'roll', '🧴': 'bottle', '🧽': 'sponge', '🧼': 'bottle', '☕': 'coffee', '🍞': 'bread', '🥛': 'milk', '🧂': 'salt', '🗑️': 'trash', '🗑': 'trash', '🛒': 'cart' };
export const iconKey = (v, fallback = 'home') => (P[v] ? v : LEGACY[v] || fallback);

export function I(name, cls = '') {
  const k = iconKey(name, 'home');
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[k]}</svg>`;
}

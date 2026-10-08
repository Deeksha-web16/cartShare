/* =========================================================
   CartShare - storage.js
   All localStorage / sessionStorage logic lives here.

   localStorage keys (one set per room, shared by all tabs):
     cartshare_room_<CODE>      -> room info + participants
     cartshare_cart_<CODE>      -> array of cart items
     cartshare_activity_<CODE>  -> array of activity entries

   sessionStorage key (private to ONE tab, survives refresh):
     cartshare_session          -> { user, roomCode }
   Using sessionStorage for the session lets you open two tabs
   as two different people (e.g. Deeksha and Rahul) in one browser.
   ========================================================= */
"use strict";

const STORAGE_PREFIX = "cartshare_";
const SESSION_KEY = STORAGE_PREFIX + "session";
const MAX_ACTIVITY = 50;

/* ---------- low-level helpers ---------- */

/** Build a key such as cartshare_cart_CS7K29 */
function keyFor(type, code) {
  return STORAGE_PREFIX + type + "_" + code;
}

/** Safely read and parse JSON from a storage object. */
function readJSON(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.error("Storage read failed:", err);
    return fallback;
  }
}

/** Safely stringify and save JSON. Returns true on success. */
function writeJSON(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error("Storage write failed:", err);
    return false;
  }
}

/** Unique id for items and activity entries. */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Trim + uppercase a room code. */
function normalizeRoomCode(code) {
  return String(code || "").trim().toUpperCase();
}

/* ---------- rooms ---------- */

/** Random 6-character code (no confusing characters like 0/O or 1/I). */
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "";
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (getRoom(code)); // make sure the code is unique
  return code;
}

function getRoom(code) {
  code = normalizeRoomCode(code);
  if (!code) return null;
  return readJSON(localStorage, keyFor("room", code), null);
}

function saveRoom(room) {
  return writeJSON(localStorage, keyFor("room", room.code), room);
}

/** Create a new room, empty cart and first activity entry. */
function createRoom(name) {
  const code = generateRoomCode();
  const now = Date.now();
  const room = {
    code: code,
    createdBy: name,
    createdAt: now,
    participants: [{ name: name, joinedAt: now, lastSeen: now }]
  };
  saveRoom(room);
  saveCart(code, []);
  saveActivity(code, []);
  addActivity(code, "🟢", name + " created the room.", name);
  return room;
}

/** Join an existing room. Returns { ok, room, error }. */
function joinRoom(name, code) {
  const room = getRoom(code);
  if (!room) {
    return { ok: false, error: "Room not found. Check the code and try again." };
  }
  const existing = room.participants.find(
    (p) => p.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) {
    existing.lastSeen = Date.now(); // same name = rejoining
  } else {
    room.participants.push({ name: name, joinedAt: Date.now(), lastSeen: Date.now() });
    saveRoom(room);
    addActivity(room.code, "🟢", name + " joined the room.", name);
    return { ok: true, room: room };
  }
  saveRoom(room);
  addActivity(room.code, "🟢", name + " rejoined the room.", name);
  return { ok: true, room: room };
}

/** Mark a participant as active "now" (adds them if missing). */
function touchPresence(code, name) {
  const room = getRoom(code);
  if (!room) return;
  const p = room.participants.find((x) => x.name === name);
  if (p) {
    p.lastSeen = Date.now();
  } else {
    room.participants.push({ name: name, joinedAt: Date.now(), lastSeen: Date.now() });
  }
  saveRoom(room);
}

/** Mark a participant as offline (does not delete them or the room). */
function markOffline(code, name) {
  const room = getRoom(code);
  if (!room) return;
  const p = room.participants.find((x) => x.name === name);
  if (p) {
    p.lastSeen = 0;
    saveRoom(room);
  }
}

/** Leave a room: only this user's presence changes. The cart stays. */
function leaveRoom(code, name) {
  markOffline(code, name);
  addActivity(code, "🚪", name + " left the room.", name);
  clearSession();
}

/* ---------- cart ---------- */

function getCart(code) {
  return readJSON(localStorage, keyFor("cart", normalizeRoomCode(code)), []);
}

function saveCart(code, items) {
  return writeJSON(localStorage, keyFor("cart", normalizeRoomCode(code)), items);
}

/**
 * Add an item. If an item with the same name and price already exists,
 * its quantity is increased instead of creating a duplicate row.
 * Returns { item, merged } or null if the data is invalid.
 */
function addCartItem(code, data, user) {
  code = normalizeRoomCode(code);
  const name = String(data.itemName || "").trim();
  const price = Math.round(Number(data.price) * 100) / 100;
  const quantity = parseInt(data.quantity, 10);
  if (!name || !isFinite(price) || price <= 0 || !Number.isInteger(quantity) || quantity < 1) {
    return null;
  }
  const cart = getCart(code);
  const found = cart.find(
    (i) => i.itemName.toLowerCase() === name.toLowerCase() && i.price === price
  );
  if (found) {
    found.quantity = Math.min(99, found.quantity + quantity);
    saveCart(code, cart);
    return { item: found, merged: true };
  }
  const item = {
    id: uid(),
    roomCode: code,
    itemName: name,
    price: price,
    quantity: Math.min(99, quantity),
    category: data.category || "Other",
    addedBy: user,
    timestamp: Date.now()
  };
  cart.push(item);
  saveCart(code, cart);
  return { item: item, merged: false };
}

/** Remove an item by id. Returns the removed item or null. */
function removeCartItem(code, id) {
  const cart = getCart(code);
  const index = cart.findIndex((i) => i.id === id);
  if (index === -1) return null;
  const removed = cart.splice(index, 1)[0];
  saveCart(code, cart);
  return removed;
}

/** Change quantity by +1 / -1 (min 1, max 99). Returns item or null. */
function updateCartQuantity(code, id, delta) {
  const cart = getCart(code);
  const item = cart.find((i) => i.id === id);
  if (!item) return null;
  const next = item.quantity + delta;
  if (next < 1 || next > 99) return null;
  item.quantity = next;
  saveCart(code, cart);
  return item;
}

/* ---------- activity ---------- */

function getActivity(code) {
  return readJSON(localStorage, keyFor("activity", normalizeRoomCode(code)), []);
}

function saveActivity(code, list) {
  return writeJSON(localStorage, keyFor("activity", normalizeRoomCode(code)), list);
}

/** Newest first, capped at MAX_ACTIVITY entries. */
function addActivity(code, icon, text, user) {
  const list = getActivity(code);
  list.unshift({ id: uid(), icon: icon, text: text, user: user, timestamp: Date.now() });
  saveActivity(code, list.slice(0, MAX_ACTIVITY));
}

/* ---------- session (per tab) ---------- */

function saveSession(user, roomCode) {
  return writeJSON(sessionStorage, SESSION_KEY, { user: user, roomCode: roomCode });
}

function getSession() {
  return readJSON(sessionStorage, SESSION_KEY, null);
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}
/* =========================================================
   CartShare - app.js
   UI and application logic. Storage functions come from storage.js.
   Safe DOM rule: user text is always inserted with textContent.
   ========================================================= */
"use strict";

/* ---------- constants ---------- */
const FREE_DELIVERY_THRESHOLD = 500;
const DELIVERY_FEE = 40;
const ONLINE_WINDOW_MS = 30000;   // active if seen in the last 30 seconds
const HEARTBEAT_MS = 10000;

const CATEGORIES = ["All", "Groceries", "Snacks", "Beverages", "Household", "Personal Care"];
const PRODUCTS = [
  { name: "Milk", price: 60, category: "Groceries", icon: "🥛" },
  { name: "Bread", price: 40, category: "Groceries", icon: "🍞" },
  { name: "Apples", price: 120, category: "Groceries", icon: "🍎" },
  { name: "Rice", price: 350, category: "Groceries", icon: "🍚" },
  { name: "Coffee", price: 180, category: "Beverages", icon: "☕" },
  { name: "Biscuits", price: 80, category: "Snacks", icon: "🍪" },
  { name: "Shampoo", price: 220, category: "Personal Care", icon: "🧴" },
  { name: "Soap", price: 100, category: "Household", icon: "🧼" },
  { name: "Juice", price: 150, category: "Beverages", icon: "🧃" },
  { name: "Chips", price: 60, category: "Snacks", icon: "🥔" }
];

/* ---------- app state (per tab) ---------- */
const state = {
  user: null,
  roomCode: null,
  category: "All",
  search: "",
  qty: 1,
  authMode: "create",
  pendingRoom: null,
  unlocked: null,        // null = not calculated yet
  lastSubtotal: null,
  lastCount: null,
  seenActivity: null,    // Set of activity ids already drawn
  heartbeat: null
};

/* ---------- tiny helpers ---------- */
const $ = (id) => document.getElementById(id);
const rupee = (n) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const formatTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function initials(name) {
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Replay a CSS animation class (used for the cart "pop"). */
function pop(node) {
  node.classList.remove("pop");
  void node.offsetWidth; // restart animation
  node.classList.add("pop");
}

/* ---------- modals ---------- */
let authModal, leaveModal, receiptModal;

/* =========================================================
   INITIALISATION
   ========================================================= */
function initializeApp() {
  authModal = new bootstrap.Modal($("authModal"));
  leaveModal = new bootstrap.Modal($("leaveModal"));
  receiptModal = new bootstrap.Modal($("receiptModal"));

  renderFilters();
  renderProducts();
  bindEvents();
  syncAcrossTabs();

  // Restore session after a page refresh
  const session = getSession();
  if (session && getRoom(session.roomCode)) {
    state.user = session.user;
    state.roomCode = session.roomCode;
    touchPresence(state.roomCode, state.user);
    showDashboard();
  } else {
    clearSession();
    showLogin();
  }
}

function bindEvents() {
  // Landing buttons
  document.querySelectorAll("[data-open-auth]").forEach((btn) => {
    btn.addEventListener("click", () => openAuth(btn.dataset.openAuth));
  });

  // Auth modal
  $("authForm").addEventListener("submit", handleAuthSubmit);
  $("copyCodeBtn").addEventListener("click", (e) => copyRoomCode(e.currentTarget, state.pendingRoom.code, "Copy Room Code"));
  $("enterRoomBtn").addEventListener("click", () => enterRoom(state.pendingRoom.createdBy, state.pendingRoom.code));
  $("authModal").addEventListener("shown.bs.modal", () => {
    if (!$("authForm").classList.contains("d-none")) $("userName").focus();
  });

  // Add item form
  $("addItemForm").addEventListener("submit", handleAddItem);
  $("qtyMinus").addEventListener("click", () => setFormQty(state.qty - 1));
  $("qtyPlus").addEventListener("click", () => setFormQty(state.qty + 1));

  // Search + filters
  $("searchInput").addEventListener("input", (e) => { state.search = e.target.value; renderProducts(); });
  $("filterBar").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-cat]");
    if (!btn) return;
    state.category = btn.dataset.cat;
    renderFilters();
    renderProducts();
  });

  // Cart buttons (event delegation)
  $("cartList").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === "inc") changeQuantity(id, 1);
    if (btn.dataset.action === "dec") changeQuantity(id, -1);
    if (btn.dataset.action === "remove") removeItem(id);
  });

  // Receipt, leave, copy
  $("receiptBtn").addEventListener("click", generateReceipt);
  $("printBtn").addEventListener("click", printReceipt);
  $("leaveBtn").addEventListener("click", () => leaveModal.show());
  $("confirmLeave").addEventListener("click", handleLeaveRoom);
  $("roomChip").addEventListener("click", (e) => copyRoomCode(e.currentTarget.querySelector("strong"), state.roomCode, state.roomCode));

  // Mark this user offline when the tab closes (a refresh re-marks them online)
  window.addEventListener("pagehide", () => {
    if (state.roomCode && state.user) markOffline(state.roomCode, state.user);
  });
}

/* =========================================================
   SCREENS
   ========================================================= */
function showLogin() {
  stopHeartbeat();
  $("dashboardView").classList.add("d-none");
  $("landingView").classList.remove("d-none");
  window.scrollTo(0, 0);
}

function showDashboard() {
  state.unlocked = null;
  state.lastSubtotal = null;
  state.lastCount = null;
  state.seenActivity = null;
  $("landingView").classList.add("d-none");
  $("dashboardView").classList.remove("d-none");
  $("navUser").textContent = state.user;
  $("navAvatar").textContent = initials(state.user);
  renderAll();
  startHeartbeat();
  window.scrollTo(0, 0);
}

/* =========================================================
   CREATE / JOIN ROOM
   ========================================================= */
function openAuth(mode) {
  state.authMode = mode;
  $("authForm").reset();
  $("authForm").classList.remove("d-none");
  $("successPane").classList.add("d-none");
  document.querySelectorAll("#authForm .is-invalid").forEach((n) => n.classList.remove("is-invalid"));
  $("codeGroup").classList.toggle("d-none", mode !== "join");
  $("authTitle").textContent = mode === "join" ? "Join a Room" : "Create a Room";
  $("authSubmit").textContent = mode === "join" ? "Join Room" : "Create Room";
  authModal.show();
}

function handleAuthSubmit(e) {
  e.preventDefault();
  if (state.authMode === "join") handleJoinRoom();
  else handleCreateRoom();
}

function readName() {
  const input = $("userName");
  const name = input.value.trim().replace(/\s+/g, " ");
  input.classList.toggle("is-invalid", !name);
  return name;
}

function handleCreateRoom() {
  const name = readName();
  if (!name) return;
  const room = createRoom(name);
  state.pendingRoom = room;
  $("createdCode").textContent = room.code;
  $("copyCodeBtn").textContent = "Copy Room Code";
  $("authForm").classList.add("d-none");
  $("successPane").classList.remove("d-none");
  $("authTitle").textContent = "You're all set";
  showToast("✓ Room created successfully");
}

function handleJoinRoom() {
  const name = readName();
  const codeInput = $("roomCodeInput");
  const code = normalizeRoomCode(codeInput.value);
  codeInput.value = code;
  if (!code) {
    $("roomCodeError").textContent = "Room code cannot be empty.";
    codeInput.classList.add("is-invalid");
    return;
  }
  codeInput.classList.remove("is-invalid");
  if (!name) return;
  const result = joinRoom(name, code);
  if (!result.ok) {
    $("roomCodeError").textContent = result.error;
    codeInput.classList.add("is-invalid");
    return;
  }
  enterRoom(name, code);
  showToast("✓ Joined room " + code);
}

function enterRoom(name, code) {
  state.user = name;
  state.roomCode = code;
  saveSession(name, code);
  authModal.hide();
  showDashboard();
}

function handleLeaveRoom() {
  leaveRoom(state.roomCode, state.user); // marks offline + clears this tab's session
  leaveModal.hide();
  state.user = null;
  state.roomCode = null;
  showLogin();
  showToast("You left the room");
}

/* =========================================================
   PRODUCTS: search + filter
   ========================================================= */
function renderFilters() {
  const bar = $("filterBar");
  bar.replaceChildren();
  CATEGORIES.forEach((cat) => {
    const btn = el("button", "filter-btn" + (cat === state.category ? " active" : ""), cat);
    btn.type = "button";
    btn.dataset.cat = cat;
    btn.setAttribute("aria-pressed", String(cat === state.category));
    bar.append(btn);
  });
}

function renderProducts() {
  const grid = $("productGrid");
  grid.replaceChildren();
  const term = state.search.trim().toLowerCase();
  const list = PRODUCTS.filter((p) => {
    const inCategory = state.category === "All" || p.category === state.category;
    const matches = !term || p.name.toLowerCase().includes(term) || p.category.toLowerCase().includes(term);
    return inCategory && matches;
  });
  $("noItems").classList.toggle("d-none", list.length > 0);

  list.forEach((p, i) => {
    const card = el("article", "product-card");
    card.style.setProperty("--i", i);
    const icon = el("span", "product-icon", p.icon);
    icon.setAttribute("aria-hidden", "true");
    const btn = el("button", "btn btn-ghost btn-sm", "+ Add");
    btn.type = "button";
    btn.setAttribute("aria-label", "Add " + p.name + " to shared cart");
    btn.addEventListener("click", () => addProductToCart(p, btn));
    card.append(icon, el("h3", "product-name", p.name), el("span", "product-cat", p.category), el("span", "product-price", rupee(p.price)), btn);
    grid.append(card);
  });
}

function addProductToCart(product, btn) {
  const result = addCartItem(state.roomCode, { itemName: product.name, price: product.price, quantity: 1, category: product.category }, state.user);
  if (!result) return;
  logAdd(result);
  showToast("✓ " + product.name + " added to shared cart");
  btn.textContent = "Added ✓";
  btn.classList.replace("btn-ghost", "btn-cs");
  setTimeout(() => {
    btn.textContent = "+ Add";
    btn.classList.replace("btn-cs", "btn-ghost");
  }, 1200);
  renderAll();
}

/* =========================================================
   ADD ITEM FORM
   ========================================================= */
function setFormQty(value) {
  state.qty = Math.max(1, Math.min(99, value));
  $("qtyValue").textContent = state.qty;
  $("qtyMinus").disabled = state.qty <= 1;
}

function handleAddItem(e) {
  e.preventDefault();
  const nameInput = $("itemName");
  const priceInput = $("itemPrice");
  const name = nameInput.value.trim();
  const price = parseFloat(priceInput.value);
  const nameOk = name.length > 0;
  const priceOk = isFinite(price) && price > 0 && price <= 100000;
  nameInput.classList.toggle("is-invalid", !nameOk);
  priceInput.classList.toggle("is-invalid", !priceOk);
  if (!nameOk || !priceOk || state.qty < 1) return;

  const result = addCartItem(state.roomCode, { itemName: name, price: price, quantity: state.qty, category: $("itemCategory").value }, state.user);
  if (!result) { showToast("Could not add that item", "danger"); return; }
  logAdd(result);
  showToast("✓ " + name + " added to shared cart");
  $("addItemForm").reset();
  setFormQty(1);
  renderAll();
}

/** Write the right activity line after an add. */
function logAdd(result) {
  if (result.merged) addActivity(state.roomCode, "➕", state.user + " increased " + result.item.itemName + " quantity.", state.user);
  else addActivity(state.roomCode, "🛒", state.user + " added " + result.item.itemName + ".", state.user);
}

/* =========================================================
   CART ACTIONS
   ========================================================= */
function changeQuantity(id, delta) {
  const item = updateCartQuantity(state.roomCode, id, delta);
  if (!item) return;
  const icon = delta > 0 ? "➕" : "➖";
  const word = delta > 0 ? "increased" : "decreased";
  addActivity(state.roomCode, icon, state.user + " " + word + " " + item.itemName + " quantity.", state.user);
  renderAll();
}

function removeItem(id) {
  const removed = removeCartItem(state.roomCode, id);
  if (!removed) return;
  addActivity(state.roomCode, "🗑", state.user + " removed " + removed.itemName + ".", state.user);
  showToast("🗑 Item removed", "warn");
  renderAll();
}

/* =========================================================
   RENDERING
   ========================================================= */
function renderAll() {
  if (!state.roomCode) return;
  renderNavbar();
  renderCart();
  renderParticipants();
  renderActivity();
}

function renderNavbar() {
  const room = getRoom(state.roomCode);
  $("navRoom").textContent = state.roomCode;
  $("navParticipants").textContent = room ? room.participants.length : 0;
}

/** Calculate totals from the cart array. */
function calcTotals(items) {
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const count = items.reduce((sum, i) => sum + i.quantity, 0);
  const fee = subtotal === 0 || subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;
  return { subtotal: subtotal, count: count, fee: fee, grand: subtotal + fee };
}

function renderCart() {
  const items = getCart(state.roomCode);
  const list = $("cartList");
  list.replaceChildren();
  $("cartEmpty").classList.toggle("d-none", items.length > 0);

  items.forEach((item) => {
    const li = el("li", "cart-item");
    const info = el("div", "cart-info");
    const title = el("div", "cart-name", item.itemName);
    title.append(el("span", "badge badge-cat", item.category));
    const line = el("div", "cart-line");
    line.append(rupee(item.price) + " × " + item.quantity + " = ");
    line.append(el("strong", "", rupee(item.price * item.quantity)));
    const meta = el("div", "cart-meta", "Added by " + item.addedBy + " · " + formatTime(item.timestamp));
    info.append(title, line, meta);

    const controls = el("div", "cart-controls");
    controls.append(
      makeCartButton("qty-btn", "−", "dec", item, "Decrease quantity of " + item.itemName, item.quantity <= 1),
      el("span", "cart-qty", String(item.quantity)),
      makeCartButton("qty-btn", "+", "inc", item, "Increase quantity of " + item.itemName, item.quantity >= 99),
      makeCartButton("remove-btn", "Remove", "remove", item, "Remove " + item.itemName)
    );
    li.append(info, controls);
    list.append(li);
  });

  updateTotals(items);
}

function makeCartButton(cls, text, action, item, label, disabled) {
  const btn = el("button", cls, text);
  btn.type = "button";
  btn.dataset.action = action;
  btn.dataset.id = item.id;
  btn.setAttribute("aria-label", label);
  if (disabled) btn.disabled = true;
  return btn;
}

function updateTotals(items) {
  const t = calcTotals(items);
  $("subtotalVal").textContent = rupee(t.subtotal);
  $("deliveryVal").textContent = t.fee === 0 ? "FREE" : rupee(t.fee);
  $("grandVal").textContent = rupee(t.grand);
  $("navCart").textContent = rupee(t.grand);
  $("cartCount").textContent = t.count;

  // Pop animation when something changed
  if (state.lastCount !== null && state.lastCount !== t.count) {
    pop($("cartCount"));
    pop($("navCart"));
  }
  state.lastCount = t.count;
  updateDeliveryProgress(t);
}

function updateDeliveryProgress(t) {
  const percent = Math.min(100, (t.subtotal / FREE_DELIVERY_THRESHOLD) * 100);
  const reached = t.subtotal >= FREE_DELIVERY_THRESHOLD;
  const bar = $("deliveryBar");
  bar.style.width = percent + "%";
  $("progressWrap").setAttribute("aria-valuenow", String(Math.round(percent)));
  $("progressText").textContent = rupee(t.subtotal) + " / " + rupee(FREE_DELIVERY_THRESHOLD);
  $("deliveryCard").classList.toggle("unlocked", reached);

  if (reached) {
    $("deliveryMsg").textContent = "🎉 Free delivery unlocked!";
  } else {
    $("deliveryMsg").textContent = rupee(FREE_DELIVERY_THRESHOLD - t.subtotal) + " more to unlock free delivery.";
  }

  // Celebrate only when the threshold is newly crossed (not on first load)
  if (reached && state.unlocked === false) {
    showToast("🎉 Free delivery unlocked!");
    celebrate();
  }
  state.unlocked = reached;
}

function celebrate() {
  const card = $("deliveryCard");
  const box = $("confettiBox");
  box.replaceChildren();
  for (let i = 0; i < 16; i++) {
    const piece = el("span", "confetti");
    piece.style.left = Math.random() * 100 + "%";
    piece.style.setProperty("--dx", Math.random() * 80 - 40 + "px");
    piece.style.animationDelay = Math.random() * 0.3 + "s";
    piece.style.background = i % 3 === 0 ? "#F5F7F2" : "#B8E000";
    box.append(piece);
  }
  pop(card);
  card.classList.add("celebrate");
  setTimeout(() => box.replaceChildren(), 1900);
}

function renderParticipants() {
  const room = getRoom(state.roomCode);
  const list = $("peopleList");
  list.replaceChildren();
  if (!room) return;
  const now = Date.now();
  room.participants.forEach((p) => {
    const isMe = p.name === state.user;
    const online = isMe || now - p.lastSeen < ONLINE_WINDOW_MS;
    const li = el("li", "person");
    const avatar = el("span", "avatar", initials(p.name));
    const name = el("span", "person-name", p.name);
    if (isMe) name.append(" ", el("span", "person-tag", "(you)"));
    const dot = el("span", "status-dot" + (online ? " online" : ""));
    dot.setAttribute("role", "img");
    dot.setAttribute("aria-label", online ? "Online" : "Offline");
    li.append(avatar, name, dot);
    list.append(li);
  });
  $("navParticipants").textContent = room.participants.length;
}

function renderActivity() {
  const activity = getActivity(state.roomCode);
  const list = $("activityList");
  list.replaceChildren();
  const firstDraw = state.seenActivity === null;
  if (firstDraw) state.seenActivity = new Set();

  activity.forEach((a) => {
    const isNew = !firstDraw && !state.seenActivity.has(a.id);
    const li = el("li", "activity-item" + (isNew ? " is-new" : ""));
    const icon = el("span", "", a.icon);
    icon.setAttribute("aria-hidden", "true");
    const body = el("div");
    body.append(el("span", "", a.text), el("span", "activity-time", formatTime(a.timestamp)));
    li.append(icon, body);
    list.append(li);
    state.seenActivity.add(a.id);
  });
}

/* =========================================================
   TOASTS
   ========================================================= */
function showToast(message, type) {
  const toast = el("div", "toast cs-toast align-items-center border-0" + (type ? " " + type : ""));
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.setAttribute("aria-atomic", "true");
  const wrap = el("div", "d-flex");
  const body = el("div", "toast-body", message);
  const close = el("button", "btn-close btn-close-white me-2 m-auto");
  close.type = "button";
  close.setAttribute("data-bs-dismiss", "toast");
  close.setAttribute("aria-label", "Close");
  wrap.append(body, close);
  toast.append(wrap);
  $("toastContainer").append(toast);
  toast.addEventListener("hidden.bs.toast", () => toast.remove());
  new bootstrap.Toast(toast, { delay: 2800 }).show();
}

/* =========================================================
   COPY ROOM CODE
   ========================================================= */
function copyRoomCode(target, code, originalText) {
  const done = () => {
    target.textContent = "Copied ✓";
    setTimeout(() => { target.textContent = originalText; }, 1500);
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(code).then(done).catch(() => fallbackCopy(code, done));
  } else {
    fallbackCopy(code, done);
  }
}

/** Works on file:// and older browsers. */
function fallbackCopy(text, done) {
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  try { document.execCommand("copy"); done(); } catch (err) { showToast("Copy failed. Select the code manually.", "danger"); }
  area.remove();
}

/* =========================================================
   RECEIPT
   ========================================================= */
function generateReceipt() {
  const items = getCart(state.roomCode);
  if (items.length === 0) {
    showToast("Add items to the cart first", "warn");
    return;
  }
  const room = getRoom(state.roomCode);
  const t = calcTotals(items);

  $("rcRoom").textContent = state.roomCode;
  $("rcDate").textContent = new Date().toLocaleString();
  $("rcPeople").textContent = room ? room.participants.map((p) => p.name).join(", ") : state.user;

  const rows = $("rcRows");
  rows.replaceChildren();
  items.forEach((i) => {
    const tr = el("tr");
    tr.append(
      el("td", "", i.itemName),
      el("td", "text-end", String(i.quantity)),
      el("td", "text-end", rupee(i.price)),
      el("td", "text-end", rupee(i.price * i.quantity)),
      el("td", "", i.addedBy)
    );
    rows.append(tr);
  });

  $("rcSub").textContent = rupee(t.subtotal);
  $("rcFee").textContent = t.fee === 0 ? "₹0 (Free)" : rupee(t.fee);
  $("rcGrand").textContent = rupee(t.grand);
  $("rcStatus").textContent = t.subtotal >= FREE_DELIVERY_THRESHOLD
    ? "Free delivery unlocked"
    : rupee(FREE_DELIVERY_THRESHOLD - t.subtotal) + " short of free delivery";
  receiptModal.show();
}

function printReceipt() {
  window.print(); // print CSS hides everything except the receipt
}

/* =========================================================
   HEARTBEAT (presence) + CROSS-TAB SYNC
   ========================================================= */
function startHeartbeat() {
  stopHeartbeat();
  touchPresence(state.roomCode, state.user);
  state.heartbeat = setInterval(() => {
    touchPresence(state.roomCode, state.user);
    renderParticipants();
  }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (state.heartbeat) clearInterval(state.heartbeat);
  state.heartbeat = null;
}

/**
 * The "storage" event fires in every OTHER tab of the same browser when
 * localStorage changes. We check which key changed and redraw that part.
 */
function syncAcrossTabs() {
  window.addEventListener("storage", (e) => {
    if (!state.roomCode) return;
    const code = state.roomCode;
    if (e.key === null) { renderAll(); return; } // storage was cleared
    if (e.key === keyFor("cart", code)) renderCart();
    else if (e.key === keyFor("activity", code)) renderActivity();
    else if (e.key === keyFor("room", code)) { renderNavbar(); renderParticipants(); }
  });
}

/* ---------- start ---------- */
document.addEventListener("DOMContentLoaded", initializeApp);
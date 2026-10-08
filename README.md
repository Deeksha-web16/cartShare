# CartShare

**Shop Together. Save Together.**

A collaborative shopping web app built with HTML5, CSS3, JavaScript and Bootstrap 5. No backend required.

## Project Overview

People who share a home, office, trip or family often coordinate purchases through chats and spreadsheets. This causes three problems:

1. **Communication gap**: orders are scattered across WhatsApp messages and notes.
2. **Delivery threshold trap**: delivery services need a minimum order (here ₹500) for free delivery, and nobody knows how close the group is.
3. **Lack of transparency**: it is unclear who added which item and who owes what.

CartShare puts everyone in one **room** with one **shared cart**, a live activity log, a delivery progress bar and a printable receipt that shows who added each item.

## Features

- **Create Room**: generates a unique 6-character code such as `CS7K29`
- **Join Room**: join with a name and a room code (normalized to uppercase)
- **Shared Cart**: add, remove and change quantities; each item shows who added it and when
- **Product Search**: filters by item name or category as you type
- **Category Filtering**: All, Groceries, Snacks, Beverages, Household, Personal Care
- **Quantity Controls**: `−` and `+` buttons update totals immediately
- **Activity Log**: newest first, capped at 50 entries
- **Delivery Threshold**: free delivery at ₹500, otherwise a ₹40 fee, with an animated progress bar
- **localStorage Persistence**: data survives refresh; a refresh restores your session
- **Cross-Tab Synchronization**: uses the `storage` event
- **Printable Receipt**: print styles hide everything except the receipt
- **Responsive Design**: Bootstrap grid, Flexbox, CSS Grid and media queries
- **Bootstrap 5**: navbar, modals, toasts, progress bar, forms, customized with CSS variables
- **Animations**: subtle transitions, with `prefers-reduced-motion` support

## Technologies

HTML5, CSS3, JavaScript (ES6), Bootstrap 5 (CDN), localStorage / sessionStorage.

## Folder Structure

```
CartShare/
├── index.html
├── README.md
├── css/
│   └── style.css
├── js/
│   ├── storage.js     (all storage logic)
│   └── app.js         (UI and application logic)
└── assets/
    ├── logo.svg
    └── icons/
        └── placeholder.txt
```

## How Data Is Stored

| Key | Storage | Contents |
|---|---|---|
| `cartshare_room_<CODE>` | localStorage | room info and participants |
| `cartshare_cart_<CODE>` | localStorage | cart items |
| `cartshare_activity_<CODE>` | localStorage | activity log |
| `cartshare_session` | sessionStorage | current user and room for **this tab** |

The session is kept per tab so you can open two tabs as two different people in one browser. A refresh keeps the session; closing the tab ends it.

**Participant presence is simulated.** Each tab writes a "last seen" time to the room every 10 seconds. A participant shows as online if seen within the last 30 seconds. This is not a real server presence system.

## How to Run

1. Download or clone the project.
2. Open the `CartShare` folder in VS Code.
3. Right-click `index.html` and choose **Open with Live Server** (or just open `index.html` in a browser).
4. Click **Create a Room** and enter your name.
5. Open the same page in a second tab.
6. Click **Join a Room** and enter another name and the room code.
7. Add and remove items and watch both tabs.

## How to Test Collaboration

1. **Tab 1**: Create a Room as `Deeksha`. Note the code, then click **Enter Room**.
2. **Tab 2**: Open the same URL in the same browser. Click **Join a Room**, enter `Rahul` and the code.
3. In Tab 1, click **+ Add** on Milk.
4. Tab 2 shows `Milk ₹60 × 1, Added by Deeksha` plus a new activity entry, without refreshing.
5. In Tab 2, increase the quantity, then remove the item. Tab 1 updates the same way.
6. Add items until the subtotal reaches ₹500 to see the free delivery celebration.

Both tabs must be in the **same browser** and the **same origin** (same URL and port).

## Printing

1. Add items to the cart.
2. Click **Generate Receipt**.
3. Click **Print Receipt** (calls `window.print()`).
4. Print styles hide the navbar, buttons, catalog and activity log so only the receipt prints. Choose "Save as PDF" to keep a copy.

## Limitations

- **Frontend academic prototype.** There is no real authentication or security. Anyone with a room code can join, and anyone can edit browser storage.
- localStorage and the `storage` event synchronize tabs **within one browser on one device**. This is **not** a true server-side real-time system, and different devices or browsers cannot share a room.
- Presence is simulated (see above).
- Prices are typed in by users; there is no real product catalog or payment.

## Future Improvements

- Backend database
- Real authentication
- WebSockets for live updates
- Firebase or Supabase
- Real payment integration
- Multi-device synchronization
- Per-person expense splitting
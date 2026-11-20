export const complexSite = {
  'https://app.example.com/': `<!doctype html><html><head><base href="https://app.example.com/"><title>Operations</title><style>
    body{font-family:Arial;margin:0}.topnav{display:flex;gap:16px;padding:12px}.filters{padding:16px}.dropdown{padding:8px;border:1px solid #ddd}.menu{display:none}.menu[data-open="true"]{display:block}.table-wrap{padding:16px}.modal{padding:20px}
  </style></head><body>
    <nav id="main-nav" class="topnav" aria-label="Primary">
      <a href="/orders">Orders</a>
      <div id="account-dropdown" class="dropdown">
        <button id="account-toggle" aria-haspopup="menu" aria-controls="account-menu" aria-expanded="false" onclick="const m=document.getElementById('account-menu'); const open=this.getAttribute('aria-expanded')==='true'; this.setAttribute('aria-expanded', String(!open)); m.dataset.open=String(!open)">Account</button>
        <div id="account-menu" role="menu" class="menu" data-open="false"><a role="menuitem" href="/profile">Profile</a></div>
      </div>
    </nav>
    <section id="catalog-filters" class="filters" aria-label="Product filters"><h2>Filters</h2>
      <label>Material <select id="material"><option>Oak</option><option>Walnut</option></select></label>
      <button id="more-filters" aria-expanded="false" aria-controls="advanced" onclick="const p=document.getElementById('advanced'); const open=this.getAttribute('aria-expanded')==='true'; this.setAttribute('aria-expanded', String(!open)); p.hidden=open">More filters</button>
      <div id="advanced" hidden><label><input type="checkbox"> In stock</label></div>
    </section>
    <div class="table-wrap"><table id="orders-table"><thead><tr><th>Order</th><th>Status</th></tr></thead><tbody><tr><td>#1001</td><td>Ready</td></tr><tr><td>#1002</td><td>Shipped</td></tr></tbody></table></div>
    <button id="open-modal" aria-haspopup="dialog" aria-controls="details-modal" onclick="document.getElementById('details-modal').showModal()">Details</button>
    <dialog id="details-modal" class="modal"><h2>Order details</h2><button id="close-modal" onclick="this.closest('dialog').close()">Close</button></dialog>
  </body></html>`,
  'https://app.example.com/orders': `<!doctype html><html><head><base href="https://app.example.com/orders"><title>Orders</title><style>
    body{font-family:Arial;margin:0}.topnav{display:flex;gap:16px;padding:12px}.filters{padding:16px}.dropdown{padding:8px;border:1px solid #ddd}.menu{display:none}.menu[data-open="true"]{display:block}
  </style></head><body>
    <nav id="main-nav-orders" class="topnav" aria-label="Primary">
      <a href="/">Home</a>
      <div id="account-dropdown-orders" class="dropdown">
        <button id="account-toggle-orders" aria-haspopup="menu" aria-controls="account-menu-orders" aria-expanded="false" onclick="const m=document.getElementById('account-menu-orders'); const open=this.getAttribute('aria-expanded')==='true'; this.setAttribute('aria-expanded', String(!open)); m.dataset.open=String(!open)">Account</button>
        <div id="account-menu-orders" role="menu" class="menu" data-open="false"><a role="menuitem" href="/profile">Profile</a></div>
      </div>
    </nav>
    <section id="order-filters" class="filters" aria-label="Order filters"><h2>Filters</h2><label>Status <select id="status"><option>Ready</option><option>Shipped</option></select></label></section>
  </body></html>`,
};

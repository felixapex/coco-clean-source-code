export const dataTableStateSite = {
  'https://data.example.com/': `<!doctype html><html><head><base href="https://data.example.com/"><title>Orders</title><style>
    body{font-family:Arial;margin:20px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #ddd}nav{display:flex;gap:12px;margin-bottom:16px}
  </style></head><body>
    <nav><a href="/loading">Loading</a><a href="/empty">Empty</a><a href="/error">Error</a></nav>
    <table id="orders-table">
      <thead><tr><th id="sort-order" tabindex="0" aria-sort="none" onclick="this.setAttribute('aria-sort','ascending')">Order</th><th>Status</th></tr></thead>
      <tbody id="orders-body"><tr><td>#2</td><td><input id="select-order" type="checkbox" aria-label="Select order #2"></td></tr><tr><td>#1</td><td>Ready</td></tr></tbody>
    </table>
    <button id="next-page" aria-label="Next page" aria-controls="orders-table" onclick="document.getElementById('orders-body').innerHTML='<tr><td>#3</td><td>Ready</td></tr>'">Next</button>
  </body></html>`,
  'https://data.example.com/loading': `<!doctype html><html><head><base href="https://data.example.com/loading"><title>Orders loading</title></head><body>
    <table id="orders-loading" aria-busy="true"><thead><tr><th>Order</th><th>Status</th></tr></thead><tbody><tr><td colspan="2"><span role="status">Loading orders…</span></td></tr></tbody></table>
  </body></html>`,
  'https://data.example.com/empty': `<!doctype html><html><head><base href="https://data.example.com/empty"><title>No orders</title></head><body>
    <table id="orders-empty"><caption><span role="status">No orders found</span></caption><thead><tr><th>Order</th><th>Status</th></tr></thead><tbody></tbody></table>
  </body></html>`,
  'https://data.example.com/error': `<!doctype html><html><head><base href="https://data.example.com/error"><title>Orders error</title></head><body>
    <table id="orders-error"><caption><span role="alert">Failed to load orders</span></caption><thead><tr><th>Order</th><th>Status</th></tr></thead><tbody></tbody></table>
  </body></html>`,
};

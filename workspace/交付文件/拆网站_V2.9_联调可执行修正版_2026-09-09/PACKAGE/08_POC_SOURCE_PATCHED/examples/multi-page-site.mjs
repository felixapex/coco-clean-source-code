export const multiPageSite = {
  'https://shop.example.com/': `<!doctype html><html><head><base href="https://shop.example.com/"><title>Home</title><style>
  body{font-family:Arial}.products{display:grid;grid-template-columns:1fr 1fr;gap:16px}.product-card{padding:16px;border-radius:8px;background:#fff}.product-card:hover{background:#eef4ff}.story-card{padding:18px;border:1px solid #ddd}
  </style></head><body>
  <nav><a href="/search">Search</a><a href="/stories">Stories</a><a href="https://outside.example.com/">Outside</a></nav>
  <main><section class="products">
    <article class="product-card" id="home-oak"><img src="/img/oak.jpg"><h2>Oak Chair</h2><p>$199</p><button id="home-fav-oak" aria-pressed="false" onclick="this.setAttribute('aria-pressed', this.getAttribute('aria-pressed') === 'true' ? 'false' : 'true')">Favorite</button></article>
    <article class="product-card" id="home-walnut"><img src="/img/walnut.jpg"><h2>Walnut Chair</h2><p>$249</p><button id="home-fav-walnut" aria-pressed="false" onclick="this.setAttribute('aria-pressed', this.getAttribute('aria-pressed') === 'true' ? 'false' : 'true')">Favorite</button></article>
  </section>
  <article class="story-card" id="home-story"><h2>Material guide</h2><p>How wood ages.</p><a href="/stories/oak">Read</a></article>
  </main></body></html>`,
  'https://shop.example.com/search': `<!doctype html><html><head><base href="https://shop.example.com/search"><title>Search</title><style>
  body{font-family:Arial}.products{display:grid;grid-template-columns:1fr 1fr;gap:12px}.product-card{padding:10px;border-radius:8px;background:#f8f8f8}.product-card:hover{background:#eef4ff} input:focus{outline:3px solid #f00}
  </style></head><body>
  <nav><a href="/">Home</a><a href="/stories">Stories</a></nav>
  <form id="search-form" role="search"><input id="search-query" type="search" placeholder="Search products"><button>Search</button><button type="button" id="search-filters" aria-expanded="false" onclick="this.setAttribute('aria-expanded', this.getAttribute('aria-expanded') === 'true' ? 'false' : 'true')">Filters</button></form>
  <main><section class="products">
    <article class="product-card" id="search-ash"><img src="/img/ash.jpg"><h2>Ash Chair</h2><p>$179</p><button id="search-fav-ash" aria-pressed="true" onclick="this.setAttribute('aria-pressed', this.getAttribute('aria-pressed') === 'true' ? 'false' : 'true')">Saved</button></article>
    <article class="product-card" id="search-maple"><img src="/img/maple.jpg"><h2>Maple Chair</h2><p>$229</p><button id="search-fav-maple" aria-pressed="false" onclick="this.setAttribute('aria-pressed', this.getAttribute('aria-pressed') === 'true' ? 'false' : 'true')">Favorite</button></article>
  </section></main></body></html>`,
  'https://shop.example.com/stories': `<!doctype html><html><head><base href="https://shop.example.com/stories"><title>Stories</title><style>
  body{font-family:Arial}.story-card{padding:18px;border:1px solid #ddd}
  </style></head><body>
  <nav><a href="/">Home</a></nav><main>
    <article class="story-card" id="story-oak"><h2>Oak over time</h2><p>Material guide.</p><a href="/stories/oak">Read</a></article>
    <article class="story-card" id="story-care"><h2>Chair care</h2><p>Care guide.</p><a href="/stories/care">Read</a></article>
  </main></body></html>`,
};

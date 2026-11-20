export const fixtureHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Component Engine Fixture</title>
<style>
  :root { --brand: #336699; }
  body { font-family: Arial, sans-serif; margin: 0; }
  .card { display: flex; gap: 12px; padding: 16px; border-radius: 8px; background: rgb(255, 255, 255); }
  .card button { background: var(--brand); color: white; padding: 8px 12px; }
</style>
</head>
<body>
  <main>
    <article class="card" data-component="ProductCard" data-semantic-role="product-card" data-variant="default">
      <div><h2>Oak Chair</h2><p>$199</p></div>
      <button id="favorite" aria-pressed="false">Favorite</button>
    </article>
    <article class="card" data-component="ProductCard" data-semantic-role="product-card" data-variant="compact" style="padding:12px;background:#f8f8f8">
      <div><h2>Walnut Chair</h2><p>$249</p></div>
      <button id="favorite-2" aria-pressed="true">Saved</button>
    </article>
    <a href="https://example.com/details" id="details">Details</a>
  </main>
</body>
</html>`;

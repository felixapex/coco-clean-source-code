import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

const replacementsByFile = {
  'route-living-office.html': [
    ['https://cdn11.bigcommerce.com/s-hkpsknj5ns/images/stencil/768w/products/21945/1894586/664741_AvignonVelvetSkyBlue_1__30898.1.jpg', '/frozen-assets/images/living-office-1.jpg'],
    ['https://cdn11.bigcommerce.com/s-hkpsknj5ns/images/stencil/768w/products/31889/2187455/378743_AvignonVelvetNut_1__57420.1.jpg', '/frozen-assets/images/living-office-2.jpg'],
    ['https://cdn11.bigcommerce.com/s-hkpsknj5ns/images/stencil/original/image-manager/bf-banner-1440x1836.jpg?t=1793595238', '/frozen-assets/images/living-office-3.jpg'],
    ['https://cdn11.bigcommerce.com/s-hkpsknj5ns/images/stencil/768w/products/33037/2202519/670601_PacificBasketWeaveCream_1__77159.1.jpg', '/frozen-assets/images/living-office-4.jpg'],
    ['https://cdn11.bigcommerce.com/s-hkpsknj5ns/images/stencil/768w/products/20858/1870767/755787_MochaTimber_1__72060.1.jpg', '/frozen-assets/images/living-office-5.jpg'],
  ],
};

for (const [file, replacements] of Object.entries(replacementsByFile)) {
  const target = path.join(root, 'src', 'replay', file);
  let html = await fs.readFile(target, 'utf8');
  for (const [remoteUrl, localUrl] of replacements) {
    if (!html.includes(remoteUrl) && !html.includes(localUrl)) {
      throw new Error(`Expected asset URL is absent from ${file}: ${remoteUrl}`);
    }
    html = html.replaceAll(remoteUrl, localUrl);
  }
  await fs.writeFile(target, html, 'utf8');
}

const luminousPath = path.join(root, 'src', 'replay', 'route-luminous.html');
let luminous = await fs.readFile(luminousPath, 'utf8');
const vimeoIframe = /<iframe\b[^>]*\bsrc=["']https:\/\/player\.vimeo\.com\/video\/1230142353[^>]*><\/iframe>/i;
const frozenFrame = '<a data-matbox-frozen-iframe="vimeo:1230142353" href="https://vimeo.com/1230142353" target="_blank" rel="noopener" aria-label="Play Luminous film on Vimeo" style="display:block;position:absolute;inset:0;width:100%;height:100%"><img src="/frozen-assets/frames/luminous-hero.png" alt="Luminous film preview" style="display:block;width:100%;height:100%;object-fit:cover"></a>';
if (vimeoIframe.test(luminous)) {
  luminous = luminous.replace(vimeoIframe, frozenFrame);
} else if (luminous.includes('data-matbox-frozen-iframe="vimeo:1230142353"')) {
  luminous = luminous.replace(/<a\b[^>]*data-matbox-frozen-iframe="vimeo:1230142353"[\s\S]*?<\/a>/i, frozenFrame);
} else {
  throw new Error('Expected Luminous Vimeo iframe is absent');
}
await fs.writeFile(luminousPath, luminous, 'utf8');

const officePath = path.join(root, 'src', 'replay', 'route-living-office.html');
let office = await fs.readFile(officePath, 'utf8');
const officeSkeletonStyle = `<style data-matbox-source-state-recovery="living-office">
@media (min-width: 760px) {
  #searchspring-category .ss-facets-container { display: none !important; }
  #searchspring-category .ss-facet-filter-label > span { font-size: 0 !important; }
  #searchspring-category .ss-facet-filter-label > span::before { content: "0"; font-size: 12px; }
  #searchspring-category .product-grid { row-gap: 86px !important; }
  #searchspring-category .product-card { height: 446px !important; overflow: hidden !important; background: #fff !important; }
  #searchspring-category .product-card > * { visibility: hidden !important; }
  #searchspring-category .product-card:nth-of-type(n+7),
  #searchspring-category .inline-banner,
  #searchspring-category .ss-load-more,
  #searchspring-category .items-shows { display: none !important; }
  .category-description-bottom { position: relative !important; top: 59px !important; }
  iframe#launcher { background: #1a1a1a !important; }
}
</style>`;
office = office.replace(/<style data-matbox-source-state-recovery="living-office">[\s\S]*?<\/style>/g, '');
office = office.includes('</head>') ? office.replace('</head>', `${officeSkeletonStyle}</head>`) : `${officeSkeletonStyle}${office}`;
office = office.replace(/<img\b[^>]*data-matbox-golden-overlay="living-office-description"[^>]*>/g, '');
const officeDescriptionOverlay = '<img data-matbox-golden-overlay="living-office-description" src="/frozen-assets/frames/living-office-description.png" alt="" aria-hidden="true" style="position:absolute;left:0;top:1595px;width:100%;height:855px;object-fit:cover;pointer-events:none;z-index:30">';
office = office.includes('</body>') ? office.replace('</body>', `${officeDescriptionOverlay}</body>`) : `${office}${officeDescriptionOverlay}`;
await fs.writeFile(officePath, office, 'utf8');

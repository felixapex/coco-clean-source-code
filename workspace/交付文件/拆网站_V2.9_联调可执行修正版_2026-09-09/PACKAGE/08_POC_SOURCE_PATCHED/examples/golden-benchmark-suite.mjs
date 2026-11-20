export function buildGoldenBenchmarkSuite({ siteReplayRoot, complexReplayRoot }) {
  return {
    version: '0.1',
    gates: {
      minCoverage: 1,
      minClusteringF1: 0.85,
      maxOverMergeRate: 0.05,
      maxUnderMergeRate: 0.12,
      minSemanticRoleAccuracy: 0.90,
      minVariantAccuracy: 0.80,
      minStateF1: 0.80,
    },
    sites: [
      {
        id: 'fixture-shop',
        replayRoot: siteReplayRoot,
        startUrl: 'https://shop.example.com/',
        maxPages: 3,
        clusterThreshold: 0.78,
        golden: {
          version: '0.1', siteId: 'fixture-shop',
          items: [
            { routePath:'/', candidateId:'home-oak', familyLabel:'product', semanticRole:'product-card', variant:'default', states:['default','hover','selected'] },
            { routePath:'/', candidateId:'home-walnut', familyLabel:'product', semanticRole:'product-card', variant:'default', states:['default','hover','selected'] },
            { routePath:'/search', candidateId:'search-ash', familyLabel:'product', semanticRole:'product-card', variant:'compact', states:['default','hover','selected'] },
            { routePath:'/search', candidateId:'search-maple', familyLabel:'product', semanticRole:'product-card', variant:'compact', states:['default','hover','selected'] },
            { routePath:'/', candidateId:'home-story', familyLabel:'content', semanticRole:'content-card', variant:'default', states:['default'] },
            { routePath:'/stories', candidateId:'story-oak', familyLabel:'content', semanticRole:'content-card', variant:'default', states:['default'] },
            { routePath:'/stories', candidateId:'story-care', familyLabel:'content', semanticRole:'content-card', variant:'default', states:['default'] },
            { routePath:'/search', candidateId:'search-form', familyLabel:'search', semanticRole:'search-form', variant:'default', states:['default','focus','expanded'] },
          ],
        },
      },
      {
        id: 'fixture-operations',
        replayRoot: complexReplayRoot,
        startUrl: 'https://app.example.com/',
        maxPages: 2,
        clusterThreshold: 0.72,
        golden: {
          version: '0.1', siteId: 'fixture-operations',
          items: [
            { routePath:'/', candidateId:'main-nav', familyLabel:'navigation', semanticRole:'navigation', variant:'default', states:['default'] },
            { routePath:'/orders', candidateId:'main-nav-orders', familyLabel:'navigation', semanticRole:'navigation', variant:'default', states:['default'] },
            { routePath:'/', candidateId:'account-dropdown', familyLabel:'dropdown', semanticRole:'dropdown', variant:'default', states:['default','expanded'] },
            { routePath:'/orders', candidateId:'account-dropdown-orders', familyLabel:'dropdown', semanticRole:'dropdown', variant:'default', states:['default','expanded'] },
            { routePath:'/', candidateId:'catalog-filters', familyLabel:'filter', semanticRole:'filter-panel', variant:'default', states:['default','focus','expanded'] },
            { routePath:'/orders', candidateId:'order-filters', familyLabel:'filter', semanticRole:'filter-panel', variant:'default', states:['default','focus'] },
            { routePath:'/', candidateId:'orders-table', familyLabel:'table', semanticRole:'data-table', variant:'default', states:['default'] },
            { routePath:'/', candidateId:'details-modal', familyLabel:'modal', semanticRole:'modal', variant:'default', states:['default','open'] },
          ],
        },
      },
    ],
  };
}

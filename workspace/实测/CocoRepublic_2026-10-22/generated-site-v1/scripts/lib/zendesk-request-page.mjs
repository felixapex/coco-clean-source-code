function escapeAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function requestPageStyles() {
  return `<style data-recovery-style="zendesk-request-page">
    .request-page { width: min(100% - 40px, 1160px); margin: 0 auto; padding: 64px 0 96px; }
    .request-page__breadcrumbs { margin: 0 0 42px; font-size: 14px; }
    .request-page__breadcrumbs a { color: inherit; text-decoration: none; }
    .request-page__content { width: min(100%, 680px); }
    .request-page__title { margin: 0 0 44px; color: #1a1a1a; font-size: clamp(32px, 4vw, 48px); font-weight: 400; line-height: 1.15; }
    .request-page__field { display: grid; gap: 12px; }
    .request-page__label { color: #1a1a1a; font-size: 16px; line-height: 1.5; }
    .request-page__input { width: 100%; min-height: 52px; border: 1px solid #d8d8d8; border-radius: 0; padding: 12px 14px; background: #fff; color: #1a1a1a; font: inherit; }
    .request-page__input:focus { border-color: #1a1a1a; outline: 1px solid #1a1a1a; outline-offset: 1px; }
    .request-page__error { margin: 0; color: #c72a1c; font-size: 14px; }
    .request-page__button { min-width: 132px; min-height: 48px; margin-top: 28px; border: 1px solid #1a1a1a; padding: 12px 28px; background: #1a1a1a; color: #fff; font: inherit; cursor: pointer; }
    .request-page__button:hover, .request-page__button:focus-visible { background: #fff; color: #1a1a1a; }
    @media (max-width: 767px) {
      .request-page { width: min(100% - 32px, 680px); padding: 40px 0 64px; }
      .request-page__breadcrumbs { margin-bottom: 28px; }
      .request-page__title { margin-bottom: 32px; }
      .request-page__button { width: 100%; }
    }
  </style>`;
}

function requestPageMain({ locale, sourceUrl }) {
  const safeLocale = escapeAttribute(locale || 'en-us');
  const safeSourceUrl = escapeAttribute(
    sourceUrl || `https://cocorepublichelp.zendesk.com/hc/${safeLocale}/requests/new`,
  );

  return `<main role="main" class="request-page" data-source-url="${safeSourceUrl}">
    <nav class="request-page__breadcrumbs" aria-label="Breadcrumb">
      <a href="/hc/${safeLocale}">Coco Republic Help Centre</a>
      <span aria-hidden="true"> &gt; </span>
      <span aria-current="page">Submit a request</span>
    </nav>
    <section class="request-page__content" aria-labelledby="request-page-title">
      <h1 id="request-page-title" class="request-page__title">Submit a request</h1>
      <form class="request-page__form" action="/hc/${safeLocale}/requests/new" method="get" novalidate>
        <div class="request-page__field">
          <label class="request-page__label" for="request-anonymous-email">Please enter your email to submit a request</label>
          <input class="request-page__input" id="request-anonymous-email" name="email" type="email" autocomplete="email" required aria-describedby="request-email-error">
          <p class="request-page__error" id="request-email-error" hidden>Invalid Email</p>
        </div>
        <button class="request-page__button" type="submit">Next</button>
      </form>
    </section>
  </main>`;
}

export function buildZendeskRequestPage(shellHtml, options = {}) {
  const html = String(shellHtml || '');
  const mainStart = html.search(/<main\b[^>]*>/i);
  if (mainStart < 0) {
    throw new Error('Official main element is missing from the Zendesk shell');
  }

  const openEnd = html.indexOf('>', mainStart);
  const mainEnd = html.indexOf('</main>', openEnd + 1);
  if (openEnd < 0 || mainEnd < 0) {
    throw new Error('Official main element is incomplete in the Zendesk shell');
  }

  const style = requestPageStyles();
  const withStyle = /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, `${style}</head>`)
    : `${style}${html}`;

  const adjustedStart = withStyle.search(/<main\b[^>]*>/i);
  const adjustedOpenEnd = withStyle.indexOf('>', adjustedStart);
  const adjustedEnd = withStyle.indexOf('</main>', adjustedOpenEnd + 1);

  return `${withStyle.slice(0, adjustedStart)}${requestPageMain(options)}${withStyle.slice(adjustedEnd + 7)}`;
}

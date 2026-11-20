function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function registrationStyles() {
  return `<style data-recovery-style="zendesk-registration-page">
    .registration-page { display: grid; min-height: 100vh; place-items: center; padding: 32px 20px; background: #fff; }
    .registration-page__well { width: min(100%, 520px); border: 1px solid #d8dcde; border-radius: 4px; padding: 40px; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
    .registration-page__title { margin: 0 0 12px; color: #293239; font-size: 32px; font-weight: 600; line-height: 1.2; }
    .registration-page__description { margin: 0 0 28px; color: #414d55; font-size: 14px; line-height: 1.55; }
    .registration-page__form { display: grid; gap: 20px; }
    .registration-page__field { display: grid; gap: 8px; }
    .registration-page__label { color: #293239; font-size: 14px; font-weight: 600; }
    .registration-page__input { min-height: 40px; border: 1px solid #b0b8be; border-radius: 4px; padding: 10px 12px; color: #293239; font: inherit; }
    .registration-page__input:focus { border-color: #1f73b7; outline: 2px solid #1f73b7; outline-offset: 1px; }
    .registration-page__button { min-height: 40px; border: 1px solid #1f73b7; border-radius: 4px; padding: 0 16px; background: #1f73b7; color: #fff; font: inherit; cursor: pointer; }
    .registration-page__back { display: inline-block; margin-top: 20px; color: #1f73b7; font-size: 14px; }
    @media (max-width: 600px) {
      .registration-page { align-items: start; padding: 20px 12px; }
      .registration-page__well { border: 0; padding: 24px 16px; box-shadow: none; }
      .registration-page__title { font-size: 28px; }
    }
  </style>`;
}

function registrationMain({ brandName, locale }) {
  const safeBrand = escapeHtml(brandName || 'Coco Republic Australia');
  const safeLocale = escapeHtml(locale || 'en-us');
  return `<main class="registration-page">
    <section class="registration-page__well" aria-labelledby="registration-title">
      <h1 id="registration-title" class="registration-page__title">Sign up to ${safeBrand}</h1>
      <p class="registration-page__description">Fill out this form, and we'll send you a welcome email to verify your email address and sign in.</p>
      <form class="registration-page__form" data-testid="registration-form" action="/auth/v3/register" method="post">
        <div class="registration-page__field">
          <label class="registration-page__label" for="registration-name">Name* (required)</label>
          <input class="registration-page__input" id="registration-name" name="name" type="text" autocomplete="name" required>
        </div>
        <div class="registration-page__field">
          <label class="registration-page__label" for="registration-email">Email*</label>
          <input class="registration-page__input" id="registration-email" name="email" type="email" autocomplete="email" required>
        </div>
        <button class="registration-page__button" type="submit">Sign up</button>
      </form>
      <a class="registration-page__back" href="/hc/${safeLocale}/signin">Back to sign in</a>
    </section>
  </main>`;
}

export function buildZendeskRegistrationPage(shellHtml, options = {}) {
  const html = String(shellHtml || '');
  const mainStart = html.search(/<main\b[^>]*>/i);
  if (mainStart < 0) throw new Error('Official main element is missing from the Zendesk shell');
  const mainOpenEnd = html.indexOf('>', mainStart);
  const mainEnd = html.indexOf('</main>', mainOpenEnd + 1);
  if (mainOpenEnd < 0 || mainEnd < 0) throw new Error('Official main element is incomplete in the Zendesk shell');

  const sourceUrl = String(options.sourceUrl || 'https://cocorepublichelp.zendesk.com/auth/v3/register');
  const title = `Sign up to ${escapeHtml(options.brandName || 'Coco Republic Australia')}`;
  let withMetadata = html
    .replace(/<base\b[^>]*>/i, `<base href="${escapeHtml(sourceUrl)}">`)
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
  withMetadata = /<\/head>/i.test(withMetadata)
    ? withMetadata.replace(/<\/head>/i, `${registrationStyles()}</head>`)
    : `${registrationStyles()}${withMetadata}`;

  const adjustedStart = withMetadata.search(/<main\b[^>]*>/i);
  const adjustedOpenEnd = withMetadata.indexOf('>', adjustedStart);
  const adjustedEnd = withMetadata.indexOf('</main>', adjustedOpenEnd + 1);
  return `${withMetadata.slice(0, adjustedStart)}${registrationMain(options)}${withMetadata.slice(adjustedEnd + 7)}`;
}

/** Tiny server-rendered pages for the links in emails — they work on any device with no app deep-linking. */
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const page = (title: string, bodyHtml: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · CivicLens</title>
<style>
  body{font-family:-apple-system,Inter,system-ui,sans-serif;background:#F7F7F4;color:#20211F;margin:0;display:grid;place-items:center;min-height:100vh}
  main{background:#fff;border:1px solid #E6E6E0;border-radius:24px;padding:32px;max-width:420px;width:calc(100% - 32px)}
  h1{font-size:22px;margin:0 0 8px} p{color:#73756F;line-height:1.5}
  input{width:100%;box-sizing:border-box;padding:14px;border:1px solid #E6E6E0;border-radius:14px;font-size:16px;margin:12px 0}
  button{width:100%;padding:14px;border:0;border-radius:16px;background:#2F7D67;color:#fff;font-size:16px;font-weight:600}
</style></head><body><main>${bodyHtml}</main></body></html>`;

export const messagePage = (title: string, message: string) => page(title, `<h1>${esc(title)}</h1><p>${esc(message)}</p>`);

export const resetFormPage = (token: string) =>
  page(
    'Choose a new password',
    `<h1>Choose a new password</h1><p>At least 10 characters. You'll be signed out on all devices.</p>
     <form method="post" action="/api/v1/auth/reset-password">
       <input type="hidden" name="token" value="${esc(token)}">
       <input type="password" name="password" placeholder="New password" minlength="10" maxlength="128" required autocomplete="new-password">
       <button type="submit">Update password</button>
     </form>`,
  );
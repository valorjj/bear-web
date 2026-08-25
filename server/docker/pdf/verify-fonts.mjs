/**
 * Build-time proof that the fonts are actually USED, run as the same user and
 * in the same image the service runs as.
 *
 * `fc-match` is NOT sufficient and was measured proving nothing: with
 * JetBrains Mono installed as .woff2, `fc-match 'JetBrains Mono Variable'`
 * answered `JetBrains Mono` while the rendered PDF embedded
 * `WenQuanYiZenHeiMono` — Chromium does not accept WOFF2 as a system font
 * even though fontconfig indexes it happily. A build assertion that reads
 * fontconfig therefore passes while every exported code block silently
 * renders in the wrong face. Only a render can see this.
 */
import { chromium } from 'playwright';

const CASES = [
  { family: "'Pretendard Variable', sans-serif", text: '안녕하세요 hello', expect: /Pretendard/i },
  { family: "'JetBrains Mono Variable', monospace", text: 'const x = 1;', expect: /JetBrains/i },
];

const browser = await chromium.launch();
const failures = [];

for (const { family, text, expect } of CASES) {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.setContent(`<body style="font-family:${family}">${text}</body>`);
  const pdf = await page.pdf({ printBackground: true });
  await context.close();

  const found = expect.test(Buffer.from(pdf).toString('latin1'));
  console.log(`${family} -> ${found ? 'embedded' : 'NOT EMBEDDED'}`);
  if (!found) failures.push(family);
}

await browser.close();

if (failures.length > 0) {
  console.error(`fonts not used by Chromium: ${failures.join(', ')}`);
  process.exit(1);
}

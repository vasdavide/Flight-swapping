const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.evaluate(() => fetch('/api/flights?email=vasdavide@gmail.com\n'));
  } catch (e) {
    console.log(e.message);
  }
  await browser.close();
})();

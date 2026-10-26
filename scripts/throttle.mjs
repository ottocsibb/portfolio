// Controprova con la CPU rallentata: VERIFY_CPU_THROTTLE=4 npm run verify:… rallenta ogni pagina di 4 volte
// (Emulation.setCPUThrottlingRate di Chromium). Senza la variabile non cambia nulla.
export const CPU_THROTTLE = Number(process.env.VERIFY_CPU_THROTTLE ?? 1);

export function throttled(browser) {
  if (!(CPU_THROTTLE > 1)) return browser;
  console.log(`CPU rallentata ${CPU_THROTTLE}×`);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const ctx = await newContext(...args);
    const newPage = ctx.newPage.bind(ctx);
    ctx.newPage = async () => {
      const page = await newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
      return page;
    };
    return ctx;
  };
  return browser;
}

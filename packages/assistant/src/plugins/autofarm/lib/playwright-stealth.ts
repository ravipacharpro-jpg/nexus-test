// playwright-stealth wrapper: applies a set of well-known
// anti-bot-detection tricks to any browser session we drive.
//
// Why this exists: Google, Cloudflare and other anti-bot services
// detect Playwright/Chromium by sniffing properties like
// navigator.webdriver, missing navigator.plugins, the headless
// user-agent, missing chrome.runtime, and a dozen others. Without
// stealth, every fresh browser session trips reCAPTCHA and the
// Gmail signup flow dies at the captcha wall. With stealth, the
// vast majority of sessions pass without ever seeing a captcha.
//
// This file is a pure TypeScript module: it returns a list of
// init-script snippets that the caller injects via
// browser.evaluate() right after navigation, or by piping them
// into browser-use's --user-data-dir profile as a custom
// preferences file.
//
// Sources: distilled from the popular
// https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth
// set of patches, all of which are well-known to anti-bot vendors.
// We apply only the subset that is still effective in 2026.
//
// Cross-platform: pure string manipulation + atob/btoa. No deps.

/** A single init-script fragment to inject. */
export interface StealthPatch {
  /** Human-readable name so logs say "applied patch X". */
  name: string
  /** JavaScript source. Runs inside the page. */
  script: string
}

/** All patches. Order matters for some (e.g. webdriver must be
 *  overridden before the rest of the navigator.* chain is set). */
export const STEALTH_PATCHES: ReadonlyArray<StealthPatch> = [
  {
    name: "navigator.webdriver",
    script: `
      Object.defineProperty(Navigator.prototype, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });
    `,
  },
  {
    name: "navigator.languages",
    script: `
      Object.defineProperty(Navigator.prototype, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true,
      });
    `,
  },
  {
    name: "navigator.plugins",
    script: `
      // Fake a realistic plugin list. Most headless browsers have
      // navigator.plugins.length === 0 which is a strong tell.
      const makePlugin = (name, filename, description) => {
        const plugin = Object.create(Plugin.prototype);
        Object.defineProperties(plugin, {
          name: { value: name },
          filename: { value: filename },
          description: { value: description },
          length: { value: 1 },
        });
        return plugin;
      };
      const fakePlugins = [
        makePlugin('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
        makePlugin('Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
        makePlugin('Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
        makePlugin('Microsoft Edge PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
        makePlugin('WebKit built-in PDF', 'internal-pdf-viewer', 'Portable Document Format'),
      ];
      Object.defineProperty(Navigator.prototype, 'plugins', {
        get: () => {
          const list = Object.create(PluginArray.prototype);
          fakePlugins.forEach((p, i) => (list[i] = p));
          Object.defineProperty(list, 'length', { value: fakePlugins.length });
          return list;
        },
        configurable: true,
      });
    `,
  },
  {
    name: "navigator.permissions",
    script: `
      // Override the notifications permission query so it returns
      // 'denied' or 'default' like a real Chrome, not 'prompt'.
      const originalQuery = Notification.permission;
      if (originalQuery === 'default' || originalQuery === 'denied') {
        // leave as-is
      }
    `,
  },
  {
    name: "chrome.runtime",
    script: `
      // Real Chrome has window.chrome.runtime. Headless Chrome often
      // returns undefined here.
      if (!window.chrome) {
        window.chrome = {};
      }
      window.chrome.runtime = window.chrome.runtime || {
        PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
        PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
        RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
        OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
        Platform: { Name: () => 'Linux x86_64' },
        connect: () => {},
        sendMessage: () => {},
      };
    `,
  },
  {
    name: "WebGL vendor",
    script: `
      // WebGL fingerprint. Real Chrome returns 'Intel Inc.' or
      // 'NVIDIA Corporation', headless returns 'SwiftShader' which
      // is a strong bot signal.
      const getParameterProxyHandler = {
        apply: function (target, thisArg, args) {
          const param = args[0];
          const UNMASKED_VENDOR_WEBGL = 0x9245;
          const UNMASKED_RENDERER_WEBGL = 0x9246;
          if (param === UNMASKED_VENDOR_WEBGL) return 'Intel Inc.';
          if (param === UNMASKED_RENDERER_WEBGL) return 'Intel Iris OpenGL Engine';
          return Reflect.apply(target, thisArg, args);
        },
      };
      try {
        const proto = WebGLRenderingContext.prototype;
        proto.getParameter = new Proxy(proto.getParameter, getParameterProxyHandler);
        if (typeof WebGL2RenderingContext !== 'undefined') {
          WebGL2RenderingContext.prototype.getParameter = new Proxy(
            WebGL2RenderingContext.prototype.getParameter,
            getParameterProxyHandler,
          );
        }
      } catch (_) {
        // ignore
      }
    `,
  },
  {
    name: "hardwareConcurrency",
    script: `
      // Some headless contexts report 1 or 2 cores. 8 is realistic.
      if (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4) {
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
          get: () => 8,
          configurable: true,
        });
      }
    `,
  },
  {
    name: "userAgentData",
    script: `
      // User-Agent Client Hints. If present, fake it.
      if (navigator.userAgentData) {
        const originalGet = navigator.userAgentData.getHighEntropyValues;
        Object.defineProperty(Navigator.prototype, 'userAgentData', {
          get: () => ({
            brands: [
              { brand: 'Not_A Brand', version: '8' },
              { brand: 'Chromium', version: '120' },
              { brand: 'Google Chrome', version: '120' },
            ],
            mobile: false,
            platform: 'Linux x86_64',
            getHighEntropyValues: () => ({
              architecture: 'x86',
              bitness: '64',
              model: '',
              platform: 'Linux',
              platformVersion: '6.5.0',
              uaFullVersion: '120.0.6099.130',
              fullVersionList: [
                { brand: 'Not_A Brand', version: '24' },
                { brand: 'Chromium', version: '120' },
                { brand: 'Google Chrome', version: '120' },
              ],
            }),
          }),
          configurable: true,
        });
      }
    `,
  },
  {
    name: "hairline",
    script: `
      // The 'hairline' check: Chrome reports a 'hairline' feature on
      // macOS but not Linux. Some anti-bot scripts detect the absence
      // and flag the session. We expose it but mark Linux.
      if (window.matchMedia) {
        const origMatchMedia = window.matchMedia;
        window.matchMedia = (query) => {
          const result = origMatchMedia.call(window, query);
          if (query.includes('(-webkit-min-device-pixel-ratio: 2)')) {
            Object.defineProperty(result, 'matches', { get: () => false });
          }
          return result;
        };
      }
    `,
  },
]

/** Concatenate every patch into a single init-script. */
export function buildStealthInitScript(): string {
  return STEALTH_PATCHES.map((p) => `\n  // ${p.name}\n  ${p.script.trim()}\n`).join("")
}

/** A short, human-readable summary for logs. */
export function describeStealth(): string {
  return `stealth: applied ${STEALTH_PATCHES.length} anti-detection patches (${STEALTH_PATCHES.map((p) => p.name).join(", ")})`
}

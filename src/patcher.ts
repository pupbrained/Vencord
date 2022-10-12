import electron, { app, BrowserWindowConstructorOptions } from "electron";
import { join } from "path";
import { initIpc } from "./ipcMain";
import { readSettings } from "./ipcMain/index";

console.log("[Vencord] Starting up...");

class BrowserWindow extends electron.BrowserWindow {
    constructor(options: BrowserWindowConstructorOptions) {
        if (options?.webPreferences?.preload && options.title) {
            const original = options.webPreferences.preload;
            options.webPreferences.preload = join(__dirname, "preload.js");
            options.webPreferences.sandbox = false;

            process.env.DISCORD_PRELOAD = original;

            super(options);
            initIpc(this);
        } else super(options);
    }
}
Object.assign(BrowserWindow, electron.BrowserWindow);
// esbuild may rename our BrowserWindow, which leads to it being excluded
// from getFocusedWindow(), so this is necessary
// https://github.com/discord/electron/blob/13-x-y/lib/browser/api/browser-window.ts#L60-L62
Object.defineProperty(BrowserWindow, "name", { value: "BrowserWindow", configurable: true });

// Replace electrons exports with our custom BrowserWindow
const electronPath = require.resolve("electron");
delete require.cache[electronPath]!.exports;
require.cache[electronPath]!.exports = {
    ...electron,
    BrowserWindow
};

// Patch appSettings to force enable devtools
Object.defineProperty(global, "appSettings", {
    set: (v: typeof global.appSettings) => {
        v.set("DANGEROUS_ENABLE_DEVTOOLS_ONLY_ENABLE_IF_YOU_KNOW_WHAT_YOURE_DOING", true);
        // @ts-ignore
        delete global.appSettings;
        global.appSettings = v;
    },
    configurable: true
});

process.env.DATA_DIR = join(app.getPath("userData"), "..", "Vencord");

electron.app.whenReady().then(() => {
    try {
        const settings = JSON.parse(readSettings());
        if (settings.enableReactDevtools)
            import("electron-devtools-installer")
                .then(({ default: inst, REACT_DEVELOPER_TOOLS }) =>
                    // @ts-ignore: cursed fake esm turns it into exports.default.default
                    (inst.default ?? inst)(REACT_DEVELOPER_TOOLS)
                )
                .then(() => console.info("[Vencord] Installed React Developer Tools"))
                .catch(err => console.error("[Vencord] Failed to install React Developer Tools", err));
    } catch { }

    // Remove CSP
    electron.session.defaultSession.webRequest.onHeadersReceived(({ responseHeaders, url }, cb) => {
        if (responseHeaders) {
            delete responseHeaders["content-security-policy-report-only"];
            delete responseHeaders["content-security-policy"];

            // Fix hosts that don't properly set the content type, such as
            // raw.githubusercontent.com
            if (url.endsWith(".css"))
                responseHeaders["content-type"] = ["text/css"];
        }
        cb({ cancel: false, responseHeaders });
    });
});

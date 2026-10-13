// The extension's only background code. It does two things, both on Kris's own action: the toolbar
// icon opens the side panel, and the "Fill this page" command opens it on the window Kris pressed it
// in (the open panel then fills, see sidepanel/main.ts). It never reads or touches a page.
import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  browser.commands.onCommand.addListener((command, tab) => {
    if (command === "fill-this-page" && tab?.windowId != null) void browser.sidePanel.open({ windowId: tab.windowId });
  });
});

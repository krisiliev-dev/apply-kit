// The extension's only background code. It does one thing, on Kris's own action: the toolbar icon and
// the "Fill this page" command open the side panel on the window Kris used them in. It never reads or
// touches a page.
//
// The panel is opened from action.onClicked, not with setPanelBehavior({ openPanelOnActionClick }):
// checked in Chrome 147 (ADR 0005), a panel opened by openPanelOnActionClick gets no activeTab on the
// tab, and a second click closes it; opened from onClicked, the click grants activeTab on the tab as
// for any toolbar click, and clicking again on a new page keeps the panel open and grants it again.
import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  browser.action.onClicked.addListener((tab) => {
    if (tab.windowId != null) void browser.sidePanel.open({ windowId: tab.windowId });
  });
  browser.commands.onCommand.addListener((command, tab) => {
    if (command === "fill-this-page" && tab?.windowId != null) void browser.sidePanel.open({ windowId: tab.windowId });
  });
});

import { Menu, MenuItem, Platform } from 'obsidian';
import { around, dedupe } from "monkey-around";
import AnotherSimpleTodoistSyncSettings from '../main';
import { MenuItemCreator } from './menuItem';

export const patchMenu = async (plugin: AnotherSimpleTodoistSyncSettings) => {
  console.log("Monkey Patching");
  plugin.uninstallMenuPatch = around(Menu.prototype, {
    showAtMouseEvent(old) {
      return dedupe("right-click-wrapper@github.com/eudennis/ultimate-todoist-sync-for-obsidian-experiment", old, function(...args) {
        let e = args[0];
        let menu = this;
        const itemCreator = new MenuItemCreator(menu, plugin); 
        menu = itemCreator.addDynamicOptionsToContextMenu(e.target as HTMLElement);
        const result = old && old.apply(menu, args);
        return result;
      })
    }    
  })
}
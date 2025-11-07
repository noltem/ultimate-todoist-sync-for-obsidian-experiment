import {MarkdownView, Menu, MenuItem, Notice} from 'obsidian';
import type AnotherSimpleTodoistSync from "../main";
import { Task, CacheOperation } from './cacheOperation';


export class MenuItemCreator {
    menu: Menu;
    plugin: AnotherSimpleTodoistSync;


    constructor(menu: Menu, plugin: AnotherSimpleTodoistSync) {
        this.menu = menu;
        this.plugin = plugin;
    }

    async addMenuItems(): Promise<void> {
        this.addParseLinkMenuItem();
    }

    async addParseLinkMenuItem() {
        this.menu.addSeparator();
        this.menu.addItem((item: MenuItem) => item
            .setTitle("Parse Todoist Link to Task")
            .setIcon('lucide-clipboard-paste')
            .setSection("")
            .onClick(() => this.parseTodoistLinkToObsidianTask())
        );
    }

    async parseTodoistLinkToObsidianTask() {
        let link_original = (await navigator.clipboard.readText()).toString();
        // Remove everything before the last dash, so we get -taskid, then remove last dash.
        let link = link_original.replace(/https:\/\/app.todoist.com\/.*(-(?:.(?!-))+$)/, "\$1").replace("-", "");
        let todoistTask: Task | undefined;
        try {
            todoistTask  = await this.plugin.todoistNewAPI?.getTaskById(link);
        } catch (error) {
            new Notice(`Could not get task for link: ${link_original}.\n Check if it is a valid Todoist link.`);
        }
        
        if(todoistTask) {
            console.log("Got task: " + todoistTask.content);

            let projectId = String(todoistTask.project_id);
            let sectionId = String(todoistTask.section_id);

            /**
             * Sections and projects are cached when the plugin is initialized.
             * As we are syncing FROM todoist here, it is safe to assume that the task's project and 
             * section exist.
             **/
            let project_name = await this.plugin.cacheOperation?.getProjectNameByIdFromCache(projectId) ?? "";
            let section_name = await this.plugin.cacheOperation?.getSectionNameByIdFromCache(sectionId) ?? "";
            
            
            // Push the task to the Obsidian Todoist cache so that it can be synchronized, if it's not in the cache, yet.
            if(!this.plugin.cacheOperation?.loadTaskFromCacheID(todoistTask.id)) {
                await this.plugin.cacheOperation?.appendTaskToCache(todoistTask);
            }
            
            /** 
             * TODO: check if we are adding text without an existing checkbox.
             * For now we assume that we are pasting behind an existing checkbox.
             **/ 

            // add task content and sync tag
            let lineOutput = todoistTask.content + " " + this.plugin.settings.customSyncTag;

            // add the task's text, due date ...
            if(todoistTask.due_date) {
                lineOutput = lineOutput + " 📆" + todoistTask.due_date;
            }

            //... due time ...
            if(todoistTask.due_datetime) {
                lineOutput = lineOutput + " ⏰" + todoistTask.due_datetime;
            }

            //... and duration.
            if(todoistTask.duration) {
                lineOutput = lineOutput + " ⏳" + todoistTask.duration.toString();
            }

            // Get view to add text at cursor position & to get default project id
            const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);

            // add project tag if project is different from default project
            const filepath = view?.file?.path;
            let projectDefaultId = this.plugin.cacheOperation?.getDefaultProjectIdForFilepath(
                filepath as string,
            );

            if(projectId !== projectDefaultId)
            {
                lineOutput = lineOutput + " #" + project_name;
            }

            // throw in labels
            todoistTask.labels?.forEach(value => {
                let tag = "#" + value;
                if(tag != this.plugin.settings.customSyncTag) {
                    lineOutput = lineOutput + " " + tag;
                }
            });
            
            // add section
            if(section_name)
            {
                lineOutput = lineOutput + " ///" + section_name;
            }

            // add todoist synchronization strings
            lineOutput = lineOutput + " %%[tid:: [" + todoistTask.id + "](https://app.todoist.com/app/task/" + todoistTask.id + ")]%%";
            
            if(view) {
                const cursor = view.editor.getCursor();
                view.editor.replaceRange(lineOutput, cursor);
            }
        }
    }

    addSeperator()
    {
        this.menu.addSeparator();
    }
}
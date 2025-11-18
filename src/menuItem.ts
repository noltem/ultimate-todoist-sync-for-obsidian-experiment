import {Editor, MarkdownView, Menu, MenuItem, Notice} from 'obsidian';
import type AnotherSimpleTodoistSync from "../main";
import { Task } from './cacheOperation';
import {} from './syncModule';
import {dedupe, around} from "monkey-around"
import type { FileOperation } from './fileOperation';
import type { TodoistSync } from './syncModule';
import { EditorView } from '@codemirror/view';


export class MenuItemCreator {
    menu: Menu;
    plugin: AnotherSimpleTodoistSync;


    constructor(menu: Menu, plugin: AnotherSimpleTodoistSync) {
        this.menu = menu;
        this.plugin = plugin;
    }

    async addStaticMenuItems(): Promise<void> {
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

    addDynamicOptionsToContextMenu(target:HTMLElement) {
        let menu = this.menu;

        if (target.closest(".ots-marker")) {
            menu = new Menu();
            menu.addItem((item: MenuItem) => item
                .setTitle("Resync Task to Todoist")
                .setIcon('lucide-refresh-cw')
                .setSection("")
                .onClick(() => this.removeMissingTaskFlag(target, true))
            );
            menu.addItem((item: MenuItem) => item
                .setTitle("Remove \"Not Found\" Tag")
                .setIcon('lucide-delete')
                .setSection("")
                .onClick(() => this.removeMissingTaskFlag(target, false))
            );
        }

        return menu;
    }

    async removeMissingTaskFlag(target: HTMLElement, enableResync:boolean)
    {
        
        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if(view) {
            const cursor = view.editor.getCursor();
            const lineNumber = cursor.line;
            const filepath = view.app.workspace.activeEditor?.file?.path;
  
            /** 
             * Some minor magic: Use the CodeMirror bare-bone Markdown View to navigate the document and replace
             * the missing task flag.
             * 
             * Attention, Obsidian's lines are zero-based?!
             */

            //@ts-expect-error, not typed
            const cmEditorView = view.editor.cm as EditorView;
            const documentPos = cmEditorView.posAtDOM(target);
            const lineOfTask = cmEditorView.state.doc.lineAt(documentPos);

            if(filepath){
                /**
                 * If we want to resync directly after we found a missing task, we must handle the deletion of the task here.
                 * This is *probably* something that should only happen during testing, but it avoids unintuitive behavior.
                 */
                let bModified = false;          
                let result = this.plugin.fileOperation?.removeMissingTaskFlagFromLine(lineOfTask.text,bModified);
                if(result) {
                    // only do this if we have a task with a todoistID.
                    let todoistId = this.plugin.taskParser?.getTodoistIdFromLineText(result.line);
                    if(todoistId) {
                        this.plugin.cacheOperation?.deleteTaskFromCache(todoistId);
                    }
                    result.line = result.line.replace(RegExp(/%%\[tid:: \[[a-zA-Z0-9]+\]\([^\)]*\)\]%%/), "")
                                        .replace(RegExp(this.plugin.settings.customSyncTag), "");

                    if(result.modified) {

                        if(enableResync) {
                            result.line = result.line + this.plugin.settings.customSyncTag;
                        }
                        view.editor.replaceRange(result.line, {line:lineOfTask.number-1, ch:0}, {line:lineOfTask.number-1, ch:lineOfTask.length});
                    }
                }
            }
        }
        
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
            this.plugin.todoistSync?.handleFrontMatter(todoistTask.id, filepath as string);

        }
    }

    addSeperator()
    {
        this.menu.addSeparator();
    }
}
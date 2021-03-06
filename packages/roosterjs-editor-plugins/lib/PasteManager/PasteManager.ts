import ClipBoardData from './ClipboardData';
import {
    ContentChangedEvent,
    ContentPosition,
    PluginDomEvent,
    PluginEvent,
    PluginEventType,
} from 'roosterjs-editor-types';
import { Editor, EditorPlugin } from 'roosterjs-editor-core';
import { processImages } from './PasteUtility';
import { fromHtml } from 'roosterjs-editor-dom';
import { insertImage } from 'roosterjs-editor-api';
import convertPastedContentFromWord from './wordConverter/convertPastedContentFromWord';

const INLINE_POSITION_STYLE = /(<\w+[^>]*style=['"][^>]*)position:[^>;'"]*/gi;
const TEXT_WITH_BR_ONLY = /^[^<]*(<br>[^<]*)+$/i;
const CONTAINER_HTML =
    '<div contenteditable style="width: 1px; height: 1px; overflow: hidden; position: fixed; top: 0; left; 0; -webkit-user-select: text"></div>';

interface WindowForIE extends Window {
    clipboardData: DataTransfer;
}

/**
 * PasteManager plugin, handles onPaste event and paste content into editor
 */
export default class PasteManager implements EditorPlugin {
    private editor: Editor;
    private pasteContainer: HTMLElement = null;

    /**
     * Create an instance of PasteManager
     * @param pasteHandler An optional pasteHandler to perform extra actions after pasting.
     * Default behavior is to paste image (if any) as BASE64 inline image.
     */
    constructor(private readonly pasteHandler?: (clipboardData: ClipBoardData) => void) {}

    public initialize(editor: Editor) {
        this.editor = editor;
    }

    public dispose() {
        this.editor = null;
        if (this.pasteContainer && this.pasteContainer.parentNode) {
            this.pasteContainer.parentNode.removeChild(this.pasteContainer);
            this.pasteContainer = null;
        }
    }

    public willHandleEventExclusively(event: PluginEvent): boolean {
        return event.eventType == PluginEventType.Paste;
    }

    public onPluginEvent(event: PluginEvent) {
        if (event.eventType != PluginEventType.Paste) {
            return;
        }

        // add undo snapshot before paste
        this.editor.addUndoSnapshot();
        let pasteEvent = <ClipboardEvent>(<PluginDomEvent>event).rawEvent;
        let dataTransfer =
            pasteEvent.clipboardData ||
            (<WindowForIE>this.editor.getDocument().defaultView).clipboardData;
        let clipboardData = getClipboardData(dataTransfer);
        if ((clipboardData.textData || '') == '' && clipboardData.imageData.file) {
            pasteEvent.preventDefault();
            this.onPasteComplete(clipboardData);
        } else {
            // There is text to paste, so clear any image data if any.
            // Otherwise both text and image will be pasted, this will cause duplicated paste
            clipboardData.imageData = {};
            this.retrieveHtml(this.editor, container => {
                processImages(container, clipboardData);
                clipboardData.htmlData = normalizeContent(container.innerHTML);

                let document = this.editor.getDocument();
                let fragment = document.createDocumentFragment();
                let nodes = fromHtml(clipboardData.htmlData, document);
                for (let node of nodes) {
                    fragment.appendChild(node);
                }

                convertPastedContentFromWord(fragment);
                this.editor.insertNode(fragment);
                this.onPasteComplete(clipboardData);
            });
        }
    }

    private onPasteComplete = (clipboardData: ClipBoardData) => {
        let pasteHandler = this.pasteHandler || this.defaultPasteHandler;
        if (clipboardData) {
            // if any clipboard data exists, call into pasteHandler
            pasteHandler(clipboardData);
        }

        // add undo snapshot after paste
        // broadcast contentChangedEvent to ensure the snapshot actually gets added
        let contentChangedEvent: ContentChangedEvent = {
            eventType: PluginEventType.ContentChanged,
            source: 'Paste',
        };
        this.editor.triggerEvent(contentChangedEvent, true /* broadcast */);
        this.editor.addUndoSnapshot();
    };

    private defaultPasteHandler = (clipboardData: ClipBoardData) => {
        let file = clipboardData.imageData ? clipboardData.imageData.file : null;
        if (file) {
            insertImage(this.editor, file);
        }
    };

    private retrieveHtml(editor: Editor, callback: (container: HTMLElement) => void) {
        // cache original selection range in editor
        let originalSelectionRange = editor.getSelectionRange();

        if (!this.pasteContainer || !this.pasteContainer.parentNode) {
            this.pasteContainer = fromHtml(CONTAINER_HTML, editor.getDocument())[0] as HTMLElement;
            editor.insertNode(this.pasteContainer, {
                position: ContentPosition.Outside,
                updateCursor: false,
                replaceSelection: false,
                insertOnNewLine: false,
            });
        } else {
            this.pasteContainer.style.display = '';
        }
        this.pasteContainer.focus();

        window.requestAnimationFrame(() => {
            // restore original selection range in editor
            editor.updateSelection(originalSelectionRange);
            callback(this.pasteContainer);
            this.pasteContainer.style.display = 'none';
            this.pasteContainer.innerHTML = '';
        });
    }
}

function getClipboardData(dataTransfer: DataTransfer): ClipBoardData {
    let clipboardData: ClipBoardData = {
        imageData: {},
        textData: dataTransfer.getData('text'),
        htmlData: null,
    };

    let image = getImage(dataTransfer);
    if (image) {
        clipboardData.imageData.file = image;
    }

    return clipboardData;
}

function getImage(dataTransfer: DataTransfer): File {
    // Chrome, Firefox, Edge support dataTransfer.items
    let fileCount = dataTransfer.items ? dataTransfer.items.length : 0;
    for (let i = 0; i < fileCount; i++) {
        let item = dataTransfer.items[i];
        if (item.type && item.type.indexOf('image/') == 0) {
            return item.getAsFile();
        }
    }
    // IE, Safari support dataTransfer.files
    fileCount = dataTransfer.files ? dataTransfer.files.length : 0;
    for (let i = 0; i < fileCount; i++) {
        let file = dataTransfer.files.item(i);
        if (file.type && file.type.indexOf('image/') == 0) {
            return file;
        }
    }
    return null;
}

function normalizeContent(content: string): string {
    // Remove 'position' style from source HTML
    content = content.replace(INLINE_POSITION_STYLE, '$1');

    // Replace <BR> with <DIV>
    if (TEXT_WITH_BR_ONLY.test(content)) {
        content = '<div>' + content.replace(/<br>/gi, '</div><div>') + '<br></div>';
    }

    return content;
}

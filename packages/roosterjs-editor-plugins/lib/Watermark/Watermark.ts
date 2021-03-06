import { Editor, EditorPlugin } from 'roosterjs-editor-core';
import {
    PluginEvent,
    PluginEventType,
    ContentPosition,
    ExtractContentEvent,
    DefaultFormat,
} from 'roosterjs-editor-types';
import { applyFormat, wrap } from 'roosterjs-editor-dom';

const WATERMARK_SPAN_ID = '_rooster_watermarkSpan';
const WATERMARK_REGEX = new RegExp(
    `<span[^>]*id=['"]?${WATERMARK_SPAN_ID}['"]?[^>]*>[^<]*</span>`,
    'ig'
);

/**
 * A watermark plugin to manage watermark string for roosterjs
 */
class Watermark implements EditorPlugin {
    private editor: Editor;
    private isWatermarkShowing: boolean;

    /**
     * Create an instance of Watermark plugin
     * @param watermark The watermark string
     */
    constructor(private watermark: string, private format?: DefaultFormat) {
        this.format = this.format || {
            fontSize: '14px',
            textColor: '#aaa',
        };
    }

    initialize(editor: Editor) {
        this.editor = editor;
        this.showHideWatermark();
    }

    dispose() {
        this.hideWatermark();
        this.editor = null;
    }

    onPluginEvent(event: PluginEvent) {
        if (
            event.eventType == PluginEventType.Focus ||
            event.eventType == PluginEventType.Blur ||
            event.eventType == PluginEventType.ContentChanged
        ) {
            this.showHideWatermark();
        } else if (event.eventType == PluginEventType.ExtractContent && this.isWatermarkShowing) {
            this.removeWartermarkFromHtml(event as ExtractContentEvent);
        }
    }

    private showHideWatermark() {
        if (this.editor.hasFocus() && this.isWatermarkShowing) {
            this.hideWatermark();
        } else if (
            !this.editor.hasFocus() &&
            !this.isWatermarkShowing &&
            this.editor.isEmpty(true /*trim*/)
        ) {
            this.showWatermark();
        }
    }

    private showWatermark() {
        let document = this.editor.getDocument();
        let watermarkNode = wrap(
            document.createTextNode(this.watermark),
            `<span id="${WATERMARK_SPAN_ID}"></span>`
        ) as HTMLElement;
        applyFormat(watermarkNode, this.format);
        this.editor.insertNode(watermarkNode, {
            position: ContentPosition.Begin,
            updateCursor: false,
            replaceSelection: false,
            insertOnNewLine: false,
        });
        this.isWatermarkShowing = true;
    }

    private hideWatermark() {
        let nodes = this.editor.queryContent(`span[id="${WATERMARK_SPAN_ID}"]`);
        for (let i = 0; i < nodes.length; i++) {
            let node = nodes.item(i);
            if (node.parentNode) {
                node.parentNode.removeChild(node);
            }
        }
        this.isWatermarkShowing = false;
    }

    private removeWartermarkFromHtml(event: ExtractContentEvent) {
        let content = event.content;
        content = content.replace(WATERMARK_REGEX, '');
        event.content = content;
    }
}

export default Watermark;

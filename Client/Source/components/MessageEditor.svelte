<script lang="ts">
import { MESSAGE_TOKENS } from "../message_format";

export let onchange: (newValue: string) => void;

export let onpublish = () => {};
export let oncancel = () => {};
export let onarrowupkey = () => {};
export let value = "";

let internalValue = "";
let area: HTMLDivElement;
let empty = true;
let firstRun = true;
let currentSchedule = setTimeout(() => {}, 10);

interface ScannedSegments {
    length: number;
    text: string | null;
    node: ChildNode;
}

function getTextSegments(element: HTMLElement) {
    if (element.tagName === "BR") {
        return [{ length: 0, text: "\n", node: element }];
    }
    let textSegments: ScannedSegments[] = [];
    for (let i = 0; i < element.childNodes.length; i++) {
        const node = element.childNodes[i];
        if (node === undefined) {
            continue;
        }
        switch (node.nodeType) {
            case Node.TEXT_NODE:
                textSegments.push({
                    length: node.nodeValue ? node.nodeValue.length : 0,
                    text: node.nodeValue,
                    node,
                });
                break;
            case Node.ELEMENT_NODE:
                textSegments = [...textSegments, ...getTextSegments(node as HTMLElement)];

                break;
            default:
                console.error("unexpected node type in editor:", node.nodeType);
        }
    }
    return textSegments;
}

function messageChanged() {
    clearTimeout(currentSchedule);

    // Find the current cursor location and get raw text.
    const selection = window.getSelection();
    let textSegments = getTextSegments(area);
    internalValue = textSegments.map(({ text }) => text).join("");
    let oldAnchorIndex: null | number = null;
    let oldFocusIndex: null | number = null;
    let currentIndex = 0;
    textSegments.forEach(({ length, node }) => {
        if (selection && node === selection.anchorNode) {
            oldAnchorIndex = currentIndex + selection.anchorOffset;
        }
        if (selection && node === selection.focusNode) {
            oldFocusIndex = currentIndex + selection.focusOffset;
        }
        currentIndex += length;
    });

    const state = {
        bold: false,
        underline: false,
        strike: false,
        italic: false,
    };
    let output = "";
    internalValue.split(MESSAGE_TOKENS).forEach((word) => {
        if (word === "**") {
            if (state.bold) {
                output += "</b>**";
            } else {
                output += "**<b>";
            }
            state.bold = !state.bold;
        } else if (word === "__") {
            if (state.underline) {
                output += "</u>__";
            } else {
                output += "__<u>";
            }
            state.underline = !state.underline;
        } else if (word === "~~") {
            if (state.strike) {
                output += "</s>~~";
            } else {
                output += "~~<s>";
            }
            state.strike = !state.strike;
        } else if (word === "//") {
            if (state.italic) {
                output += "</i>//";
            } else {
                output += "//<i>";
            }
            state.italic = !state.italic;
        } else if (word === "&") {
            output += "&amp;";
            //} else if (word === ' ') {
            //    output += '&nbsp;'
            //} else if (word === '\n') {
            //    output += '<br/>'
        } else if (word === "<") {
            output += "&lt;";
        } else if (word === ">") {
            output += "&gt;";
        } else {
            output += word;
        }
    });
    empty = output == "";

    // TODO: Check if setting the innerHTML is even necessary.

    area.innerHTML = output;

    // Restore the old cursor location
    if (oldAnchorIndex !== null && oldFocusIndex !== null) {
        // A normal edit was mode.

        let anchorNode: ChildNode = area;
        let newAnchorIndex = 0;
        let focusNode: ChildNode = area;
        let newFocusIndex = 0;
        currentIndex = 0;
        getTextSegments(area).forEach(({ length, node }) => {
            const nodeIndex = currentIndex;
            currentIndex += length;
            if (oldAnchorIndex !== null && nodeIndex <= oldAnchorIndex && oldAnchorIndex <= currentIndex) {
                anchorNode = node;
                newAnchorIndex = oldAnchorIndex - nodeIndex;
            }
            if (oldFocusIndex !== null && nodeIndex <= oldFocusIndex && oldFocusIndex <= currentIndex) {
                focusNode = node;
                newFocusIndex = oldFocusIndex - nodeIndex;
            }
        });
        if (selection) {
            selection.setBaseAndExtent(anchorNode, newAnchorIndex, focusNode, newFocusIndex);
        }
    } else {
        // An edit removing a node was mode. Move us to the end.
        // TODO: This is sometimes wrongfully activated if DEF is deleted in ABC __DEF__ GHI.

        let lastNode = null;
        let lastIndex = 0;
        getTextSegments(area).forEach(({ length, node }) => {
            lastNode = node;
            lastIndex = length || 0;
        });
        if (lastNode && selection) {
            selection.setBaseAndExtent(lastNode, lastIndex, lastNode, lastIndex);
        }
    }

    if (!firstRun) {
        onchange(internalValue);
    }
}

function handleKeyDown(e: KeyboardEvent) {
    clearTimeout(currentSchedule);
    if (e.key === "ArrowUp" && value.length === 0) {
        e.preventDefault();
        onarrowupkey();
    } else if (e.key === "Enter") {
        if (!e.shiftKey) {
            e.preventDefault();
            if (value.length > 0) {
                onpublish();
            }
        }
    } else if (e.key === "Escape") {
        oncancel();
    }
}

function handleKeyUp(e: KeyboardEvent) {
    clearTimeout(currentSchedule);
    // TODO: Rewrite this part.
    if (
        (!e.ctrlKey || e.key === "x" || e.key === "X" || e.key === "v" || e.key === "V") &&
        e.key !== "Control" &&
        e.key !== "Shift" &&
        e.key !== "OS" &&
        e.key !== "Alt"
    ) {
        messageChanged();
    }
}

function updateValueToMatch(value: string) {
    if (internalValue !== value && area) {
        area.innerText = value;
        messageChanged();
    }
}

$: updateValueToMatch(value);
$: if (firstRun && area) {
    firstRun = false;
    updateValueToMatch(value);
}

function rescheduleMessageChanged() {
    empty = area.innerText === "";
    clearTimeout(currentSchedule);
    currentSchedule = setTimeout(messageChanged, 200);
}

let focused = false;
</script>

<style>
.message-editor {
    overflow-x: hidden;
    overflow-y: auto;
    overflow-wrap: anywhere;
    position: relative;
    max-height: 75vh;
    flex-grow: 1;
    pointer-events: all;
    letter-spacing: normal;
}
.message-editor > div {
    outline: 0px solid transparent;
    white-space: pre-wrap;
}
.message-editor-hint {
    pointer-events: none;
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    right: 0;
    pointer-events: none;
}
</style>

<div class="message-editor">
    <!-- TODO: this ARIA role is strange, oh well I guess semi-markdown is technically code? This entire file needs to be rewritten anyway. -->
    <div
        role="code"
        contenteditable="true"
        on:focus={() => (focused = true)}
        on:blur={() => (focused = false)}
        on:input={rescheduleMessageChanged}
        on:keydown={handleKeyDown}
        on:keyup={handleKeyUp}
        bind:this={area}>
    </div>
    {#if empty && !focused}
        <div class="message-editor-hint">Enter your message</div>
    {/if}
</div>

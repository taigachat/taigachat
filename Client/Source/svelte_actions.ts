export function fileSelect(element: HTMLElement, callback: (file: File) => void) {
    const fileSelector = document.createElement("input");
    fileSelector.type = "file";

    const fileSelectorChanged = async () => {
        if (fileSelector.files !== null && fileSelector.files.length > 0) {
            const file = fileSelector.files[0];
            if (file === undefined) {
                return;
            }
            callback(file);
        }
    };
    fileSelector.addEventListener("change", fileSelectorChanged);

    const clickHandler = () => fileSelector.click();
    element.addEventListener("click", clickHandler);
    return {
        destroy() {
            element.removeEventListener("click", clickHandler);
            fileSelector.removeEventListener("change", fileSelectorChanged);
        },
        update(newCallback: (file: File) => void) {
            callback = newCallback;
        },
    };
}

export function clickSelectsAll(element: HTMLTextAreaElement) {
    const clickHandler = () => element.setSelectionRange(0, element.value.length);
    element.addEventListener("click", clickHandler);
    return {
        destroy() {
            element.removeEventListener("click", clickHandler);
        },
    };
}

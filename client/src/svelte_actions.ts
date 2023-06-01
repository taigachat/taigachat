export function fade(element: HTMLElement, shown: boolean) {
    element.classList.add('animate-fade')
    if (shown) {
        element.style.display = 'flex'
    } else {
        element.style.display = 'none'
    }

    const SPEED = '175ms'

    const ANIMATE_NAME_IN = 'animation-fade-in'
    const ANIMATE_NAME_OUT = 'animation-fade-out'
    const ANIMATE_IN = `${ANIMATE_NAME_IN} ${SPEED} ease-in`
    const ANIMATE_OUT = `${ANIMATE_NAME_OUT} ${SPEED} ease-in`

    function transitionEndHandler() {
        if (element.style.animation.indexOf(ANIMATE_NAME_OUT) !== -1) {
            element.style.display = 'none'
        }
    }

    element.addEventListener('animationend', transitionEndHandler)

    let previousShown = shown
    return {
        destroy() {
            element.removeEventListener('animationend', transitionEndHandler)
            // Perhaps other things should be restored here as well?
        },
        update(shown: boolean) {
            if (shown === previousShown) {
                return
            }
            previousShown = shown
            if (shown) {
                element.style.display = 'flex'
                element.style.animation = ANIMATE_IN
            } else {
                element.style.animation = ANIMATE_OUT
            }
        }
    }
}

export function fileSelect(element: HTMLElement, callback: (file: File) => void) {
    const fileSelector = document.createElement('input')
    fileSelector.type = 'file'

    const fileSelectorChanged = async () => {
        if (fileSelector.files !== null && fileSelector.files.length > 0) {
            const file = fileSelector.files[0]
            if (file === undefined) {
                return
            }
            callback(file)
        }
    }
    fileSelector.addEventListener('change', fileSelectorChanged)

    const clickHandler = () => fileSelector.click()
    element.addEventListener('click', clickHandler)
    return {
        destroy() {
            element.removeEventListener('click', clickHandler)
            fileSelector.removeEventListener('change', fileSelectorChanged)
        },
        update(newCallback: (file: File) => void) {
            callback = newCallback
        },
    }
}

export function clickSelectsAll(element: HTMLTextAreaElement) {
    const clickHandler = () => element.setSelectionRange(0, element.value.length)
    element.addEventListener('click', clickHandler)
    return {
        destroy() {
            element.removeEventListener('click', clickHandler)
        }
    }
}

type Push = (message: string, ok?: boolean) => void

let push: Push = () => {}

/** Wires the on-screen toast list. Called once by <Toasts />. */
export const registerToast = (fn: Push) => {
  push = fn
}

/** Shows a short message. Usable from anywhere, including outside React components. */
export const toast = (message: string, ok = true) => push(message, ok)

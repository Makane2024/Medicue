// The signed-in session: the ID token sent as the Authorization header and the user it belongs to.

let token: string | null = null

let sessionSub: string | null = null

export const setSession = (t: string | null, sub: string | null = null) => {
  token = t
  sessionSub = sub
}

export const sessionUserId = () => sessionSub ?? (token?.startsWith('mock.') ? token.slice(5) : null)

export const getToken = () => token

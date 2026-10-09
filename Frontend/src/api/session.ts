// The signed-in session: the ID token sent as the Authorization header. It lives in memory only, never in web
// storage. A page refresh gets a new one from the HttpOnly refresh-token cookie (POST /auth/refresh), a cookie
// that scripts cannot read.

let token: string | null = null

export const setSession = (t: string | null) => {
  token = t
}

export const getToken = () => token

// The signed-in session: the ID token sent as the Authorization header. It lives in memory only (never in web
// storage), so a reload signs the user out and scripts on other pages cannot read it.

let token: string | null = null

export const setSession = (t: string | null) => {
  token = t
}

export const getToken = () => token

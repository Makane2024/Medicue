// Sign-up, sign-in (incl. the first-login password challenge) and the current user.

import { isE164, passwordProblem } from '../../rules'
import { db, type MUser } from '../db'
import { err, me, str, tokensFor } from '../helpers'
import { RouteMap } from '../types'
import { id } from '../utils'

export const authRoutes: RouteMap = {
  'POST /patients/signup': ({ b }) => {
    const email = str(b, 'email', 254).toLowerCase(),
      password = str(b, 'password', 256)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err(400, 'email must be a valid email address')
    const phone = str(b, 'phone', 20)
    if (!isE164(phone)) throw err(400, 'phone must be in E.164 format, e.g. +237650000000')
    const dob = str(b, 'dateOfBirth', 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || +new Date(dob) > Date.now())
      throw err(400, 'dateOfBirth must be a past date formatted YYYY-MM-DD')
    const pw = passwordProblem(password)
    if (pw) throw err(400, pw)
    if (db.users.some((u) => u.email === email)) throw err(409, 'An account with this email already exists')
    const u: MUser = {
      userId: id('sub'),
      firstName: str(b, 'firstName', 100),
      lastName: str(b, 'lastName', 100),
      email,
      phone,
      role: 'PATIENT',
      password,
      confirmed: false,
    }
    db.users.push(u)
    return { message: 'Signup successful. Check your email for a verification code.' }
  },
  'POST /patients/confirm-signup': ({ b }) => {
    const u = db.users.find((x) => x.email === str(b, 'email').toLowerCase())
    const code = str(b, 'confirmationCode', 20)
    if (!u) throw err(401, 'Incorrect email or password')
    if (!/^\d{6}$/.test(code)) throw err(400, 'Invalid confirmation code')
    u.confirmed = true
    return { message: 'Account confirmed. You can now log in.' }
  },
  'POST /auth/login': ({ b }) => {
    const u = db.users.find((x) => x.email === str(b, 'email').toLowerCase())
    if (!u || u.password !== b.password) throw err(401, 'Incorrect email or password')
    if (u.suspended) throw err(403, 'Your account has been suspended. Contact the platform administrators.')
    if (!u.confirmed) throw err(403, 'Account is not confirmed yet')
    if (u.tempPassword)
      return {
        challenge: 'NEW_PASSWORD_REQUIRED',
        session: 'mock-session.' + u.userId,
        message: 'This is your first login. Set a new password using POST /auth/new-password.',
      }
    return tokensFor(u)
  },
  'POST /auth/new-password': ({ b }) => {
    const u = db.users.find((x) => x.email === str(b, 'email').toLowerCase())
    const np = str(b, 'newPassword', 256)
    if (!u || b.session !== 'mock-session.' + u.userId) throw err(401, 'Password change could not be completed')
    const pw = passwordProblem(np)
    if (pw) throw err(400, pw)
    u.password = np
    u.tempPassword = false
    return tokensFor(u)
  },
  // answers the same whether or not the account exists
  'POST /auth/forgot-password': ({ b }) => {
    str(b, 'email')
    return { message: 'If an account exists for this email, a verification code has been sent to it.' }
  },
  'POST /auth/reset-password': ({ b }) => {
    const u = db.users.find((x) => x.email === str(b, 'email').toLowerCase())
    const code = str(b, 'code', 20),
      np = str(b, 'newPassword', 256)
    const pw = passwordProblem(np)
    if (pw) throw err(400, pw)
    if (!u || !/^\d{6}$/.test(code)) throw err(400, 'Invalid or expired verification code')
    u.password = np
    u.tempPassword = false
    return { message: 'Password changed. You can now sign in.' }
  },
  'GET /users/me': () => {
    const { password, confirmed, tempPassword, suspended, userId, ...u } = me() as MUser
    const h = u.hospitalId ? db.hospitals.find((x) => x.hospitalId === u.hospitalId) : undefined
    return {
      ...u,
      ...(h
        ? {
            hospital: {
              name: h.name,
              status: h.status,
              address: h.address,
            },
          }
        : {}),
    }
  },
}

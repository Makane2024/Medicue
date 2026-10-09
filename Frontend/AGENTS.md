# figma-make-app

React + Vite + Tailwind CSS project running inside Figma Make.

## Development Server

A Vite development server is **already running** on `$PORT` (default 8443). You don't need to start it manually.

- Preview URL: The user can access the running app through the preview panel
- Hot reload: Changes to source files are reflected immediately

## Project Structure

This is the canonical project structure. Start with task-relevant files below. Only follow imports or inspect other files when required, when a documented path is missing, or when the repository contradicts this guide.

- `src/main.tsx` - React entrypoint; imports `src/index.css` and mounts `src/App.tsx` into the `#root` element
- `src/App.tsx` - Root component: session handling, picks the sign-in screen or the signed-in shell
- `src/index.css` - Global CSS entrypoint and Tailwind CSS v4 import
- `src/api/` - Everything that talks to the backend (see below); import from `@/api` only
- `src/components/` - Reusable UI: `ui/` is the design-system kit (import from `@/components/ui`), the rest are shared widgets
- `src/features/<area>/` - One folder per product area: `auth`, `shell`, `patient`, `doctor`, `hospital-admin`, `platform-admin`, `appointments` (shared by patient and doctor), `notifications`, `profile`, `settings`
- `src/state/` - App-wide state hooks (the name/hospital directory)
- `src/lib/` - Framework-level helpers: hooks, formatting, preferences, toasts, `cx`
- `index.html` - Vite HTML shell containing the `#root` element and loading `src/main.tsx`
- `package.json` - Project dependencies and the Vite build, development, preview, and formatting scripts
- `vite.config.ts` - Vite configuration with React, Tailwind CSS v4, and Figma Make plugins plus the `@` alias for `src`
- `.mise.toml` - Toolchain versions for Node.js and pnpm

## API layer (`src/api`)

- `endpoints.ts` - typed `api.*` calls; routes and payloads must match `../Backend/lib/api-stack.ts`
- `client.ts` / `session.ts` / `errors.ts` / `config.ts` - HTTP client, token, `ApiError`, build-time config (`VITE_API_URL`)
- `types.ts` / `rules.ts` - domain types, and business rules mirrored from the backend

## Conventions

- Keep every file under 500 lines; split by responsibility, not by size.
- One exported component per file, named after the file. Shared pieces go up (`components/`, `features/appointments/`), never sideways between role folders.
- Import across folders with the `@/` alias and through the `@/api` and `@/components/ui` barrels; use relative imports only inside a folder.
- Screens never call `call()` directly; add a typed function to `api/endpoints.ts` instead.

## Dependencies

- Runtime: React 19 and React DOM 19
- Styling: Tailwind CSS v4 with the `@tailwindcss/vite` plugin
- Build tooling: Vite 8, TypeScript 5.7, and `@vitejs/plugin-react`
- Formatting: Prettier (`npm run format -- <paths>`, config in `.prettierrc.json`); type-check with `npm run typecheck`

## Styling

This project uses **Tailwind CSS v4** through the `@tailwindcss/vite` plugin configured in `vite.config.ts`. `src/index.css` imports Tailwind with `@import 'tailwindcss';`. Use Tailwind utility classes directly in JSX and put global CSS or Tailwind v4 theme customization in `src/index.css`. This scaffold does not need a Tailwind config file or PostCSS config.

`src/main.tsx` imports `src/index.css`, so global font wiring belongs in `src/index.css`. Keep CSS `@import` statements first, then add any `@font-face` rules and font-family defaults there.

## Code quality

- Use double quotes for strings containing apostrophes (`"We're here to help"`), or escape them in single-quoted strings. An unescaped apostrophe in a single-quoted string breaks the build.
- Ensure JSX tags are closed and braces are balanced.
- Export components as default exports.

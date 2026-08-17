# @devkit-inc/theme-tokens

The theme token contract and the two base palettes every theme inherits from.

`tokens.ts` is the authority for which CSS custom properties a theme may set; `base.ts`
supplies a value for all of them in light and dark. Both were extracted from
`@devkit-inc/react-ui` so that `@sbrain-inc/comp-runtime` could consume them too —
comps load across a module-federation boundary, and depending on react-ui at runtime is
exactly the coupling that split exists to prevent.

**This package has no dependencies, and must not gain any.** That is the whole reason it
can be extracted. Not react, not supabase.

## Use

```ts
import { ALL_TOKENS, BASE, isThemeToken } from '@devkit-inc/theme-tokens'
```

- `ALL_TOKENS` — every token name, in group order. Consumers resolve against this.
- `BASE.light` / `BASE.dark` — complete palettes. A theme is a PARTIAL override over one.
- `isThemeToken(name)` — drops junk from hand-edited remote rows.

## Develop

```sh
npm install
npm test        # the contract assertions: base completeness, token shape
npm run build   # dual ESM + CJS via tsup
```

Published to `npm.pkg.github.com` as a private package. `prepublishOnly` builds and tests.

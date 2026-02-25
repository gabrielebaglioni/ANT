# ANT Figma Seed (From Scratch) — Mobile + Web App Shell

## Why this file exists

In questa sessione non posso creare un file Figma reale (manca accesso MCP Figma / OAuth / file target), quindi preparo un **seed Figma-ready** da cui ricostruire velocemente il design in Figma con frame, token e componenti già definiti.

Il codice frontend implementato segue questa struttura.

## Product intent

ANT è un'app multi-ente:

- Producer
- Carrier
- Receiver
- Supervisor / Admin
- Auditor

La UI deve:

- far scegliere subito organizzazione/identità/ruolo
- mostrare solo azioni consentite
- rendere i problemi leggibili (operatore + admin)
- essere veloce su smartphone (hamburger + profile menu)

## Frame map (Figma)

### Mobile frames (390 x 844)

1. `ANT / Mobile / Access / Loading`
2. `ANT / Mobile / Access / Profile Form`
3. `ANT / Mobile / Workspace / Home (Producer)`
4. `ANT / Mobile / Workspace / Home (Carrier)`
5. `ANT / Mobile / Workspace / Home (Receiver)`
6. `ANT / Mobile / Scan & Sign`
7. `ANT / Mobile / Timeline`
8. `ANT / Mobile / Verify`
9. `ANT / Mobile / Admin / Metrics + Requests`
10. `ANT / Mobile / Profile Menu Overlay`
11. `ANT / Mobile / Nav Drawer (Hamburger)`

### Desktop frames (1440 x 1024)

1. `ANT / Desktop / Access / Profile Form`
2. `ANT / Desktop / Workspace / Home`
3. `ANT / Desktop / Create Shipment`
4. `ANT / Desktop / Scan & Sign`
5. `ANT / Desktop / Timeline`
6. `ANT / Desktop / Verify`
7. `ANT / Desktop / Admin Console`
8. `ANT / Desktop / Profile Menu Overlay`

## Design tokens (map to current app)

### Colors

- `bg/base`: `#f4f0e6`
- `bg/panel`: `#ffffff`
- `ink/primary`: `#111111`
- `ink/muted`: `#5d5a52`
- `line/default`: `rgba(17,17,17,0.10)`
- `accent/primary`: `#0f766e`
- `accent/primary-dark`: `#115e59`
- `accent/warn`: `#d97706`
- `accent/info`: `#0ea5e9`
- `state/success`: `#047857`
- `state/danger`: `#b91c1c`

### Radius

- `r/s`: `10`
- `r/m`: `14`
- `r/l`: `16`
- `r/xl`: `20`
- `r/pill`: `999`

### Spacing

- `space/2`: `8`
- `space/3`: `12`
- `space/4`: `16`
- `space/5`: `20`
- `space/6`: `24`

### Typography

- Font family: `Space Grotesk` (fallback `IBM Plex Sans`)
- `heading/xl`: 28–44 responsive
- `heading/l`: 18
- `heading/m`: 16
- `body`: 14
- `caption`: 12

## Components to build in Figma

1. `Topbar`
   - left: hamburger (mobile), product title, env line
   - right: profile avatar trigger

2. `Profile Menu Overlay`
   - identity summary
   - org/tenant/DID/roles
   - actions:
     - sync actor to Scan & Sign
     - change access profile

3. `Nav Tab Card`
   - label + description
   - active/inactive states

4. `Access Profile Form`
   - profile selector (prefilled)
   - org/tenant/identity/DID fields
   - auth mode selector
   - demo PIN field
   - “remember on device”
   - primary CTA

5. `Role Dashboard Card`
   - title
   - description
   - CTA buttons
   - checklist

6. `State Panel`
   - variants: `ok`, `warning`, `error`, `info`
   - operator copy + admin note

7. `Bottleneck Banner`
   - variants: `none/info/pending/alert`
   - CTA optional

8. `Event Card`
   - pipeline stage badge
   - proof badge
   - What/Where/When/Why grid
   - payload details disclosure

9. `Ops Metric Tile`
   - title + numeric value

## Interaction flows (prototype)

### Access flow

1. Loading splash (700ms)
2. Access profile form
3. Select prefilled profile
4. CTA `Accedi al workspace`
5. Route to role dashboard default:
   - Producer -> Create
   - Carrier/Receiver -> Scan & Sign
   - Supervisor/Auditor -> Admin (or Home)

### Mobile navigation

- Hamburger opens nav drawer / stacked tabs
- Profile avatar opens profile menu overlay
- Overlay closes on action/navigation

### Security / governance cues

- Show tenant and persona always in topbar/profile menu
- Show shipment context when selected
- Show block/reconciliation state before action buttons
- Distinguish operator instructions vs admin notes

## Figma build instructions (manual)

1. Create a new Figma file `ANT App Shell`
2. Add local styles/variables for tokens above
3. Build components in the order listed
4. Create mobile and desktop frames
5. Apply auto-layout to:
   - topbar
   - tab grid
   - cards
   - forms
6. Create variants for:
   - buttons (`default`, `primary`, `warn`)
   - banners (`ok`, `info`, `pending`, `alert`)
   - state panels (`ok`, `warning`, `error`, `info`)
7. Build prototype links for access -> dashboard -> role actions

## Mapping to implemented code

- App shell/topbar/nav/profile menu:
  - `/Users/gabrielebaglioni/ANT/apps/web/src/App.tsx`
- Access form:
  - `/Users/gabrielebaglioni/ANT/apps/web/src/components/AccessLoginScreen.tsx`
- Role dashboard:
  - `/Users/gabrielebaglioni/ANT/apps/web/src/pages/Home/index.tsx`
- Authz capability matrix:
  - `/Users/gabrielebaglioni/ANT/apps/web/src/workspace/authz.ts`
- Tokens/styles:
  - `/Users/gabrielebaglioni/ANT/apps/web/src/styles.css`


# ANT Mobile-First UI Decisions (Figma MCP Guided)

## Figma MCP status
- Source link analyzed: `https://www.figma.com/design/OqAUeSg9ayJXvNK893RPmx/Untitled?node-id=0-1&t=4MLDkmH1mNyzSLhR-1`
- `get_metadata(fileKey=OqAUeSg9ayJXvNK893RPmx,nodeId=0:1)` returned only empty page metadata (`Page 1`)
- `get_screenshot` confirms empty canvas (no target UI layers yet)
- `get_design_context` cannot proceed on empty page (`nothing selected`)

## Temporary design source of truth (until Figma file is populated)
- Product requirements from ANT scope (mobile-first access, role-based dashboard, operator speed, auditability)
- Figma MCP-generated flow diagram (FigJam) for onboarding/navigation sequence
- Implemented React/CSS UI in `apps/web/src/*`

## Flow (implemented)
1. Splash / loading screen (brand + secure workspace messaging)
2. Access selection (organization / identity / role through demo profile presets)
3. Mock security handshake (OIDC login -> wallet connect -> DID binding)
4. Enter workspace (session persisted locally)
5. Role-specific dashboard + role-filtered navigation

## Mobile-first UI decisions
### App shell
- Sticky topbar with brand mark, environment label, profile trigger
- Bottom navigation on mobile for primary tasks (`Workspace`, `Create`, `Scan`, `Timeline`, `Verify`)
- Hamburger drawer for full navigation and role switching support
- Safe-area padding via `env(safe-area-inset-*)` for iOS/Android devices

### Access / onboarding
- Preset role cards are primary interaction (fast selection in the field)
- Advanced identity/tenant fields are collapsible to reduce cognitive load
- Handshake split into explicit steps with progress chips and statuses
- Device persistence enabled (`localStorage`) to simulate app-like continuity

### Role dashboards
- Dashboard is not generic: content and CTA priorities depend on persona
- Quick actions are large tap targets for field operators
- Readability focus: plain-language capability/limitation lists and issue guidance
- Shared shipment context visible in role home for faster cross-tab work

## Security/operational UX decisions
- QR payload only includes shipment reference + checksum (no sensitive payloads)
- Handover is presented as staged/finalized flow to avoid false success impressions
- Admin actions are conceptually separated from operator actions (governance, dispute, compensation)
- Problem descriptions are user-readable first, technical detail second

## Mapping to current implementation
- Access shell: `apps/web/src/components/AccessLoginScreen.tsx`
- App shell / mobile nav / profile menu: `apps/web/src/App.tsx`
- Role dashboard: `apps/web/src/pages/Home/index.tsx`
- Visual system + mobile-first layout: `apps/web/src/styles.css`

## Next Figma step (when file is ready)
1. Create frame(s) in the shared Figma file for:
   - Splash
   - Access form
   - Role dashboards (Producer / Carrier / Receiver / Supervisor / Auditor)
2. Send exact frame links (node IDs)
3. Re-run Figma MCP `get_design_context` + `get_screenshot` on each frame
4. Refine code to match Figma 1:1

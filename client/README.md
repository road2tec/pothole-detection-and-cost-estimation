# RoadSight web client

React 19 + Vite + TypeScript + Tailwind CSS 4, TanStack Query, React Router, React Hook Form + Zod,
Radix primitives, Recharts, Leaflet/OpenStreetMap.

```bash
npm install
npm run dev        # http://localhost:5173 — proxies /api to http://localhost:4000
npm test           # Vitest + Testing Library
npm run build      # type-check and production build to dist/
```

* `src/pages/public` — landing, product, features, how it works, methodology, help
* `src/pages/auth` — sign in, request access, forgot / reset password
* `src/pages/app` — role-based application pages
* `src/components/ui` — design-system primitives; `src/components/domain.tsx` — badges, authorised images
* `src/features` — auth context, shared filters, charts, map markers
* `src/lib/api.ts` — API client (in-memory access token, refresh via HttpOnly cookie)

Landing-page images in `public/images` are real model outputs on CC BY 4.0 photographs
(Roboflow `pothole-detection-irkz9` via `keremberke/pothole-segmentation`).

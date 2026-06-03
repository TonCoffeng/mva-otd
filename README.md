# mva-otd

**OTD-module** van MVA Intelligence — Opdracht tot dienstverlening (verkoop & aankoop).
Onderdeel van de tegel **Operatie** (Leadpool → OTD → … → factuur).

## Stack
- **Frontend:** statische HTML (`public/index.html`), Leadpool-huisstijl (navy `#1A2B5F` / oranje `#E8500A`, Roboto)
- **Hosting:** Netlify, auto-deploy vanaf `main`, publish-dir `public/`
- **Database:** Supabase-project **MVA-OTD** (`oonlagagxodohvakwfat`) — alle OTD-data
- **Auth:** Supabase Auth tegen het **Leadpool-project** (`olfcrzusdkijxroxvsgm`) = centrale identiteit. Schakelbare auth-laag; gaat over naar portal cross-app SSO (cookie op `.makelaarsvan.nl`) zodra DNS rond is.
- **PDF:** HTML → PDF (WeasyPrint)
- **Ondertekenen:** Signhost (Entrust Netherlands)

## Structuur
```
/
├── public/
│   └── index.html        ← frontend: dossieroverzicht + OTD-bouwer met live preview
├── netlify/functions/    ← API (volgt in stap 3)
└── netlify.toml
```

## Subdomein
`otd.makelaarsvan.nl` — CNAME → Netlify, via Designate (na eerste deploy).

## Status
In aanbouw. Architectuurbesluiten staan in `MVA_Intelligence_Technische_Manual.md` (Beslissingenlog).

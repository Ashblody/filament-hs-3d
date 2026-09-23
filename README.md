# Filament / HS 3D

Mobilna PWA za **Andreja (Ashblody)**: zaloga filamenta, NFC/QR oznake in kalkulator cene 3D tiska (formule iz HS Pricing Sheet).

**Živa stran:** https://ashblody.github.io/filament-hs-3d/

## Kaj je notri

1. **Zaloga** — tuljave v `localStorage` (material, barva, znamka, preostanek g/%, €/kg, opombe, NFC ID).
2. **NFC + QR** — branje/pisanje NFC (Chrome Android) in QR kot rezervna pot.
3. **Kalkulator** — cena tiska: filament, elektrika, amortizacija, priprava, naknadna obdelava, izmet, marža.

## Namestitev PWA (Add to Home Screen)

1. Odpri https://ashblody.github.io/filament-hs-3d/ v **Chrome** (Android) ali Safari (iOS).
2. Android: meni ⋮ → **Dodaj na začetni zaslon** / **Namesti aplikacijo**.
3. iOS Safari: deli → **Dodaj na začetni zaslon**.
4. Odpri ikono — aplikacija teče v celozaslonskem načinu, podatki ostanejo na telefonu.

## Kako zapisati NFC tag (Chrome Android)

1. Omogoči NFC v nastavitvah telefona.
2. Odpri to PWA v **Chrome** (ne v aplikaciji iz trgovine — potreben je Chrome z Web NFC).
3. V **Zaloga** odpri tuljavo (ali jo ustvari in shrani).
4. Tapni **Zapiši NFC**.
5. Približaj **prazno / prepisovalno** NFC nalepko hrbtu telefona.
6. Počakaj sporočilo »NFC zapisan«. Oznaka vsebuje URL:
   `https://ashblody.github.io/filament-hs-3d/#spool/<id>`
7. Preveri: zavihek **NFC** → **Preberi NFC oznako** → odpre se ista tuljava.
8. Če NFC ni na voljo: uporabi **QR** (natisni iz urejevalnika) in skeniraj v zavihku NFC.

## Kaj preveriti (številke vs Excel)

Vzorec iz HS Pricing Sheet:

| Vhod | Vrednost |
|------|----------|
| Tiskalnik | Prusa CORE ONE INDX |
| Filament | PLASTIKA TRCEK PLA (21 €/kg) |
| Teža | 61,46 g |
| Čas | 3:46 |
| Priprava | 20 min |
| Naknadna | 10 min |
| Potrošni | 0 € |
| Marža | 1,5 |
| Izmet | 20 % |

**Pričakovana predlagana cena ≈ 25,90 €.**

V kalkulatorju tapni **Naloži vzorec** in primerjaj z Excelom.

## Razvoj

```bash
npm install
npm run dev
npm run build
```

`base` za GitHub Pages: `/filament-hs-3d/`.

## Zasebnost

Ni strežnika in ni skrivnosti. Vse je lokalno v brskalniku. Brisanje podatkov spletišča zbriše zalogo.

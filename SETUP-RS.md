# Postavljanje — korak po korak

Ovaj dokument je za tebe, na srpskom. Sam sajt i sav sadržaj koji vide korisnici su na engleskom.

Ceo projekat se nalazi u folderu `C:\Users\jelen\Documents\media-grant-radar`.

---

## Šta ti je potrebno pre početka

1. **GitHub nalog** — besplatan, na [github.com](https://github.com). Ako KRIK već ima organizacioni nalog, bolje je da repozitorijum bude tamo nego na ličnom.
2. **Anthropic API ključ** — na [console.anthropic.com](https://console.anthropic.com), pod *API Keys → Create Key*. Ovo je plaćena usluga, odvojena od Claude pretplate. Procena troška je u `README.md`, sekcija *Cost* — sa podrazumevanim podešavanjima oko 250–300 dolara mesečno, ali se lako spušta na 50–80 promenom tri podešavanja. Preporučujem da u konzoli odmah postaviš i **spending limit**, da te ne iznenadi.

---

## Korak 1 — napravi repozitorijum

Na GitHub-u klikni **New repository**:

- ime: `media-grant-radar`
- vidljivost: **Public** (GitHub Pages je besplatan samo za javne repozitorijume)
- **nemoj** čekirati "Add a README file" — već ga imamo

---

## Korak 2 — ubaci fajlove

Ovde imaš dva puta.

### Put A — preko Git-a (preporučeno, lakše za kasnije)

Na tvom računaru trenutno nema instaliran Git. Ako mi kažeš, instaliraću ga i obaviti ceo ovaj korak umesto tebe. Komande koje bi se izvršile:

```bash
git init
git add .
git commit -m "Media Grant Radar"
git branch -M main
git remote add origin https://github.com/KORISNICKO-IME/media-grant-radar.git
git push -u origin main
```

### Put B — prevlačenjem kroz browser (bez instalacije ičega)

Na stranici praznog repozitorijuma klikni **uploading an existing file**, pa prevuci sav sadržaj foldera `media-grant-radar`.

Pazi na dve stvari:
- prevuci **sadržaj** foldera, ne sam folder;
- folderi koji počinju tačkom (`.github`, kao i fajlovi `.gitignore` i `.nojekyll`) su u Windows Exploreru možda sakriveni. Uključi *View → Show → Hidden items* pre nego što prevučeš. Bez foldera `.github` automatika neće raditi uopšte.

---

## Korak 3 — uključi GitHub Pages

U repozitorijumu: **Settings → Pages**.

Pod *Build and deployment → Source* izaberi **GitHub Actions**. Ništa drugo ne diraj.

---

## Korak 4 — unesi API ključ

**Settings → Secrets and variables → Actions → New repository secret**

- Name: `ANTHROPIC_API_KEY`
- Secret: tvoj ključ sa console.anthropic.com

Ključ se posle unosa više ne može pročitati ni tebi ni bilo kome — to je u redu, tako i treba.

---

## Korak 5 — pokreni prvi prolaz ručno

**Actions → Daily grant sweep → Run workflow**

Uključi opciju **all** (da obiđe baš sve izvore, ne samo one koji su "na redu") i pokreni.

Prvi prolaz traje dvadesetak minuta jer obilazi svih 80 izvora i najskuplji je — kasnije se dnevno proverava oko 18 izvora.

Kad se završi, sajt je na:

```
https://KORISNICKO-IME.github.io/media-grant-radar/
```

Od tog trenutka se sve dešava samo: svakog dana u 04:10 UTC (06:10 po Beogradu leti, 05:10 zimi) sweep se pokrene, ažurira bazu i ponovo objavi sajt.

---

## Korak 6 — smanji trošak ako je potrebno

Posle nedelju dana pogledaj u Anthropic konzoli koliko stvarno košta i uporedi sa tim koliko poziva sweep zaista pronalazi.

**Settings → Secrets and variables → Actions → Variables → New repository variable**

| Ime | Podrazumevano | Jeftinija vrednost |
|---|---|---|
| `RESEARCH_MODEL` | `claude-opus-5` | `claude-sonnet-5` |
| `RESEARCH_EFFORT` | `high` | `medium` ili `low` |
| `MAX_SEARCHES` | `8` | `4` |

Nema potrebe da diraš kod — promena varijable važi od sledećeg prolaza.

Druga poluga je fajl `data/sources.json`: podigni `tier` izvora sa 1 na 3 i proveravaće se jednom nedeljno umesto svakog dana.

---

## Svakodnevno korišćenje

**Za tebe kao projektnog menadžera:** otvori sajt, izaberi *Serbia* i *Media outlet*, i sačuvaj taj link kao bookmark — filteri se pamte u adresi. Dugme *Download CSV* izvozi trenutni spisak u tabelu koju možeš proslediti kolegama ili ubaciti u interni plan prijava.

**Za frilensere:** isti sajt, ali *Freelancer* umesto *Media outlet*. Taj link im možeš jednostavno poslati:
`.../media-grant-radar/?country=RS&applicant=freelancer`

---

## Kako da dodaš fondaciju koju sam propustio

Otvori `data/sources.json` direktno na GitHub-u (ikonica olovke), dodaj još jedan objekat u listu i sačuvaj. Sledeći prolaz je automatski uključuje — kod se ne dira.

```json
{
  "id": "kratka-oznaka",
  "name": "Ime kako treba da stoji na kartici",
  "kind": "funder",
  "tier": 2,
  "url": "https://primer.org/grants",
  "scope": ["europe-western-balkans"]
}
```

---

## Dve stvari koje treba da znaš o podacima

**Seed baza nije verifikovana.** Ono što je trenutno u `data/grants.json` sam napisao pre postavljanja. Oko trećine unosa sam danas proverio kroz pretragu i nose oznaku `"confidence": "high"`; ostali nose `"confidence": "low"` i na sajtu im stoji žuta oznaka *Verify on the funder's site*. Prvi automatski prolaz ih zamenjuje proverenim podacima.

**Sajt je pomoćno sredstvo, ne evidencija.** Rokovi se pomeraju, pozivi se povlače usred kruga, uslovi se menjaju između rundi a da stranica ne bude ažurirana. Svaka kartica nosi datum poslednje provere. Pre nego što uložiš vreme u prijavu, uvek otvori stranicu same fondacije.

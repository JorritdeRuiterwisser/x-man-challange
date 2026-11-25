# X-man challenge: in gebruik nemen

De site bestaat uit losse bestanden (geen installatie nodig). De gegevens staan in Supabase, de site zelf op GitHub Pages. Beide gratis.

## 1. Sleutel invullen
Open `js/config.js` en vervang `PLAK_HIER_JE_PUBLISHABLE_SLEUTEL` door je publieke sleutel
(Supabase > Project Settings > API Keys > "Publishable key", begint met `sb_publishable_`).
Gebruik nooit de "secret" sleutel. Het projectadres staat er al in.

## 2. Database aanmaken
1. Supabase > **SQL Editor** > **New query**.
2. Plak de hele inhoud van `schema.sql` en klik **Run**.
3. Plak daarna in een nieuwe query: `select app_private.create_first_admin('Jorrit');` en klik **Run**.
   Het resultaat is je geheime code. Bewaar die.

## 3. Op GitHub Pages zetten
1. Maak op github.com een nieuwe **public** repository (bijv. `xman-challenge`).
2. Kies **Add file > Upload files** en sleep alle bestanden en mappen uit deze map erin (zonder `tests/`, dat mag ook). Klik **Commit**.
3. **Settings > Pages**: Source = *Deploy from a branch*, branch `main`, map `/ (root)`. Na een minuut staat de site op `https://JOUWNAAM.github.io/xman-challenge/`.

## 4. Inloggen en deelnemers toevoegen
- Jouw beheerlink: `https://JOUWNAAM.github.io/xman-challenge/#t=JOUW_CODE`. Open die op je telefoon; de site onthoudt je daarna.
- Ga naar **Beheer > Deelnemer toevoegen**. Je krijgt een persoonlijke link om via WhatsApp te sturen (je ziet hem maar één keer; kwijt = "Nieuwe link").
- Stel per deelnemer de doelen in via **Doelen**.
- Een tweede beheerder maak je met **Maak beheerder**.

## Bugs oplossen
Pas het bestand aan en upload het opnieuw naar GitHub (zelfde naam). De gegevens staan in Supabase en blijven bewaard.
Beheerlink kwijt? SQL Editor: `select app_private.reset_member_token('Jorrit');`

## Later: pushmeldingen
De site is al installeerbaar (manifest). Pushmeldingen komen in een tweede ronde.

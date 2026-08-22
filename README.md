# Foto-Mission · Silberhochzeit Britta & Lutz

Eine private Foto-Mission zur Silberhochzeit von Britta und Lutz Barmbold: Gäste scannen einen QR-Code, erhalten eine passende Aufgabe und laden ihr Bild in ein geschütztes Album hoch.

Dazu kommt der Bereich **„Für Britta & Lutz“**: ein privater Upload für Fotos und kurze Videos, die niemals öffentlich erscheinen und dem Jubelpaar nach der Feier als Erinnerungsalbum übergeben werden.

## In drei Schritten einrichten

Voraussetzung: Node.js 22 oder neuer.

1. `npm run setup` ausführen.
2. `http://localhost:5174` öffnen und Name, Alter, Titel, Datum und öffentliche Webadresse eintragen. Ein Absender sowie Supabase sind optional.
3. Mit `npm test` prüfen und mit `npm start` lokal ansehen.

Name und Alter werden automatisch in Überschriften, Texten, Missionen und dem Hintergrunddesign eingesetzt. Aus der Webadresse entsteht der QR-Code.

## Foto-Upload aktivieren

Ohne Supabase läuft die Seite sicher im Demo-Modus; es wird nichts hochgeladen. Für echte Uploads:

1. Ein Supabase-Projekt anlegen.
2. `supabase/setup.sql` vollständig im SQL Editor ausführen.
3. Unter Authentication einen Admin-Benutzer anlegen.
4. Diesen Benutzer im SQL Editor als Album-Admin eintragen:

   ```sql
   insert into public.album_admins (user_id, note)
   select id, 'Album-Admin' from auth.users
   where email = 'DEINE-EMAIL@BEISPIEL.DE'
   on conflict (user_id) do nothing;
   ```

5. `npm run setup` erneut öffnen und Project URL sowie den öffentlichen Anon-/Publishable-Key eintragen.

Niemals einen `service_role`-Key oder ein Passwort in die Konfiguration schreiben. Der Storage-Bucket `party-photos` bleibt technisch privat und liefert der öffentlichen Galerie nur kurzlebige Bildlinks. Die normale Seite enthält den öffentlichen Galerie-Tab mit Kategorien und Herz-Rangliste. Die unverlinkte Administration liegt weiterhin unter `/album/` und ist durch die Admin-Anmeldung geschützt.

## Nach einem Update: `setup.sql` erneut ausführen

Nach jedem Update aus einer älteren Version muss `supabase/setup.sql` noch einmal **vollständig** im SQL Editor laufen. Die Datei ist so gebaut, dass sie gefahrlos mehrfach ausgeführt werden kann: Sie löscht keine Fotos und keine Admin-Benutzer.

Ganz unten gibt die Datei zwei Prüfungen aus. In der zweiten müssen **alle vier Zeilen `vorhanden = true`** zeigen. Fehlt eine, macht sich das so bemerkbar:

| Fehlt | Was man auf der Seite merkt |
| --- | --- |
| `Galerie darf Fotoangaben lesen` | Die Galerie bleibt leer |
| `Galerie darf Bilddateien signieren` | Namen und Missionen stehen da, aber statt der Fotos bleiben graue Kacheln |
| `Funktion toggle_photo_vote` | Beim Tippen aufs Herz erscheint „Could not find the function public.toggle_photo_vote“ |
| `Funktion my_photo_votes` | Bereits vergebene Herzen werden nicht mehr angezeigt |

Bricht der Abschnitt „5. Sicherheitsregeln für den Speicher“ mit `must be owner of table objects` ab, dürfen Speicher-Regeln in diesem Projekt nicht per SQL angelegt werden. Dann werden sie im Dashboard eingetragen: **Storage → party-photos → Policies → New policy**, Vorgang `SELECT`, Rollen `anon` und `authenticated`, Bedingung:

```sql
bucket_id = 'party-photos' and name like 'party/%'
```

Genau diese Regel sorgt dafür, dass die Galerie die Bilder anzeigen kann. Testfotos (Ordner `test/`) bleiben davon ausgenommen und weiterhin nur für Admins sichtbar.

## Private Erinnerungen: „Für Britta & Lutz“

Neben der öffentlichen Foto-Mission gibt es einen zweiten, streng getrennten Weg. Über den Menüpunkt **„Für Britta & Lutz“** laden Gäste normale Fotos und kurze Videos hoch, die **niemals öffentlich erscheinen**: nicht in der Foto-Mission, nicht in der Galerie, und auch der Gast selbst kann sie nach dem Hochladen nicht mehr ansehen. Sie liegen in einem eigenen privaten Speicher und sind ausschließlich im Adminbereich sichtbar.

### Einmalige Einrichtung

1. `supabase/private-memories.sql` **vollständig** im SQL Editor ausführen (die erste Zeile muss `-- ====…` sein). Voraussetzung ist, dass `supabase/setup.sql` schon gelaufen ist – von dort kommt die Admin-Logik.
2. Ganz unten gibt die Datei zwei Prüfungen aus:
   * Die erste Abfrage muss **leer** bleiben. Erscheint dort eine Zeile, gilt eine alte Speicher-Regel für *jeden* Bucket und damit versehentlich auch für die privaten Aufnahmen.
   * In der zweiten müssen **alle sieben Zeilen `vorhanden = true`** zeigen.
3. Bricht der Abschnitt „7. Sicherheitsregeln für den privaten Speicher“ mit `must be owner of table objects` ab, die Regeln von Hand anlegen: **Storage → private-memories → Policies → New policy**.

   | Vorgang | Rollen | Bedingung |
   | --- | --- | --- |
   | `INSERT` | `anon`, `authenticated` | `bucket_id = 'private-memories'` |
   | `SELECT` | `authenticated` | `bucket_id = 'private-memories' and public.is_album_admin()` |
   | `DELETE` | `authenticated` | `bucket_id = 'private-memories' and public.is_album_admin()` |

   Es darf **keine** `SELECT`-Regel für `anon` geben – sonst könnten Gäste sich signierte Links auf fremde Aufnahmen erzeugen.

Der Bucket der Foto-Mission (`party-photos`) wird dabei nicht angefasst.

### Grenzen je Upload-Vorgang

| | Anzahl | Größe | Formate |
| --- | --- | --- | --- |
| Fotos | 20 | 15 MB je Datei | JPG, PNG, WebP, HEIC/HEIF |
| Videos | 5 | 45 MB je Datei | MP4, MOV, WebM |

Videos sollten etwa 30 Sekunden nicht überschreiten; der Hinweis steht schon vor der Dateiauswahl. Alle Werte stehen in `config/party-config.js` unter `memories.limits` – wer sie ändert, muss auch `supabase/private-memories.sql` anpassen, dort stehen dieselben Grenzen als Prüfung in der Datenbank.

Fotos und Videos werden **nicht verkleinert**. Britta und Lutz bekommen die Aufnahmen in Originalqualität, einschließlich der Aufnahmedaten der Kamera.

### Wie die Dateien abgelegt werden

Jeder abgeschlossene Upload bekommt einen eigenen Ordner aus Datum, Uhrzeit (deutsche Zeit), bereinigtem Namen und einer UUID:

```text
uploads/2026-08-29/20-14-35__linus-uhlhorn__550e8400-e29b-41d4-a716-446655440000/
├── fotos/
│   ├── 01_foto.jpg
│   └── 02_foto.png
└── videos/
    └── 01_video.mp4
```

Der vollständige Name steht unverändert in der Datenbank; für den Pfad wird er auf Kleinbuchstaben, Ziffern und Bindestriche reduziert. Lädt derselbe Gast später erneut hoch, entsteht durch Uhrzeit und UUID automatisch ein neuer Ordner. Der Ordnername dient nur der Übersicht – der Schutz kommt allein aus dem privaten Bucket und den RLS-Regeln.

### Im Adminbereich

Unter `/album/` gibt es die Ansicht **„Private Erinnerungen“**. Pro Upload stehen dort Name, Datum, Uhrzeit, Nachricht, Anzahl Fotos und Videos, Gesamtgröße, Status und der Ordnerpfad. Aufgeklappt lassen sich Fotos als Vorschau ansehen, Videos abspielen, einzelne Dateien herunterladen oder löschen, der ganze Ordner als ZIP speichern und der komplette Upload samt Dateien entfernen. Unvollständige Uploads sind farblich markiert.

### Gesamtexport nach der Feier

Zwei Wege führen zum fertigen Erinnerungsalbum:

**Im Browser** – Knopf „Alle Erinnerungen herunterladen“ im Adminbereich. Ab etwa 800 MB kommt eine Rückfrage, weil das ZIP dafür vollständig in den Arbeitsspeicher muss.

**Lokal per Skript** – zuverlässiger bei vielen Videos:

```bash
cp .env.example .env        # einmalig
# SUPABASE_SERVICE_ROLE_KEY in der .env eintragen
npm run export-erinnerungen
```

Beide Wege erzeugen dieselbe Struktur:

```text
Britta-und-Lutz-Erinnerungen/
├── 2026-08-29_20-14-35_Linus-Uhlhorn/
│   ├── Fotos/
│   ├── Videos/
│   └── Nachricht.txt
├── 2026-08-29_21-03-12_Max-Mustermann/
│   └── …
└── upload-uebersicht.csv
```

Die CSV enthält Name, Nachricht, Datum, Uhrzeit, Anzahl Fotos, Anzahl Videos, Gesamtgröße, Ordnername und Status. Sie ist mit Semikolon getrennt und öffnet sich in Excel ohne Nachfrage.

> Der `service_role`-Key umgeht **alle** Sicherheitsregeln. Er gehört ausschließlich in die lokale `.env` (steht in `.gitignore`) und niemals ins Repository, ins Frontend oder in eine Nachricht. Die Website selbst braucht ihn nicht.

Das Skript lädt bereits vorhandene Dateien nicht erneut – ein abgebrochener Export lässt sich einfach noch einmal starten. Der Ordner `export/` bleibt lokal.

### Bereich abschalten

`memories.enabled: false` in `config/party-config.js` entfernt Menüpunkt, Seite und den Hinweis am Ende der Foto-Mission vollständig.

## Herzen in der Galerie

Jedes Gerät darf **pro Kategorie ein Herz** vergeben. Nochmal tippen nimmt es wieder weg; ein Herz auf ein anderes Foto derselben Kategorie lässt es dorthin umziehen. Die Regel steht in der Datenbank (eindeutiger Index auf `voter_id, mission_category`), nicht nur im Browser – ein geleerter Speicher oder ein zweiter Tab bringt also keine zusätzlichen Herzen.

## Veröffentlichen mit GitHub Actions

Der Workflow `.github/workflows/deploy.yml` testet und baut die App bei einem Push auf `main` und lädt sie anschließend per FTP hoch. In GitHub unter **Settings → Secrets and variables → Actions** werden `FTP_SERVER`, `FTP_USERNAME` und `FTP_PASSWORD` benötigt.

Die öffentliche Adresse ist `https://silberhochzeit-barmbold.ulhorn-webdesign.de/`. Der Workflow lädt derzeit nach `server-dir: ./`, weil die Subdomain direkt auf das FTP-Wurzelverzeichnis zeigen soll.

## Missionen und Design anpassen

Missionen, Kategorien, Farben und Effekte stehen in `config/party-config.js`. `{name}` und `{age}` sind dynamische Platzhalter. Missionen lassen sich mit `active: false` deaktivieren. IDs sollten nach ersten Uploads nicht mehr geändert werden.

Pro Gerät sind zwei reguläre Missionen und danach eine Bonus-Mission vorgesehen (`limits.regularMissionsPerDevice`, `limits.bonusMissionsPerDevice`). Danach ist niemand ausgesperrt: Wer mag, zieht freiwillig weitere Missionen (`limits.allowExtraMissions: false` schaltet das ab).

```bash
npm run setup  # Formular für die Grundkonfiguration
npm start      # lokale Vorschau
npm test       # automatische Prüfungen
npm run build  # Produktionsvorschau unter dist/

npm run export-erinnerungen  # privaten Gesamtexport auf die Festplatte holen
```

## Datenschutz

Die App nutzt kein Tracking und entfernt beim Verkleinern der Fotos Metadaten. Gäste müssen dem Upload aktiv zustimmen. Lesen und Löschen ist durch Supabase Row Level Security ausschließlich eingetragenen Album-Admins erlaubt.

Für die privaten Erinnerungen gilt zusätzlich: Sie werden **unverändert** gespeichert (also mit den Aufnahmedaten der Kamera), liegen in einem eigenen privaten Bucket und sind für Gäste weder auflistbar noch herunterladbar. Auch signierte Links kann dort nur ein angemeldeter Album-Admin erzeugen.

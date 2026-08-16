# Foto-Mission · Silberhochzeit Britta & Lutz

Eine private Foto-Mission zur Silberhochzeit von Britta und Lutz Barmbold: Gäste scannen einen QR-Code, erhalten eine passende Aufgabe und laden ihr Bild in ein geschütztes Album hoch.

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

Nach einem Update aus einer älteren Version `supabase/setup.sql` erneut vollständig im SQL Editor ausführen. Das ergänzt die Herz-Wertungen und die Leseregeln für die öffentliche Galerie, ohne bestehende Fotos oder Admin-Benutzer zu löschen.

## Veröffentlichen mit GitHub Actions

Der Workflow `.github/workflows/deploy.yml` testet und baut die App bei einem Push auf `main` und lädt sie anschließend per FTP hoch. In GitHub unter **Settings → Secrets and variables → Actions** werden `FTP_SERVER`, `FTP_USERNAME` und `FTP_PASSWORD` benötigt.

Die öffentliche Adresse ist `https://silberhochzeit-barmbold.ulhorn-webdesign.de/`. Der Workflow lädt derzeit nach `server-dir: ./`, weil die Subdomain direkt auf das FTP-Wurzelverzeichnis zeigen soll.

## Missionen und Design anpassen

Missionen, Kategorien, Farben und Effekte stehen in `config/party-config.js`. `{name}` und `{age}` sind dynamische Platzhalter. Missionen lassen sich mit `active: false` deaktivieren. IDs sollten nach ersten Uploads nicht mehr geändert werden.

```bash
npm run setup  # Formular für die Grundkonfiguration
npm start      # lokale Vorschau
npm test       # automatische Prüfungen
npm run build  # Produktionsvorschau unter dist/
```

## Datenschutz

Die App nutzt kein Tracking und entfernt beim Verkleinern der Fotos Metadaten. Gäste müssen dem Upload aktiv zustimmen. Lesen und Löschen ist durch Supabase Row Level Security ausschließlich eingetragenen Album-Admins erlaubt.

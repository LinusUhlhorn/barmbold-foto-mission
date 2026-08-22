# Die Sicherheitsregeln selbst nachprüfen

Die Regeln in `setup.sql` und `private-memories.sql` entscheiden, wer welche
Fotos sehen darf. Damit man sich darauf nicht nur verlassen muss, lassen sie
sich hier gegen eine echte Postgres-Datenbank durchspielen – ganz ohne das
Supabase-Projekt anzufassen.

## Voraussetzung

PostgreSQL 14 oder neuer, lokal installiert (`psql` muss aufrufbar sein).

## Ablauf

```bash
# 1. Eine leere Testdatenbank anlegen
createdb probe

# 2. Die Teile von Supabase nachbauen, die die SQL-Dateien voraussetzen
psql -d probe -f supabase/pruefung/01-supabase-nachbau.sql

# 3. Die beiden echten Dateien einspielen
psql -v ON_ERROR_STOP=1 -d probe -f supabase/setup.sql
psql -v ON_ERROR_STOP=1 -d probe -f supabase/private-memories.sql

# 4. Die Regeln durchspielen
psql -d probe -f supabase/pruefung/02-regeln-pruefen.sql
```

In der Ausgabe von Schritt 4 muss **jede Zeile mit `OK` beginnen**. Geprüft
wird unter anderem:

* Ein Gast darf einen Upload anlegen und Dateien eintragen – aber nur in
  seinem eigenen Ordner.
* Ein Gast kann sich nicht selbst auf „vollständig“ setzen.
* Ein Gast kann die privaten Erinnerungen weder auflisten noch herunterladen,
  ändern oder löschen.
* Ein angemeldeter Benutzer, der **nicht** in `album_admins` steht, sieht
  ebenfalls nichts.
* Ein Album-Admin sieht alles und kann löschen; die Dateieinträge verschwinden
  dabei automatisch mit.
* Die öffentliche Foto-Mission funktioniert unverändert weiter.

Danach aufräumen mit `dropdb probe`.

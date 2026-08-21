// Eine gemeinsame Quelle dafür, WAS auf den Webserver hochgeladen wird.
//
// Diese Liste wird an zwei Stellen verwendet:
//   1. .github/workflows/deploy.yml  (der echte FTP-Upload)
//   2. tools/build.js                (die Vorschau unter dist/)
//
// Ein Test (tests/deploy.test.js) prüft, dass beide Listen übereinstimmen.
// So kann nicht versehentlich etwas hochgeladen werden, das nicht dorthin gehört.

/**
 * Muster, die NICHT auf den Webserver gehören.
 * Die Schreibweise entspricht der von SamKirkland/FTP-Deploy-Action.
 */
export const FTP_EXCLUDES = [
  // Git und GitHub
  '**/.git*',
  '**/.git*/**',
  '**/.github/**',
  // Werkzeuge und Abhängigkeiten
  '**/node_modules/**',
  '**/.claude/**',
  '**/tools/**',
  '**/tests/**',
  '**/dist/**',
  // Entwicklungsdateien
  '**/package.json',
  '**/package-lock.json',
  '**/README.md',
  '**/LICENSE',
  // Lokale Umgebungsdateien mit Zugangsdaten
  '**/.env',
  '**/.env.*',
  '**/*.local',
  // Die SQL-Datei wird in Supabase ausgeführt, nicht im Browser gebraucht.
  '**/supabase/**',
  // Betriebssystem-Reste
  '**/.DS_Store',
  '**/Thumbs.db',
];

/**
 * Dateien und Ordner, die auf dem Webserver liegen MÜSSEN.
 * Fehlt hier etwas, schlägt der Build fehl.
 */
export const REQUIRED_FILES = [
  'index.html',
  // Sagt dem Webserver, dass Seiten, Stile und Programmcode vor dem
  // Verwenden kurz gegengeprueft werden muessen (siehe .htaccess).
  '.htaccess',
  'qr-print.html',
  'album/index.html',
  'robots.txt',
  'config/party-config.js',
  'assets/css/base.css',
  'assets/css/app.css',
  'assets/css/album.css',
  'assets/css/print.css',
  'assets/js/app.js',
  'assets/js/album.js',
  'assets/js/qr-print.js',
  'assets/img/favicon.svg',
];

/**
 * Ordner, deren Inhalt komplett mit hochgeladen wird.
 */
export const DEPLOY_DIRECTORIES = ['assets', 'config', 'album'];

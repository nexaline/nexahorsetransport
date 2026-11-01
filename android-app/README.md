# Nexa Team – Android APK

The APK is a small Android shell that opens the Nexa Team App at https://nexahorsetransport.ca/app/
(so every update to the web app reaches the phones automatically; the APK itself rarely needs rebuilding).

Built by GitHub Actions (`.github/workflows/build-apk.yml`) whenever this folder changes, or by hand:
Actions > "Build Nexa Team APK" > Run workflow. The APK is attached to the GitHub release `team-app-apk`.

Install on Android: open the release link on the phone, download `nexa-team.apk`, allow "Install unknown apps"
for the browser when asked, and install. Then allow Location and Camera when the app asks.

# Copilot repository instructions

## Project overview
- This is a small, static PWA (HTML/CSS/vanilla JS) that fetches stookadvies data from the RIVM WFS endpoint.
- Keep changes lightweight and dependency-free unless explicitly requested.

## Coding standards
- Prefer clear, readable vanilla JS. No build tools.
- Preserve existing UI/UX and styling conventions.
- Avoid reformatting unrelated code.

## Data + time handling
- The dataset uses Europe/Amsterdam time. Keep all parsing/formatting in that timezone.
- Prefer deterministic rendering; avoid nondeterministic DOM updates when async requests race.

## Security + accessibility
- External links that open a new tab must include rel="noopener noreferrer".
- Keep ARIA labels up to date when changing UI text or controls.

## Service worker
- Keep the app-shell cache small and versioned.
- Avoid caching cross-origin API responses.
- Bump CACHE_VERSION when app-shell files change (index.html, style.css, stookwijzer.js, manifest, icons). No bump needed for non-cached changes.

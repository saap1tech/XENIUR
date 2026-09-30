# Actual document previews

These eight PNGs are rendered from real XeLaTeX output: four font specimens and four layout specimens. They show sample content, not completed research. Font files and licenses are in `brand/fonts/`.

Regenerate from the project root with Node 22:

```
node --import tsx scripts/render-document-previews.ts
```

The script uses the production document renderer and requires XeLaTeX and `pdftoppm` on the host. Specimens intentionally stay fixed so choosing a style requires no model call. The actual document uses the person's content, selected font, selected layout and palette.

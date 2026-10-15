/** Kept behind the PDF export's dynamic import: no font downloads at startup. */
export async function loadPdfScriptFonts(): Promise<Uint8Array[]> {
  const urls = await Promise.all([
    import("@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-400-normal.woff?url"),
    import("@fontsource/noto-sans-hebrew/files/noto-sans-hebrew-hebrew-400-normal.woff?url"),
    import("@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff?url"),
    import("@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-400-normal.woff?url"),
    import("@fontsource/noto-sans-gujarati/files/noto-sans-gujarati-gujarati-400-normal.woff?url"),
    import("@fontsource/noto-serif-gurmukhi/files/noto-serif-gurmukhi-gurmukhi-400-normal.woff?url"),
    import("@fontsource/noto-sans-tamil/files/noto-sans-tamil-tamil-400-normal.woff?url"),
    import("@fontsource/noto-sans-telugu/files/noto-sans-telugu-telugu-400-normal.woff?url"),
    import("@fontsource/noto-sans-kannada/files/noto-sans-kannada-kannada-400-normal.woff?url"),
    import("@fontsource/noto-sans-malayalam/files/noto-sans-malayalam-malayalam-400-normal.woff?url"),
    import("@fontsource/noto-sans-oriya/files/noto-sans-oriya-oriya-400-normal.woff?url"),
  ]);
  return Promise.all(urls.map(async ({ default: url }) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Could not load the PDF script fonts. Please retry the download");
    return new Uint8Array(await response.arrayBuffer());
  }));
}

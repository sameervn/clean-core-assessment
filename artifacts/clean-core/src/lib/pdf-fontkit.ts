import { create } from "fontkit";
import type { Font } from "fontkit";
import type { Fontkit } from "pdf-lib/es/types/fontkit";
import { installShaper } from "./pdf-shaping";

export function createFont(bytes: Uint8Array): Font {
  const font = create(bytes as Parameters<typeof create>[0]);
  if (!("layout" in font)) throw new Error("PDF font collections are not supported");
  installShaper(font, bytes);
  return font;
}

/** Adapt modern Fontkit's synchronous subset encoder to pdf-lib's stream API. */
export const pdfFontkit = {
  create(bytes: Uint8Array) {
    const font = createFont(bytes);
    const createSubset = font.createSubset.bind(font);
    font.createSubset = () => {
      const subset = createSubset();
      return Object.assign(subset, {
        encodeStream() {
          const handlers = new Map<string, (data?: Uint8Array | unknown) => void>();
          const stream = {
            on(event: string, handler: (data?: Uint8Array | unknown) => void) {
              handlers.set(event, handler);
              return stream;
            },
          };
          queueMicrotask(() => {
            try {
              handlers.get("data")?.(subset.encode());
              handlers.get("end")?.();
            } catch (error) {
              handlers.get("error")?.(error);
            }
          });
          return stream;
        },
      });
    };
    return font;
  },
} as unknown as Fontkit;

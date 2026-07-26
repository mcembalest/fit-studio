// Image generation. Findings from benchmarking these models against real looks
// from her sessions:
//
//   * TRY-ON uses gpt-image-2. It is the only model that reliably frames a full
//     head-to-toe shot; gpt-image-1.5 crops around mid-calf. It also reproduces
//     an unfamiliar garment from a single reference most accurately.
//   * REMIX uses gpt-image-1.5 with input_fidelity:high — faster (≈31s vs 41s)
//     *and* better at holding her face, because input_fidelity exists precisely
//     to preserve identity. gpt-image-2 has no such parameter and rejects it.
//   * gpt-image-1-mini is fastest (≈23s) but substitutes a different woman
//     entirely. Not usable at any tier. So does chatgpt-image-latest.
//   * The biggest speed lever is `quality`, not the model: gpt-image-1.5 at
//     quality=low runs 18-20s against 28-31s at medium, with the same model and
//     the same input_fidelity. Likeness softens slightly and framing drifts a
//     little tighter, which is a fine trade while iterating and a bad one for a
//     keeper — so it is exposed as a choice rather than picked here.
//   * Reference photos must have EXIF rotation baked into the pixels; the API
//     ignores the orientation flag (see src/lib/image.ts).

const ENDPOINT = "https://api.openai.com/v1/images/edits";

export const TRYON_MODEL = "gpt-image-2";
export const REMIX_MODEL = "gpt-image-1.5";

export type ImageInput = { bytes: ArrayBuffer; filename: string; type: string };

/**
 * Pushes against the waxy, airbrushed look that generated faces drift toward —
 * the "uncanny valley" problem. Asking for texture and asymmetry explicitly is
 * what keeps skin looking photographed rather than rendered.
 */
const REALISM =
  "Photographic realism: natural skin texture with visible pores and fine lines, " +
  "subtle natural asymmetry, no retouching, no beauty filter, no plastic or waxy skin.";

export type Quality = "low" | "medium";

async function edit(
  apiKey: string,
  model: string,
  images: ImageInput[],
  prompt: string,
  size: string,
  highFidelity: boolean,
  quality: Quality,
): Promise<Uint8Array> {
  const form = new FormData();
  form.set("model", model);
  form.set("size", size);
  form.set("quality", quality);
  form.set("n", "1");
  form.set("prompt", prompt);
  // Only the 1.x models accept this; gpt-image-2 errors on it.
  if (highFidelity) form.set("input_fidelity", "high");
  for (const img of images) {
    form.append("image[]", new File([img.bytes], img.filename, { type: img.type }));
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const body = (await res.json()) as {
    data?: { b64_json: string }[];
    error?: { message: string };
  };
  if (!res.ok || body.error) {
    throw new Error(body.error?.message ?? `OpenAI returned ${res.status}`);
  }
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image");

  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * An edit aimed at *her* rather than at the clothes. These need the reference
 * photos sent along, because a remix otherwise only ever sees the previous
 * generation — so identity drifts a little further with each step and there is
 * nothing to pull it back. Garment edits don't need that and are cheaper
 * without it.
 */
const PERSON_WORDS =
  /\b(face|facial|hair|skin|eyes?|nose|lips?|mouth|smile|smiling|expression|body|figure|build|proportions?|shoulders?|waist|legs?|arms?|height|taller|shorter (?:hair|her)|thinner|slimmer|curvier|younger|older|she|her(?:self)?|model'?s)\b/i;

export const isPersonEdit = (instruction: string) => PERSON_WORDS.test(instruction);

/** Put a garment on the model, from her reference photos. */
export function tryOn(
  apiKey: string,
  photos: ImageInput[],
  garment: ImageInput,
  description: string,
  extra: string,
  size: string,
) {
  const prompt = [
    `The first ${photos.length} image${photos.length === 1 ? " is a reference photo" : "s are reference photos"} of the SAME woman.`,
    "The LAST image is a garment.",
    "Produce a full-body fashion editorial photograph, head to toe with her feet visible,",
    "of that exact woman wearing the garment from the last image.",
    "Her face, hair, skin tone and body proportions must match the reference photos faithfully —",
    "do not slim, lengthen, or idealise her body, and do not substitute a different face.",
    description.trim() ? `About her: ${description.trim()}` : "",
    "Reproduce the garment accurately in cut, colour, length and fabric.",
    REALISM,
    extra.trim() ||
      "Neutral studio backdrop, soft even lighting, standing, looking at camera.",
  ]
    .filter(Boolean)
    .join(" ");

  // Try-on is always the best pass: it establishes the look everything else is
  // edited from, so it is the wrong place to trade quality for speed.
  return edit(apiKey, TRYON_MODEL, [...photos, garment], prompt, size, false, "medium");
}

/**
 * Restyle an existing look. `photos` is empty for ordinary garment edits and
 * carries the reference set when the instruction targets her appearance.
 */
export function remix(
  apiKey: string,
  previous: ImageInput,
  photos: ImageInput[],
  description: string,
  instruction: string,
  size: string,
  quality: Quality,
) {
  const grounded = photos.length > 0;

  const prompt = grounded
    ? [
        "The FIRST image is the look to edit.",
        `The remaining ${photos.length} images are reference photos of the real woman it depicts.`,
        "Keep the same garment, same pose, same backdrop and same lighting as the first image.",
        "Apply this change:",
        instruction.trim(),
        "Her face and body must match the REFERENCE PHOTOS, not the first image —",
        "correct any drift away from her real appearance.",
        description.trim() ? `About her: ${description.trim()}` : "",
        REALISM,
      ]
    : [
        "Keep the same woman, same face, same pose, same backdrop and same lighting.",
        "Change only what this instruction asks for:",
        instruction.trim(),
        description.trim() ? `She is: ${description.trim()}` : "",
        REALISM,
      ];

  return edit(
    apiKey,
    REMIX_MODEL,
    [previous, ...photos],
    prompt.filter(Boolean).join(" "),
    size,
    true,
    quality,
  );
}

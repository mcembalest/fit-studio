/**
 * Normalize a photo before it is ever stored or sent to the model.
 *
 * iPhone photos are written landscape with an EXIF orientation flag rather than
 * rotated pixels. The OpenAI image API ignores that flag, so an unprocessed
 * upload arrives sideways and likeness degrades badly — this was the single
 * biggest quality problem found while probing the API. `createImageBitmap` with
 * `imageOrientation: "from-image"` bakes the rotation into the pixels, and
 * re-encoding through a canvas drops the EXIF entirely.
 *
 * Downscaling to 1024px on the long edge also keeps requests small; the model
 * gains nothing from a 4032px reference.
 */
const MAX_EDGE = 1024;

export async function normalizePhoto(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9),
  );
  if (!blob) throw new Error(`could not process ${file.name}`);

  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg" });
}

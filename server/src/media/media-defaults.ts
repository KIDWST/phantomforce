export const MEDIA_DEFAULT_ROUTES = Object.freeze({
  image: Object.freeze({ provider: "phantom_v1_chatgpt_plus", model: "phantom-v1:latest + chatgpt-plus" }),
  thinking: Object.freeze({ provider: "phantom_v1_chatgpt_plus", model: "phantom-v1:latest + chatgpt-plus" }),
  video: Object.freeze({ provider: "higgsfield", model: "seedance_2_0" }),
});

export function defaultMediaRoute(modality: "image" | "video") {
  return modality === "video" ? MEDIA_DEFAULT_ROUTES.video : MEDIA_DEFAULT_ROUTES.image;
}

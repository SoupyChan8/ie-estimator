// Images used on the client screens and in the PDF. Put files in /public/assets and set the paths here,
// e.g. cover: `${import.meta.env.BASE_URL}assets/cover.jpg`. Empty string = elegant gradient placeholder.
export const brandAssets = {
  cover: "",
  overview: "",
  logo: "",
  /** Per-category thumbnail on the PDF scope page, keyed by category name. */
  scope: {} as Record<string, string>,
  scopeFallback: "",
  contact: {
    phone: "+91 7003 995 315",
    email: "hello@interioreditors.co.in",
    city: "Kolkata",
    website: "www.interioreditors.co.in",
  },
};

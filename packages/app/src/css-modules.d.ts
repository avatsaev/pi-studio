/**
 * Global type declaration for CSS Module imports.
 * Vite handles the transform; TypeScript just needs to know the shape.
 */
declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}

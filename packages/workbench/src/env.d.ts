// `process.env.NODE_ENV` is replaced by the consumer's bundler; declared here because this package
// compiles with `types: []`.
declare const process: { readonly env: { readonly NODE_ENV?: string } };

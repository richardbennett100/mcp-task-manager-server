module.exports = {
  plugins: {
    autoprefixer: {},
    // cssnano is good for production builds to minimize CSS
    // It might be run as part of the vite build process already if using adapter-static with precompress
    // Or you can explicitly add it here.
    // For dev, it might not be necessary.
    ...(process.env.NODE_ENV === 'production' ? { cssnano: { preset: 'default' } } : {}),
  },
};

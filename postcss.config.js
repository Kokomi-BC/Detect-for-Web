const purgecss = require('postcss-purgecss');
module.exports = {
  plugins: [
    purgecss({
      content: ['./*.html', './client-src/**/*.js', './src/**/*.js'],
      defaultExtractor: content => content.match(/[\w-/:]+(?<!:)/g) || [],
      safelist: {
        standard: [/^data-theme/, /^show/, /^active/, /^modal/, /^toast/],
        deep: [/^user-dropdown/, /^pagination/],
      }
    }),
  ],
};
